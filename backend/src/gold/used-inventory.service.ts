import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  goldAccounts, goldInventoryConversions, goldLedgerEntries, goldTransactions,
  inventoryItems, inventoryMovements, users, warehouses,
} from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { GoldPostingService } from './gold-posting.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KARATS = new Set(['24', '22', '21', '18', '14']);
const CATEGORIES = new Set(['أطقم', 'خواتم ومحابس', 'أساور ومبارم', 'قلائد وسلاسل', 'أقراط', 'سبائك وليرات', 'ذهب كسر', 'متنوع']);
const EPSILON = 0.0005;
/** The clearing account that carries metal once it has become sellable stock. */
export const USED_INVENTORY_SYSTEM_CODE = 'used_inventory';
export const USED_SOURCE_TYPE = 'gold_scrap_conversion';

const weight = (value: unknown, field: string, minimum = 0.001) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw new ConflictException(`${field} غير صالح.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new ConflictException(`${field} غير صالح.`);
  return parsed;
};

/**
 * Reclassifying physical scrap into sellable second-hand stock.
 *
 * The metal was already received and recorded when the sale took the barter in (Task 09), so
 * this operation creates no gold, no money and no revenue. It moves grams out of the shop's
 * scrap holding and into the inventory the shop can sell — the same grams are never available
 * in both places at once.
 *
 * The gold side is a real double-entry movement, not a faked receipt or payment: the company
 * holding is credited and a `used_inventory` clearing account is debited, so the ledger stays
 * balanced in pure gold and the history of the original barter remains untouched.
 */
@Injectable()
export class UsedInventoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService,
    @Inject(GoldPostingService) private readonly posting: GoldPostingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  // ---------------------------------------------------------------- availability

  /**
   * Scrap available for reclassification, per company account and karat.
   *
   * `received` counts what barter actually brought in; `converted` counts what managers have
   * already reclassified. The difference is what may still be converted, and it is computed
   * here rather than trusted from the browser.
   */
  async available(user: AuthIdentity, query: Record<string, unknown> = {}) {
    const conditions: any[] = [eq(goldAccounts.kind, 'company'), isNull(goldAccounts.systemCode)];
    if (query.warehouseId) {
      const warehouseId = this.id(query.warehouseId, 'warehouseId');
      this.authorization.assertWarehouse(user, warehouseId);
      conditions.push(eq(goldAccounts.warehouseId, warehouseId));
    } else if (!this.authorization.canAccessAll(user)) {
      const ids = this.authorization.allowedWarehouseIds(user) ?? [];
      conditions.push(ids.length ? inArray(goldAccounts.warehouseId, ids) : sql`false`);
    }
    const accounts = await this.db.select({ account: goldAccounts, warehouseName: warehouses.name })
      .from(goldAccounts).leftJoin(warehouses, eq(warehouses.id, goldAccounts.warehouseId))
      .where(and(...conditions)).orderBy(asc(goldAccounts.name));
    if (!accounts.length) return { holdings: [] };
    const accountIds = accounts.map(row => row.account.id);

    const [received, converted] = await Promise.all([
      this.db.select({
        accountId: goldLedgerEntries.goldAccountId, karat: goldLedgerEntries.karat,
        grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)`,
        lastAt: sql<string>`max(${goldLedgerEntries.occurredAt})`,
      }).from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
        .where(and(inArray(goldLedgerEntries.goldAccountId, accountIds), eq(goldTransactions.type, 'sale_exchange'), eq(goldTransactions.status, 'posted')))
        .groupBy(goldLedgerEntries.goldAccountId, goldLedgerEntries.karat),
      this.db.select({
        accountId: goldInventoryConversions.goldAccountId, karat: goldInventoryConversions.karat,
        grams: sql<string>`coalesce(sum(${goldInventoryConversions.convertedWeightGrams}), 0)`,
        count: sql<number>`count(*)::int`,
      }).from(goldInventoryConversions)
        .where(and(inArray(goldInventoryConversions.goldAccountId, accountIds), eq(goldInventoryConversions.status, 'posted')))
        .groupBy(goldInventoryConversions.goldAccountId, goldInventoryConversions.karat),
    ]);

    const holdings = [];
    for (const row of accounts) {
      for (const entry of received.filter(value => value.accountId === row.account.id)) {
        const receivedGrams = Number(Number(entry.grams).toFixed(3));
        const match = converted.find(value => value.accountId === row.account.id && value.karat === entry.karat);
        const convertedGrams = Number(Number(match?.grams ?? 0).toFixed(3));
        const availableGrams = Number((receivedGrams - convertedGrams).toFixed(3));
        if (receivedGrams <= EPSILON) continue;
        holdings.push({
          goldAccountId: row.account.id, accountName: row.account.name,
          warehouseId: row.account.warehouseId, warehouseName: row.warehouseName,
          karat: entry.karat,
          receivedGrams, convertedGrams, availableGrams,
          conversionCount: match?.count ?? 0,
          // History is never hidden: a fully drawn holding still shows what it originally was.
          fullyConverted: availableGrams <= EPSILON,
          lastReceivedAt: entry.lastAt ? new Date(entry.lastAt).toISOString() : null,
          canConvert: user.permissions.includes('gold_accounts.used_inventory.convert') && availableGrams > EPSILON,
        });
      }
    }
    holdings.sort((left, right) => Number(right.karat) - Number(left.karat));
    return { holdings };
  }

  // ---------------------------------------------------------------- conversion

  async convert(user: AuthIdentity, input: Record<string, unknown>) {
    if (!user.permissions.includes('gold_accounts.used_inventory.convert')) throw new ForbiddenException('Permission denied.');
    const goldAccountId = this.id(input.goldAccountId, 'goldAccountId');
    const karat = typeof input.karat === 'string' && KARATS.has(input.karat) ? input.karat : (() => { throw new ConflictException('العيار غير صالح.'); })();
    const convertedWeight = weight(input.weightGrams, 'الوزن المحوَّل');
    const idempotencyKey = this.id(input.idempotencyKey, 'idempotencyKey');
    // A human decision has to be explained; whitespace is not an explanation.
    const managerNote = typeof input.managerNote === 'string' && input.managerNote.trim().length >= 3 ? input.managerNote.trim().slice(0, 1000)
      : (() => { throw new ConflictException('ملاحظة المدير مطلوبة.'); })();
    const name = this.text(input.name, 'اسم القطعة', 180);
    const category = this.text(input.category, 'التصنيف', 120);
    if (!CATEGORIES.has(category)) throw new ConflictException('التصنيف غير صالح.');
    const inventoryMode: 'individual' | 'aggregate' = input.inventoryMode === 'aggregate' ? 'aggregate' : 'individual';
    const quantity = input.quantity === undefined || input.quantity === null || input.quantity === ''
      ? (inventoryMode === 'aggregate' ? 1 : 1)
      : weight(input.quantity, 'الكمية');
    if (inventoryMode === 'individual' && !Number.isInteger(quantity)) throw new ConflictException('كمية القطع المفردة يجب أن تكون رقماً صحيحاً.');
    const code = this.text(input.code, 'كود الصنف', 60);

    const existing = (await this.db.select().from(goldInventoryConversions).where(eq(goldInventoryConversions.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (existing) return this.detail(user, existing.id);

    const conversionId = await this.db.transaction(async tx => {
      // Locking the account row serialises every concurrent conversion against this holding,
      // so two managers can never both spend the same grams.
      const account = (await tx.select().from(goldAccounts).where(eq(goldAccounts.id, goldAccountId)).limit(1).for('update'))[0];
      if (!account) throw new NotFoundException('حساب الذهب غير موجود.');
      if (account.kind !== 'company' || account.systemCode) throw new ConflictException('هذا الحساب لا يمثّل ذهباً موجوداً في المحل.');
      if (!account.warehouseId) throw new ConflictException('حساب الذهب غير مرتبط بمستودع.');
      // §18/§19 — the stock is created in the warehouse physically holding the scrap.
      this.authorization.assertWarehouse(user, account.warehouseId);
      const warehouseId = account.warehouseId;

      const receivedRow = (await tx.select({ grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)` })
        .from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
        .where(and(eq(goldLedgerEntries.goldAccountId, goldAccountId), eq(goldLedgerEntries.karat, karat), eq(goldTransactions.type, 'sale_exchange'), eq(goldTransactions.status, 'posted'))))[0]!;
      const convertedRow = (await tx.select({ grams: sql<string>`coalesce(sum(${goldInventoryConversions.convertedWeightGrams}), 0)` })
        .from(goldInventoryConversions)
        .where(and(eq(goldInventoryConversions.goldAccountId, goldAccountId), eq(goldInventoryConversions.karat, karat), eq(goldInventoryConversions.status, 'posted'))))[0]!;
      const availableGrams = Number((Number(receivedRow.grams) - Number(convertedRow.grams)).toFixed(3));
      if (availableGrams <= EPSILON) throw new ConflictException(`لا يوجد كسر مقايضة متاح بعيار ${karat}.`);
      if (convertedWeight > availableGrams + EPSILON) throw new ConflictException(`الوزن المطلوب ${convertedWeight.toFixed(3)} غ يتجاوز المتاح ${availableGrams.toFixed(3)} غ.`);

      const duplicateCode = (await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.code, code)).limit(1))[0];
      if (duplicateCode) throw new ConflictException('كود الصنف مستخدم بالفعل.');

      const grossWeight = convertedWeight.toFixed(3);
      const item = (await tx.insert(inventoryItems).values({
        code, name, category, karat,
        grossWeightGrams: grossWeight, stoneWeightGrams: '0.000', netWeightGrams: grossWeight,
        laborFeeUsdPerGram: '0.0000', totalLaborFeeUsd: '0.0000',
        warehouseId, status: 'in_stock', inventoryMode, quantity: quantity.toFixed(3),
        // Machine-readable provenance, so nothing depends on reading the item's name.
        condition: 'used', sourceType: USED_SOURCE_TYPE,
        notes: managerNote,
        createdByUserId: user.id, updatedByUserId: user.id,
      }).returning())[0]!;

      // Gold side: the shop's holding gives the metal up, the used-inventory clearing account
      // takes it on. Same karat on both sides, so weight and purity are both conserved.
      const transaction = await this.posting.post(tx, user, {
        type: 'used_inventory_conversion',
        sourceType: 'gold_inventory_conversion',
        sourceId: item.id,
        postingEvent: 'used_inventory_conversion',
        description: `تحويل كسر مقايضة إلى مخزون مستعمل — ${name} (${convertedWeight.toFixed(3)} غ عيار ${karat})`,
        userNote: managerNote,
        warehouseId,
        idempotencyKey: `${idempotencyKey}:gold`,
        lines: [
          { accountId: goldAccountId, karat: karat as any, creditGrams: convertedWeight, warehouseId, description: `خروج من ذهب المحل إلى المخزون المستعمل` },
          { systemCode: USED_INVENTORY_SYSTEM_CODE, karat: karat as any, debitGrams: convertedWeight, warehouseId, description: `ذهب مستعمل ضمن المخزون — ${code}` },
        ],
      });

      await tx.insert(inventoryMovements).values({
        inventoryItemId: item.id, type: 'gold_used_conversion', toWarehouseId: warehouseId, actorUserId: user.id,
        note: `تحويل كسر مقايضة إلى مخزون مستعمل: ${managerNote}`,
        metadata: { karat, convertedWeightGrams: grossWeight, quantity: quantity.toFixed(3), goldAccountId, goldTransactionId: transaction.id },
      });

      const conversion = (await tx.insert(goldInventoryConversions).values({
        goldAccountId, warehouseId, karat,
        convertedWeightGrams: grossWeight, quantity: quantity.toFixed(3),
        inventoryItemId: item.id, goldTransactionId: transaction.id,
        managerNote, idempotencyKey, createdByUserId: user.id,
      }).returning())[0]!;

      await this.audit.record({
        actorUserId: user.id, action: 'gold.used_inventory.convert', module: 'gold', entityId: conversion.id, warehouseId,
        metadata: { goldAccountId, karat, convertedWeightGrams: grossWeight, quantity: quantity.toFixed(3), inventoryItemId: item.id, inventoryCode: code, goldTransactionId: transaction.id, managerNote, availableBeforeGrams: availableGrams.toFixed(3) },
      }, tx);
      return conversion.id;
    });

    const result = await this.detail(user, conversionId);
    this.realtime.emitToWarehouse(result.warehouseId, 'inventory.updated', { source: 'gold_used_conversion', inventoryItemId: result.inventoryItemId });
    this.realtime.emitToWarehousePermission(result.warehouseId, 'gold_accounts.view', 'gold.holdings.updated', { warehouseId: result.warehouseId, karat: result.karat });
    return result;
  }

  // ---------------------------------------------------------------- reversal

  async reverse(user: AuthIdentity, conversionId: string, input: Record<string, unknown>) {
    if (!user.permissions.includes('gold_accounts.used_inventory.reverse')) throw new ForbiddenException('Permission denied.');
    conversionId = this.id(conversionId, 'conversionId');
    const reason = typeof input.reason === 'string' && input.reason.trim().length >= 3 ? input.reason.trim().slice(0, 1000)
      : (() => { throw new ConflictException('سبب التراجع مطلوب.'); })();

    const warehouseId = await this.db.transaction(async tx => {
      const conversion = (await tx.select().from(goldInventoryConversions).where(eq(goldInventoryConversions.id, conversionId)).limit(1).for('update'))[0];
      if (!conversion) throw new NotFoundException('سجل التحويل غير موجود.');
      this.authorization.assertWarehouse(user, conversion.warehouseId);
      if (conversion.status !== 'posted') throw new ConflictException('تم التراجع عن هذا التحويل بالفعل.');

      const item = (await tx.select().from(inventoryItems).where(eq(inventoryItems.id, conversion.inventoryItemId)).limit(1).for('update'))[0];
      if (!item) throw new ConflictException('صنف المخزون غير موجود.');
      // Anything downstream makes a destructive reversal unsafe; the correction then belongs to
      // the ordinary business workflow, not to undoing history.
      if (item.status !== 'in_stock' || item.archivedAt) throw new ConflictException('لا يمكن التراجع: الصنف لم يعد متاحاً في المخزون. استخدم مرتجعاً أو تسوية.');
      if (Number(item.netWeightGrams) + EPSILON < Number(conversion.convertedWeightGrams) || Number(item.quantity) + EPSILON < Number(conversion.quantity)) {
        throw new ConflictException('لا يمكن التراجع: جرى بيع أو تعديل جزء من هذا الصنف. استخدم مرتجعاً أو تسوية.');
      }
      const movements = await tx.select({ type: inventoryMovements.type }).from(inventoryMovements).where(eq(inventoryMovements.inventoryItemId, item.id));
      if (movements.some(row => row.type !== 'gold_used_conversion')) throw new ConflictException('لا يمكن التراجع: للصنف حركات لاحقة. استخدم مرتجعاً أو تسوية.');

      const reversal = await this.posting.post(tx, user, {
        type: 'reversal',
        sourceType: 'gold_inventory_conversion_reversal',
        sourceId: conversion.id,
        postingEvent: 'used_inventory_conversion_reversal',
        description: `تراجع عن تحويل كسر مقايضة إلى مخزون مستعمل (${Number(conversion.convertedWeightGrams).toFixed(3)} غ عيار ${conversion.karat})`,
        userNote: reason,
        warehouseId: conversion.warehouseId,
        reversalOfTransactionId: conversion.goldTransactionId,
        idempotencyKey: `${conversion.idempotencyKey}:reverse`,
        lines: [
          { systemCode: USED_INVENTORY_SYSTEM_CODE, karat: conversion.karat as any, creditGrams: Number(conversion.convertedWeightGrams), warehouseId: conversion.warehouseId, description: 'إلغاء الذهب المستعمل من المخزون' },
          { accountId: conversion.goldAccountId, karat: conversion.karat as any, debitGrams: Number(conversion.convertedWeightGrams), warehouseId: conversion.warehouseId, description: 'إعادة الكسر إلى ذهب المحل' },
        ],
      });

      // The stock item is archived, never hard-deleted, so its history survives.
      await tx.update(inventoryItems).set({ archivedAt: new Date(), archivedByUserId: user.id, updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(eq(inventoryItems.id, item.id));
      await tx.insert(inventoryMovements).values({
        inventoryItemId: item.id, type: 'gold_used_conversion_reversal', fromWarehouseId: conversion.warehouseId, actorUserId: user.id,
        note: `تراجع عن تحويل كسر مقايضة: ${reason}`, metadata: { conversionId: conversion.id, reversalGoldTransactionId: reversal.id },
      });
      await tx.update(goldInventoryConversions).set({
        status: 'reversed', reversedAt: new Date(), reversedByUserId: user.id, reversalReason: reason,
        reversalGoldTransactionId: reversal.id, updatedAt: new Date(),
      }).where(and(eq(goldInventoryConversions.id, conversionId), eq(goldInventoryConversions.status, 'posted')));

      await this.audit.record({ actorUserId: user.id, action: 'gold.used_inventory.reverse', module: 'gold', entityId: conversionId, warehouseId: conversion.warehouseId, metadata: { reason, inventoryItemId: item.id, reversalGoldTransactionId: reversal.id } }, tx);
      return conversion.warehouseId;
    });

    const result = await this.detail(user, conversionId);
    this.realtime.emitToWarehouse(warehouseId, 'inventory.updated', { source: 'gold_used_conversion_reversal', inventoryItemId: result.inventoryItemId });
    return result;
  }

  // ---------------------------------------------------------------- reads

  async conversions(user: AuthIdentity, query: Record<string, unknown> = {}) {
    const conditions: any[] = [];
    const allowed = this.authorization.allowedWarehouseIds(user);
    if (allowed) conditions.push(allowed.length ? inArray(goldInventoryConversions.warehouseId, allowed) : sql`false`);
    if (query.warehouseId) {
      const warehouseId = this.id(query.warehouseId, 'warehouseId');
      this.authorization.assertWarehouse(user, warehouseId);
      conditions.push(eq(goldInventoryConversions.warehouseId, warehouseId));
    }
    if (query.status === 'posted' || query.status === 'reversed') conditions.push(eq(goldInventoryConversions.status, query.status));
    if (query.inventoryItemId) conditions.push(eq(goldInventoryConversions.inventoryItemId, this.id(query.inventoryItemId, 'inventoryItemId')));
    const rows = await this.rows(conditions.length ? and(...conditions) : undefined, Math.min(Number(query.limit ?? 50) || 50, 200));
    return { items: rows.map(row => this.dto(row)) };
  }

  async detail(user: AuthIdentity, conversionId: string) {
    const row = (await this.rows(eq(goldInventoryConversions.id, this.id(conversionId, 'conversionId')), 1))[0];
    if (!row) throw new NotFoundException('سجل التحويل غير موجود.');
    this.authorization.assertWarehouse(user, row.conversion.warehouseId);
    return this.dto(row);
  }

  private async rows(where: any, limit: number) {
    return this.db.select({
      conversion: goldInventoryConversions,
      warehouseName: warehouses.name,
      actorName: users.fullName,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      itemStatus: inventoryItems.status,
      itemMode: inventoryItems.inventoryMode,
      itemNetWeight: inventoryItems.netWeightGrams,
      itemQuantity: inventoryItems.quantity,
      transactionNumber: goldTransactions.transactionNumber,
    }).from(goldInventoryConversions)
      .innerJoin(warehouses, eq(warehouses.id, goldInventoryConversions.warehouseId))
      .innerJoin(users, eq(users.id, goldInventoryConversions.createdByUserId))
      .innerJoin(inventoryItems, eq(inventoryItems.id, goldInventoryConversions.inventoryItemId))
      .innerJoin(goldTransactions, eq(goldTransactions.id, goldInventoryConversions.goldTransactionId))
      .where(where).orderBy(desc(goldInventoryConversions.createdAt)).limit(limit);
  }

  private dto(row: any) {
    const conversion = row.conversion;
    return {
      id: conversion.id,
      goldAccountId: conversion.goldAccountId,
      warehouseId: conversion.warehouseId,
      warehouseName: row.warehouseName,
      karat: conversion.karat,
      convertedWeightGrams: Number(conversion.convertedWeightGrams),
      quantity: Number(conversion.quantity),
      inventoryItemId: conversion.inventoryItemId,
      inventoryCode: row.itemCode,
      inventoryName: row.itemName,
      inventoryStatus: row.itemStatus,
      inventoryMode: row.itemMode,
      inventoryRemainingWeightGrams: Number(row.itemNetWeight),
      inventoryRemainingQuantity: Number(row.itemQuantity),
      goldTransactionId: conversion.goldTransactionId,
      goldTransactionNumber: row.transactionNumber,
      managerNote: conversion.managerNote,
      status: conversion.status,
      reversedAt: conversion.reversedAt?.toISOString() ?? null,
      reversalReason: conversion.reversalReason,
      createdBy: row.actorName,
      createdAt: conversion.createdAt.toISOString(),
    };
  }

  private id(value: unknown, field: string) { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; }
  private text(value: unknown, field: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} غير صالح.`);
    return value.trim();
  }
}
