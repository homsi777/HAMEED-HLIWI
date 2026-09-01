import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { cashMovements, cashboxTransferSequences, cashboxTransfers, cashboxes, expenseCategories, inventoryItems, partnerLedgerEntries, partners, purchaseInvoices, returnInvoices, salesInvoices, users, voucherAllocations, vouchers } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';
import { FinancePostingService, type CashCurrency } from './finance-posting.service.js';
import { AccountingDocumentsService } from '../accounting/accounting-documents.service.js';
import { AccountingPostingService } from '../accounting/accounting-posting.service.js';
import { DocumentNumberService } from '../common/document-number.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCIES = new Set(['USD', 'SYP']);
const VOUCHER_TYPES = new Set(['receipt', 'payment', 'expense']);

const number = (value: unknown, field: string, scale = 4, minimum = 0) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(raw)) throw new ConflictException(`${field} is invalid.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new ConflictException(`${field} is invalid.`);
  return parsed.toFixed(scale);
};
const uuid = (value: unknown, field: string) => { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; };
const dateBoundary = (value: unknown, endOfDay = false) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+03:00`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const voucherDto = (row: any) => ({
  id: row.voucher.id, voucherNumber: row.voucher.voucherNumber, type: row.voucher.type, status: row.voucher.status, date: row.voucher.createdAt.toISOString().slice(0, 10), createdAt: row.voucher.createdAt.toISOString(),
  sourceType: row.voucher.sourceType, sourceDocumentNumber: row.voucher.sourceDocumentNumber, sourceInvoiceId: row.voucher.salesInvoiceId ?? row.voucher.purchaseInvoiceId ?? row.voucher.returnInvoiceId ?? null,
  salesInvoiceId: row.voucher.salesInvoiceId, purchaseInvoiceId: row.voucher.purchaseInvoiceId, returnInvoiceId: row.voucher.returnInvoiceId, cashboxTransferId: row.voucher.cashboxTransferId,
  partnerId: row.voucher.partnerId, partnerName: row.voucher.partnerNameSnapshot ?? '', cashBoxId: row.voucher.cashboxId, cashboxName: row.cashboxName ?? '', warehouseId: row.voucher.warehouseId,
  currency: row.voucher.currency, amount: Number(row.voucher.amount), exchangeRate: Number(row.voucher.exchangeRateSypPerUsd), amountUSD: Number(row.voucher.amountUsdEquivalent),
  amountSYP: row.voucher.currency === 'SYP' ? Number(row.voucher.amount) : Number(row.voucher.amount) * Number(row.voucher.exchangeRateSypPerUsd),
  category: row.voucher.expenseCategory ?? '', systemNote: row.voucher.systemNote ?? '', userNote: row.voucher.userNote ?? '', statement: [row.voucher.systemNote, row.voucher.userNote].filter(Boolean).join(' — '),
  reversalOfVoucherId: row.voucher.reversalOfVoucherId, cancelledAt: row.voucher.cancelledAt?.toISOString() ?? null, cancellationReason: row.voucher.cancellationReason ?? null,
  createdBy: row.createdByName ?? '',
});

@Injectable()
export class FinanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
    @Inject(FinancePostingService) private readonly posting: FinancePostingService,
    @Inject(AccountingDocumentsService) private readonly accounting: AccountingDocumentsService,
    @Inject(AccountingPostingService) private readonly accountingPosting: AccountingPostingService,
    @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService,
  ) {}

  /** A branch account may never read or write company-level finance rows. */
  private assertFinancialWarehouse(user: AuthIdentity, warehouseId: string | null | undefined) {
    if (!warehouseId) {
      if (!this.scope.canAccessAll(user)) throw new ForbiddenException('Company-level financial data is not available to a warehouse account.');
      return;
    }
    this.scope.assertAccess(user, warehouseId);
  }

  private warehouseIds(user: AuthIdentity) {
    const ids = this.scope.allowedWarehouseIds(user);
    if (ids && !ids.length) return [];
    return ids;
  }

  // ---------------------------------------------------------------- cashboxes
  async listCashboxes(user: AuthIdentity, query: Record<string, unknown>) {
    const conditions: any[] = [isNull(cashboxes.archivedAt)];
    if (!this.scope.canAccessAll(user)) { const ids = this.warehouseIds(user)!; conditions.push(ids.length ? inArray(cashboxes.warehouseId, ids) : sql`false`); }
    if (query.warehouseId) { const warehouseId = uuid(query.warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); conditions.push(eq(cashboxes.warehouseId, warehouseId)); }
    if (query.currency && CURRENCIES.has(String(query.currency))) conditions.push(eq(cashboxes.currency, query.currency as CashCurrency));
    // Balances are aggregated straight from the movement ledger, so a cashbox can never
    // report a number that its own history does not justify.
    const [rows, totals] = await Promise.all([
      this.db.select().from(cashboxes).where(and(...conditions)).orderBy(asc(cashboxes.currency), asc(cashboxes.name)),
      this.db.select({
        cashboxId: cashMovements.cashboxId,
        inflow: sql<string>`coalesce(sum(case when ${cashMovements.direction} = 'inflow' then ${cashMovements.amount} else 0 end), 0)`,
        outflow: sql<string>`coalesce(sum(case when ${cashMovements.direction} = 'outflow' then ${cashMovements.amount} else 0 end), 0)`,
        movementCount: sql<number>`count(*)::int`,
      }).from(cashMovements).groupBy(cashMovements.cashboxId),
    ]);
    return rows.map(cashbox => {
      const totalsRow = totals.find(entry => entry.cashboxId === cashbox.id);
      const inflow = Number(totalsRow?.inflow ?? 0); const outflow = Number(totalsRow?.outflow ?? 0);
      return {
        id: cashbox.id, name: cashbox.name, currency: cashbox.currency, warehouseId: cashbox.warehouseId, isDefault: cashbox.isDefault, isActive: cashbox.isActive,
        openingBalance: Number(cashbox.openingBalance), inflowTotal: inflow, outflowTotal: outflow,
        balanceAmount: Number((Number(cashbox.openingBalance) + inflow - outflow).toFixed(4)),
        movementCount: totalsRow?.movementCount ?? 0, notes: cashbox.notes ?? '', version: cashbox.version,
      };
    });
  }

  async createCashbox(user: AuthIdentity, input: Record<string, unknown>) {
    const name = this.text(input.name, 'name', 120);
    const currency = typeof input.currency === 'string' && CURRENCIES.has(input.currency) ? input.currency as CashCurrency : (() => { throw new ConflictException('currency is invalid.'); })();
    const warehouseId = input.warehouseId === undefined || input.warehouseId === null || input.warehouseId === '' ? null : uuid(input.warehouseId, 'warehouseId');
    this.assertFinancialWarehouse(user, warehouseId);
    const openingBalance = number(input.openingBalance ?? '0', 'openingBalance');
    const isDefault = input.isDefault === true;
    const created = await this.db.transaction(async tx => {
      if (isDefault) await tx.update(cashboxes).set({ isDefault: false, updatedByUserId: user.id, updatedAt: new Date() }).where(and(warehouseId ? eq(cashboxes.warehouseId, warehouseId) : isNull(cashboxes.warehouseId), eq(cashboxes.currency, currency), eq(cashboxes.isDefault, true), isNull(cashboxes.archivedAt)));
      const row = (await tx.insert(cashboxes).values({ name, currency, warehouseId, openingBalance, isDefault, notes: this.optional(input.notes, 500), createdByUserId: user.id, updatedByUserId: user.id }).returning())[0]!;
      await this.accountingPosting.ensureCashboxAccount(tx, user, { id: row.id, name: row.name, currency: row.currency as CashCurrency, warehouseId: row.warehouseId });
      await this.accounting.postCashboxOpening(tx, user, { id: row.id, name: row.name, currency: row.currency as CashCurrency, warehouseId: row.warehouseId, openingBalance: Number(openingBalance), rate: Number(input.exchangeRateSypPerUsd ?? 1) || 1 });
      await this.audit.record({ actorUserId: user.id, action: 'finance.cashbox.create', module: 'finance', entityId: row.id, warehouseId: warehouseId ?? undefined, metadata: { name, currency, isDefault, openingBalance } }, tx);
      return row;
    });
    this.realtime.emitToPermissions(['finance.view'], 'finance.cashbox.changed', { id: created.id });
    return (await this.listCashboxes(user, {})).find(row => row.id === created.id)!;
  }

  async updateCashbox(user: AuthIdentity, cashboxId: string, input: Record<string, unknown>) {
    cashboxId = uuid(cashboxId, 'id');
    const updated = await this.db.transaction(async tx => {
      const current = (await tx.select().from(cashboxes).where(and(eq(cashboxes.id, cashboxId), isNull(cashboxes.archivedAt))).limit(1))[0];
      if (!current) throw new NotFoundException('Cashbox not found.');
      this.assertFinancialWarehouse(user, current.warehouseId);
      const isDefault = input.isDefault === undefined ? current.isDefault : input.isDefault === true;
      if (isDefault && !current.isDefault) await tx.update(cashboxes).set({ isDefault: false, updatedByUserId: user.id, updatedAt: new Date() }).where(and(current.warehouseId ? eq(cashboxes.warehouseId, current.warehouseId ?? undefined) : isNull(cashboxes.warehouseId), eq(cashboxes.currency, current.currency), eq(cashboxes.isDefault, true), isNull(cashboxes.archivedAt)));
      const row = (await tx.update(cashboxes).set({
        name: input.name === undefined ? current.name : this.text(input.name, 'name', 120),
        isActive: input.isActive === undefined ? current.isActive : input.isActive === true,
        isDefault, notes: input.notes === undefined ? current.notes : this.optional(input.notes, 500),
        updatedByUserId: user.id, updatedAt: new Date(), version: sql`${cashboxes.version} + 1`,
      }).where(eq(cashboxes.id, cashboxId)).returning())[0]!;
      await this.audit.record({ actorUserId: user.id, action: 'finance.cashbox.update', module: 'finance', entityId: cashboxId, warehouseId: current.warehouseId ?? undefined, metadata: { name: row.name, isDefault: row.isDefault, isActive: row.isActive } }, tx);
      return row;
    });
    this.realtime.emitToPermissions(['finance.view'], 'finance.cashbox.changed', { id: updated.id });
    return (await this.listCashboxes(user, {})).find(row => row.id === updated.id)!;
  }

  // ---------------------------------------------------------------- vouchers
  async listVouchers(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit); const conditions: any[] = [];
    if (!this.scope.canAccessAll(user)) { const ids = this.warehouseIds(user)!; conditions.push(ids.length ? inArray(vouchers.warehouseId, ids) : sql`false`); }
    if (query.warehouseId) { const warehouseId = uuid(query.warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); conditions.push(eq(vouchers.warehouseId, warehouseId ?? undefined)); }
    if (query.type && VOUCHER_TYPES.has(String(query.type))) conditions.push(eq(vouchers.type, query.type as 'receipt'));
    if (query.status && ['posted', 'cancelled'].includes(String(query.status))) conditions.push(eq(vouchers.status, query.status as 'posted'));
    if (query.sourceType) conditions.push(eq(vouchers.sourceType, String(query.sourceType) as any));
    if (query.partnerId) conditions.push(eq(vouchers.partnerId, uuid(query.partnerId, 'partnerId')));
    if (query.cashboxId) conditions.push(eq(vouchers.cashboxId, uuid(query.cashboxId, 'cashboxId')));
    if (typeof query.search === 'string' && query.search.trim()) conditions.push(or(ilike(vouchers.voucherNumber, `%${query.search.trim()}%`), ilike(vouchers.sourceDocumentNumber, `%${query.search.trim()}%`), ilike(vouchers.partnerNameSnapshot, `%${query.search.trim()}%`), ilike(vouchers.systemNote, `%${query.search.trim()}%`), ilike(vouchers.userNote, `%${query.search.trim()}%`)));
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(vouchers.createdAt, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(vouchers.createdAt, new Date(`${query.dateTo}T23:59:59.999Z`)));
    const where = conditions.length ? and(...conditions) : undefined;
    const sort = query.sort === 'amount' ? vouchers.amountUsdEquivalent : query.sort === 'voucherNumber' ? vouchers.voucherNumber : vouchers.createdAt;
    const [rows, total] = await Promise.all([
      this.db.select({ voucher: vouchers, createdByName: users.fullName, cashboxName: cashboxes.name }).from(vouchers).innerJoin(users, eq(users.id, vouchers.createdByUserId)).innerJoin(cashboxes, eq(cashboxes.id, vouchers.cashboxId)).where(where).orderBy(query.order === 'asc' ? asc(sort) : desc(sort), desc(vouchers.id)).limit(limit).offset((page - 1) * limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(vouchers).where(where),
    ]);
    return { items: rows.map(voucherDto), meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  async getVoucher(user: AuthIdentity, voucherId: string) {
    voucherId = uuid(voucherId, 'id');
    const row = (await this.db.select({ voucher: vouchers, createdByName: users.fullName, cashboxName: cashboxes.name }).from(vouchers).innerJoin(users, eq(users.id, vouchers.createdByUserId)).innerJoin(cashboxes, eq(cashboxes.id, vouchers.cashboxId)).where(eq(vouchers.id, voucherId)).limit(1))[0];
    if (!row) throw new NotFoundException('Voucher not found.');
    this.assertFinancialWarehouse(user, row.voucher.warehouseId);
    const [allocations, sourceNumbers] = await Promise.all([
      this.db.select().from(voucherAllocations).where(eq(voucherAllocations.voucherId, voucherId)),
      this.sourceNumbers(row.voucher),
    ]);
    return { ...voucherDto(row), ...sourceNumbers, allocations: allocations.map(allocation => ({ id: allocation.id, salesInvoiceId: allocation.salesInvoiceId, purchaseInvoiceId: allocation.purchaseInvoiceId, returnInvoiceId: allocation.returnInvoiceId, amountUSD: Number(allocation.amountUsd) })) };
  }

  private async sourceNumbers(voucher: any) {
    if (voucher.salesInvoiceId) { const row = (await this.db.select({ number: salesInvoices.invoiceNumber }).from(salesInvoices).where(eq(salesInvoices.id, voucher.salesInvoiceId)).limit(1))[0]; return { sourceInvoiceNumber: row?.number ?? voucher.sourceDocumentNumber ?? null }; }
    if (voucher.purchaseInvoiceId) { const row = (await this.db.select({ number: purchaseInvoices.purchaseNumber }).from(purchaseInvoices).where(eq(purchaseInvoices.id, voucher.purchaseInvoiceId)).limit(1))[0]; return { sourceInvoiceNumber: row?.number ?? voucher.sourceDocumentNumber ?? null }; }
    if (voucher.returnInvoiceId) { const row = (await this.db.select({ number: returnInvoices.returnNumber }).from(returnInvoices).where(eq(returnInvoices.id, voucher.returnInvoiceId)).limit(1))[0]; return { sourceInvoiceNumber: row?.number ?? voucher.sourceDocumentNumber ?? null }; }
    return { sourceInvoiceNumber: voucher.sourceDocumentNumber ?? null };
  }

  // A manual receipt or payment moves real cash and adjusts what the partner owes.
  async createVoucher(user: AuthIdentity, input: Record<string, unknown>) {
    const type = typeof input.type === 'string' && VOUCHER_TYPES.has(input.type) ? input.type as 'receipt' | 'payment' | 'expense' : (() => { throw new ConflictException('type is invalid.'); })();
    const currency = typeof input.currency === 'string' && CURRENCIES.has(input.currency) ? input.currency as CashCurrency : (() => { throw new ConflictException('currency is invalid.'); })();
    const amount = number(input.amount, 'amount', 4, 0.0001);
    const exchangeRate = number(input.exchangeRateSypPerUsd, 'exchangeRateSypPerUsd', 4, 0.0001);
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const cashboxId = input.cashBoxId ?? input.cashboxId;
    const explicitCashboxId = cashboxId === undefined || cashboxId === null || cashboxId === '' ? null : uuid(cashboxId, 'cashboxId');
    const partnerId = input.partnerId === undefined || input.partnerId === null || input.partnerId === '' ? null : uuid(input.partnerId, 'partnerId');
    const warehouseId = input.warehouseId === undefined || input.warehouseId === null || input.warehouseId === '' ? null : uuid(input.warehouseId, 'warehouseId');
    this.assertFinancialWarehouse(user, warehouseId);
    if (type === 'expense' && partnerId) throw new ConflictException('An expense voucher cannot be linked to a partner.');
    if (type !== 'expense' && !partnerId) throw new ConflictException('A receipt or payment voucher requires a partner.');
    const userNote = this.optional(input.userNote ?? input.statement, 1000);
    const expenseCategory = type === 'expense' ? this.text(input.category ?? input.expenseCategory, 'category', 120) : null;
    const allocations = this.allocations(input.allocations);

    const existing = await this.db.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.getVoucher(user, existing[0].id);

    let voucherId: string;
    try {
      voucherId = await this.db.transaction(async tx => {
        let partner: any = null;
        if (partnerId) {
          partner = (await tx.select().from(partners).where(and(eq(partners.id, partnerId), eq(partners.isActive, true), isNull(partners.archivedAt))).limit(1))[0];
          if (!partner) throw new ConflictException('The selected partner is not active.');
        }
        const systemNote = type === 'expense' ? `مصروف: ${expenseCategory}` : type === 'receipt' ? `دخول يدوي من ${partner.name}` : `خروج يدوي إلى ${partner.name}`;
        const voucher = await this.posting.postVoucher(tx, user, {
          type, sourceType: type === 'expense' ? 'expense' : 'manual', partnerId, partnerName: partner?.name ?? null, warehouseId, cashboxId: explicitCashboxId,
          currency, amount, exchangeRateSypPerUsd: exchangeRate, systemNote, userNote, expenseCategory,
          ledgerEntryType: type === 'expense' ? null : type === 'receipt' ? 'receipt' : 'payment',
          ledgerDirection: type === 'expense' ? null : type === 'receipt' ? 'credit' : 'debit',
          idempotencyKey,
        });
        const usdValue = Number(this.posting.usdEquivalent(currency, amount, exchangeRate));
        let allocated = 0;
        for (const allocation of allocations) {
          allocated += allocation.amountUSD;
          if (allocated > usdValue + 0.0001) throw new ConflictException('Allocations cannot exceed the voucher amount.');
          await tx.insert(voucherAllocations).values({ voucherId: voucher.id, salesInvoiceId: allocation.salesInvoiceId ?? null, purchaseInvoiceId: allocation.purchaseInvoiceId ?? null, returnInvoiceId: allocation.returnInvoiceId ?? null, amountUsd: allocation.amountUSD.toFixed(4) });
        }
        await this.audit.record({ actorUserId: user.id, action: 'finance.voucher.create', module: 'finance', entityId: voucher.id, warehouseId: warehouseId ?? undefined, metadata: { voucherNumber: voucher.voucherNumber, type, currency, amount, partnerId, allocationCount: allocations.length } }, tx);
        return voucher.id;
      });
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') { const row = await this.db.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.idempotencyKey, idempotencyKey)).limit(1); if (row[0]) return this.getVoucher(user, row[0].id); }
      throw error;
    }
    const result = await this.getVoucher(user, voucherId);
    this.realtime.emitToPermissions(['finance.view'], 'finance.voucher.created', { id: result.id, type: result.type });
    return result;
  }

  async cancelVoucher(user: AuthIdentity, voucherId: string, input: Record<string, unknown>) {
    const reason = this.optional(input.reason, 1000);
    if (!reason) throw new ConflictException('Cancellation reason is required.');
    voucherId = uuid(voucherId, 'id');
    await this.db.transaction(async tx => {
      const voucher = (await tx.select().from(vouchers).where(eq(vouchers.id, voucherId)).limit(1).for('update'))[0];
      if (!voucher) throw new NotFoundException('Voucher not found.');
      this.assertFinancialWarehouse(user, voucher.warehouseId);
      if (voucher.status !== 'posted') throw new ConflictException('Voucher is already cancelled.');
      if (voucher.sourceType !== 'manual' && voucher.sourceType !== 'expense') throw new ConflictException('Automatic vouchers are reversed by cancelling their source document, not on their own.');
      const reversal = await this.posting.reverseVoucher(tx, user, voucher, reason);
      if (!reversal) throw new ConflictException('Voucher is already cancelled.');
      // The compensating voucher created above posts its own opposite journal, so the
      // original journal must NOT also be reversed or the cash would be removed twice.
      await this.audit.record({ actorUserId: user.id, action: 'finance.voucher.cancel', module: 'finance', entityId: voucherId, warehouseId: voucher.warehouseId ?? undefined, metadata: { voucherNumber: voucher.voucherNumber, reversalVoucherNumber: reversal.voucherNumber, reason } }, tx);
    });
    const result = await this.getVoucher(user, voucherId);
    this.realtime.emitToPermissions(['finance.view'], 'finance.voucher.cancelled', { id: voucherId });
    return result;
  }

  // ---------------------------------------------------------------- transfers
  async listTransfers(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit);
    const conditions: any[] = [];
    if (!this.scope.canAccessAll(user)) {
      const ids = this.warehouseIds(user)!;
      const visibleBoxes = ids.length ? await this.db.select({ id: cashboxes.id }).from(cashboxes).where(and(inArray(cashboxes.warehouseId, ids), isNull(cashboxes.archivedAt))) : [];
      const boxIds = visibleBoxes.map(box => box.id);
      conditions.push(boxIds.length ? and(inArray(cashboxTransfers.fromCashboxId, boxIds), inArray(cashboxTransfers.toCashboxId, boxIds))! : sql`false`);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await this.db.select({ transfer: cashboxTransfers, createdByName: users.fullName }).from(cashboxTransfers).innerJoin(users, eq(users.id, cashboxTransfers.createdByUserId)).where(where).orderBy(desc(cashboxTransfers.createdAt)).limit(limit).offset((page - 1) * limit);
    const total = await this.db.select({ count: sql<number>`count(*)::int` }).from(cashboxTransfers).where(where);
    return { items: rows.map(row => ({ id: row.transfer.id, transferNumber: row.transfer.transferNumber, status: row.transfer.status, fromCashboxId: row.transfer.fromCashboxId, toCashboxId: row.transfer.toCashboxId, amountFrom: Number(row.transfer.amountFrom), amountTo: Number(row.transfer.amountTo), exchangeRate: row.transfer.exchangeRateSypPerUsd ? Number(row.transfer.exchangeRateSypPerUsd) : null, note: row.transfer.note ?? '', createdAt: row.transfer.createdAt.toISOString(), createdBy: row.createdByName })), meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  // A transfer is one document with two movements; it never leaves money in mid-air.
  async createTransfer(user: AuthIdentity, input: Record<string, unknown>) {
    const fromCashboxId = uuid(input.fromCashboxId ?? input.fromBoxId, 'fromCashboxId');
    const toCashboxId = uuid(input.toCashboxId ?? input.toBoxId, 'toCashboxId');
    if (fromCashboxId === toCashboxId) throw new ConflictException('Source and destination cashboxes must differ.');
    const amountFrom = number(input.amountFrom, 'amountFrom', 4, 0.0001);
    const amountTo = number(input.amountTo, 'amountTo', 4, 0.0001);
    const exchangeRate = number(input.exchangeRateSypPerUsd, 'exchangeRateSypPerUsd', 4, 0.0001);
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const note = this.optional(input.note ?? input.statement, 1000);
    const existing = await this.db.select({ id: cashboxTransfers.id }).from(cashboxTransfers).where(eq(cashboxTransfers.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.getTransfer(user, existing[0].id);

    const transferId = await this.db.transaction(async tx => {
      const source = (await tx.select().from(cashboxes).where(and(eq(cashboxes.id, fromCashboxId), eq(cashboxes.isActive, true), isNull(cashboxes.archivedAt))).limit(1))[0];
      const target = (await tx.select().from(cashboxes).where(and(eq(cashboxes.id, toCashboxId), eq(cashboxes.isActive, true), isNull(cashboxes.archivedAt))).limit(1))[0];
      if (!source || !target) throw new ConflictException('One of the selected cashboxes is not available.');
      this.assertFinancialWarehouse(user, source.warehouseId);
      this.assertFinancialWarehouse(user, target.warehouseId);
      if (source.currency === target.currency && amountFrom !== amountTo) throw new ConflictException('A same-currency transfer must move an identical amount.');
      const available = await this.posting.cashboxBalance(fromCashboxId, tx);
      if (available === null || available < Number(amountFrom) - 0.0001) throw new ConflictException('The source cashbox does not hold enough cash for this transfer.');
      const year = new Date().getUTCFullYear();
      const { sequence, number: generatedTransferNumber } = await this.numbers.next(tx, 'transfer');
      const transfer = (await tx.insert(cashboxTransfers).values({ transferNumber: generatedTransferNumber, transferYear: year, sequenceNumber: sequence, fromCashboxId, toCashboxId, amountFrom, amountTo, exchangeRateSypPerUsd: exchangeRate, note, idempotencyKey, createdByUserId: user.id }).returning())[0]!;
      const label = note ? ` — ${note}` : '';
      await this.posting.postVoucher(tx, user, { type: 'payment', sourceType: 'cashbox_transfer', cashboxTransferId: transfer.id, sourceDocumentNumber: transfer.transferNumber, cashboxId: fromCashboxId, warehouseId: source.warehouseId ?? undefined, currency: source.currency as CashCurrency, amount: amountFrom, exchangeRateSypPerUsd: exchangeRate, systemNote: `مناقلة ${transfer.transferNumber} إلى ${target.name}${label}`, idempotencyKey: `${idempotencyKey}:out` });
      await this.posting.postVoucher(tx, user, { type: 'receipt', sourceType: 'cashbox_transfer', cashboxTransferId: transfer.id, sourceDocumentNumber: transfer.transferNumber, cashboxId: toCashboxId, warehouseId: target.warehouseId, currency: target.currency as CashCurrency, amount: amountTo, exchangeRateSypPerUsd: exchangeRate, systemNote: `مناقلة ${transfer.transferNumber} من ${source.name}${label}`, idempotencyKey: `${idempotencyKey}:in` });
      await this.accounting.postTransfer(tx, user, { id: transfer.id, transferNumber: transfer.transferNumber, note, from: { cashboxId: fromCashboxId, currency: source.currency as CashCurrency, amount: Number(amountFrom), warehouseId: source.warehouseId }, to: { cashboxId: toCashboxId, currency: target.currency as CashCurrency, amount: Number(amountTo), warehouseId: target.warehouseId }, rate: Number(exchangeRate) });
      await this.audit.record({ actorUserId: user.id, action: 'finance.transfer.create', module: 'finance', entityId: transfer.id, warehouseId: source.warehouseId ?? undefined, metadata: { transferNumber: transfer.transferNumber, fromCashboxId, toCashboxId, amountFrom, amountTo } }, tx);
      return transfer.id;
    });
    const result = await this.getTransfer(user, transferId);
    this.realtime.emitToPermissions(['finance.view'], 'finance.transfer.created', { id: transferId });
    return result;
  }

  async getTransfer(user: AuthIdentity, transferId: string) {
    const row = (await this.db.select({ transfer: cashboxTransfers, createdByName: users.fullName }).from(cashboxTransfers).innerJoin(users, eq(users.id, cashboxTransfers.createdByUserId)).where(eq(cashboxTransfers.id, uuid(transferId, 'id'))).limit(1))[0];
    if (!row) throw new NotFoundException('Transfer not found.');
    const boxes = await this.db.select({ id: cashboxes.id, warehouseId: cashboxes.warehouseId }).from(cashboxes).where(inArray(cashboxes.id, [row.transfer.fromCashboxId, row.transfer.toCashboxId]));
    if (boxes.length !== 2) throw new NotFoundException('Transfer cashboxes not found.');
    for (const box of boxes) this.assertFinancialWarehouse(user, box.warehouseId);
    return { id: row.transfer.id, transferNumber: row.transfer.transferNumber, status: row.transfer.status, fromCashboxId: row.transfer.fromCashboxId, toCashboxId: row.transfer.toCashboxId, amountFrom: Number(row.transfer.amountFrom), amountTo: Number(row.transfer.amountTo), exchangeRate: row.transfer.exchangeRateSypPerUsd ? Number(row.transfer.exchangeRateSypPerUsd) : null, note: row.transfer.note ?? '', createdAt: row.transfer.createdAt.toISOString(), createdBy: row.createdByName };
  }

  // ---------------------------------------------------------------- movements and statements
  async listMovements(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit); const conditions: any[] = [];
    if (!this.scope.canAccessAll(user)) { const ids = this.warehouseIds(user)!; conditions.push(ids.length ? inArray(cashMovements.warehouseId, ids) : sql`false`); }
    if (query.cashboxId) conditions.push(eq(cashMovements.cashboxId, uuid(query.cashboxId, 'cashboxId')));
    if (query.partnerId) conditions.push(eq(cashMovements.partnerId, uuid(query.partnerId, 'partnerId')));
    if (query.direction && ['inflow', 'outflow'].includes(String(query.direction))) conditions.push(eq(cashMovements.direction, query.direction as 'inflow'));
    const movementFrom = dateBoundary(query.dateFrom); const movementTo = dateBoundary(query.dateTo, true);
    if (movementFrom) conditions.push(gte(cashMovements.createdAt, movementFrom));
    if (movementTo) conditions.push(lte(cashMovements.createdAt, movementTo));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select({ movement: cashMovements, cashboxName: cashboxes.name, voucherNumber: vouchers.voucherNumber, actorName: users.fullName }).from(cashMovements).innerJoin(cashboxes, eq(cashboxes.id, cashMovements.cashboxId)).leftJoin(vouchers, eq(vouchers.id, cashMovements.voucherId)).innerJoin(users, eq(users.id, cashMovements.actorUserId)).where(where).orderBy(desc(cashMovements.createdAt), desc(cashMovements.id)).limit(limit).offset((page - 1) * limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(cashMovements).where(where),
    ]);
    return { items: rows.map(row => ({ id: row.movement.id, cashboxId: row.movement.cashboxId, cashboxName: row.cashboxName, voucherId: row.movement.voucherId, voucherNumber: row.voucherNumber ?? '', direction: row.movement.direction, amount: Number(row.movement.amount), currency: row.movement.currency, amountUSD: Number(row.movement.amountUsdEquivalent), exchangeRate: Number(row.movement.exchangeRateSypPerUsd), partnerId: row.movement.partnerId, warehouseId: row.movement.warehouseId, description: row.movement.description, createdAt: row.movement.createdAt.toISOString(), actor: row.actorName })), meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  async daybook(user: AuthIdentity, query: Record<string, unknown>) {
    const from = dateBoundary(query.dateFrom);
    const to = dateBoundary(query.dateTo, true);
    const scopedConditions = (warehouseColumn: any, createdColumn: any) => {
      const conditions: any[] = [];
      if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; conditions.push(ids.length ? inArray(warehouseColumn, ids) : sql`false`); }
      if (from) conditions.push(gte(createdColumn, from)); if (to) conditions.push(lte(createdColumn, to));
      return conditions.length ? and(...conditions) : undefined;
    };
    const inventoryConditions: any[] = [eq(inventoryItems.status, 'in_stock'), isNull(inventoryItems.archivedAt)];
    if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; inventoryConditions.push(ids.length ? inArray(inventoryItems.warehouseId, ids) : sql`false`); }
    const [saleRows, purchaseRows, movementPage, inventoryWeight] = await Promise.all([
      this.db.select({ id: salesInvoices.id, createdAt: salesInvoices.createdAt, number: salesInvoices.invoiceNumber, partner: salesInvoices.customerNameSnapshot, status: salesInvoices.status, actor: users.fullName,
        goodsOut: sql<string>`coalesce((select sum(net_weight_grams) from sales_invoice_items where sales_invoice_id = ${salesInvoices.id}), 0)`,
        scrapIn: sql<string>`coalesce((select sum(weight_grams) from sales_gold_exchanges where sales_invoice_id = ${salesInvoices.id}), 0)`,
      }).from(salesInvoices).innerJoin(users, eq(users.id, salesInvoices.createdByUserId)).where(scopedConditions(salesInvoices.warehouseId, salesInvoices.createdAt)).orderBy(desc(salesInvoices.createdAt)),
      this.db.select({ id: purchaseInvoices.id, createdAt: purchaseInvoices.createdAt, number: purchaseInvoices.purchaseNumber, partner: purchaseInvoices.supplierNameSnapshot, status: purchaseInvoices.status, materialType: purchaseInvoices.materialType, actor: users.fullName,
        weight: sql<string>`coalesce((select sum(net_weight_grams) from purchase_invoice_items where purchase_invoice_id = ${purchaseInvoices.id}), 0)`,
      }).from(purchaseInvoices).innerJoin(users, eq(users.id, purchaseInvoices.createdByUserId)).where(scopedConditions(purchaseInvoices.warehouseId, purchaseInvoices.createdAt)).orderBy(desc(purchaseInvoices.createdAt)),
      this.listMovements(user, { dateFrom: query.dateFrom as string | undefined, dateTo: query.dateTo as string | undefined, page: 1, limit: 200 }),
      this.db.select({ grams: sql<string>`coalesce(sum(${inventoryItems.netWeightGrams}), 0)` }).from(inventoryItems).where(and(...inventoryConditions)),
    ]);
    const movementItems = [...movementPage.items];
    const movementPages = Math.ceil(movementPage.meta.total / 200);
    if (movementPages > 1) {
      const remaining = await Promise.all(Array.from({ length: movementPages - 1 }, (_, index) => this.listMovements(user, { dateFrom: query.dateFrom as string | undefined, dateTo: query.dateTo as string | undefined, page: index + 2, limit: 200 })));
      for (const page of remaining) movementItems.push(...page.items);
    }
    const blankMoney = { sypIn: 0, sypOut: 0, usdIn: 0, usdOut: 0 };
    const rows = [
      ...saleRows.map(row => ({ id: `sale-${row.id}`, occurredAt: row.createdAt.toISOString(), reference: row.number, goods: row.partner, goodsOut: row.status === 'posted' ? Number(row.goodsOut) : 0, goodsIn: 0, scrapIn: row.status === 'posted' ? Number(row.scrapIn) : 0, scrapOut: 0, description: `${row.status === 'cancelled' ? 'ملغاة — ' : ''}فاتورة بيع ${row.number} — ${row.partner}`, ...blankMoney, actor: row.actor })),
      ...purchaseRows.map(row => ({ id: `purchase-${row.id}`, occurredAt: row.createdAt.toISOString(), reference: row.number, goods: row.partner, goodsOut: 0, goodsIn: row.status === 'posted' && row.materialType === 'new' ? Number(row.weight) : 0, scrapIn: row.status === 'posted' && row.materialType === 'scrap' ? Number(row.weight) : 0, scrapOut: 0, description: `${row.status === 'cancelled' ? 'ملغاة — ' : ''}فاتورة شراء ${row.number} — ${row.partner}`, ...blankMoney, actor: row.actor })),
      ...movementItems.map(row => ({ id: `cash-${row.id}`, occurredAt: row.createdAt, reference: row.voucherNumber || '', goods: row.cashboxName, goodsOut: 0, goodsIn: 0, scrapIn: 0, scrapOut: 0, description: row.description,
        sypIn: row.currency === 'SYP' && row.direction === 'inflow' ? row.amount : 0, sypOut: row.currency === 'SYP' && row.direction === 'outflow' ? row.amount : 0,
        usdIn: row.currency === 'USD' && row.direction === 'inflow' ? row.amount : 0, usdOut: row.currency === 'USD' && row.direction === 'outflow' ? row.amount : 0, actor: row.actor })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return { items: rows, total: rows.length, weightSummary: { inventoryAvailableGrams: Number(inventoryWeight[0]?.grams ?? 0) } };
  }

  // The partner statement is rebuilt from immutable ledger entries every time it is read.
  async partnerStatement(user: AuthIdentity, partnerId: string, query: Record<string, unknown>) {
    partnerId = uuid(partnerId, 'id');
    const partner = (await this.db.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
    if (!partner) throw new NotFoundException('Partner not found.');
    const conditions: any[] = [eq(partnerLedgerEntries.partnerId, partnerId)];
    const ids = this.warehouseIds(user);
    if (ids) conditions.push(ids.length ? inArray(partnerLedgerEntries.warehouseId, ids) : sql`false`);
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(partnerLedgerEntries.occurredAt, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(partnerLedgerEntries.occurredAt, new Date(`${query.dateTo}T23:59:59.999Z`)));
    const entries = await this.db.select().from(partnerLedgerEntries).where(and(...conditions)).orderBy(asc(partnerLedgerEntries.occurredAt), asc(partnerLedgerEntries.createdAt), asc(partnerLedgerEntries.id));
    // Company opening balances have no branch attribution and must never be shown to a branch.
    const opening = this.scope.canAccessAll(user) ? Number(partner.openingBalanceUsd) : 0;
    let running = opening;
    const rows = entries.map(entry => {
      running = Number((running + Number(entry.debitUsd) - Number(entry.creditUsd)).toFixed(4));
      return {
        id: entry.id, date: entry.occurredAt.toISOString().slice(0, 10), occurredAt: entry.occurredAt.toISOString(), entryType: entry.entryType,
        documentType: this.documentLabel(entry.entryType), documentNumber: entry.documentNumber ?? '', description: entry.description,
        currency: entry.currency, originalAmount: Number(entry.originalAmount), exchangeRate: Number(entry.exchangeRateSypPerUsd),
        debitUSD: Number(entry.debitUsd), creditUSD: Number(entry.creditUsd), runningBalanceUSD: running,
        salesInvoiceId: entry.salesInvoiceId, purchaseInvoiceId: entry.purchaseInvoiceId, returnInvoiceId: entry.returnInvoiceId, voucherId: entry.voucherId,
      };
    });
    const net = Number((running).toFixed(4));
    return {
      partner: { id: partner.id, name: partner.name, type: partner.type, phone: partner.phone ?? '', openingBalanceUSD: opening, openingGoldBalance21kGrams: Number(partner.openingGoldBalance21kGrams) },
      openingBalanceUSD: opening, closingBalanceUSD: net,
      receivableUSD: net > 0 ? net : 0, payableUSD: net < 0 ? Math.abs(net) : 0,
      rows,
    };
  }

  private documentLabel(entryType: string) {
    return entryType === 'sale' ? 'فاتورة بيع' : entryType === 'purchase' ? 'فاتورة شراء' : entryType === 'sales_return' ? 'مرتجع مبيعات' : entryType === 'purchase_return' ? 'مرتجع مشتريات' : entryType === 'receipt' ? 'سند دخول' : entryType === 'payment' ? 'سند خروج' : entryType === 'reversal' ? 'عكس قيد' : 'رصيد افتتاحي';
  }

  async partnerBalances(user: AuthIdentity, query: Record<string, unknown>) {
    const limit = this.limit(query.limit);
    const ids = this.warehouseIds(user);
    if (ids && !ids.length) return [];
    const totals = await this.db.select({ partnerId: partnerLedgerEntries.partnerId, net: sql<string>`coalesce(sum(${partnerLedgerEntries.debitUsd} - ${partnerLedgerEntries.creditUsd}), 0)` }).from(partnerLedgerEntries).where(ids ? inArray(partnerLedgerEntries.warehouseId, ids) : undefined).groupBy(partnerLedgerEntries.partnerId);
    const partnerIds = totals.map(entry => entry.partnerId);
    const rows = ids
      ? (partnerIds.length ? await this.db.select().from(partners).where(and(eq(partners.isActive, true), isNull(partners.archivedAt), inArray(partners.id, partnerIds))).limit(limit) : [])
      : await this.db.select().from(partners).where(and(eq(partners.isActive, true), isNull(partners.archivedAt))).limit(limit);
    return rows.map(partner => {
      const opening = this.scope.canAccessAll(user) ? Number(partner.openingBalanceUsd) : 0;
      const net = Number((opening + Number(totals.find(entry => entry.partnerId === partner.id)?.net ?? 0)).toFixed(4));
      return { id: partner.id, name: partner.name, type: partner.type, phone: partner.phone ?? '', netUSD: net, receivableUSD: net > 0 ? net : 0, payableUSD: net < 0 ? Math.abs(net) : 0 };
    }).filter(row => query.onlyOutstanding !== 'true' || Math.abs(row.netUSD) > 0.0001);
  }

  async summary(user: AuthIdentity) {
    const [boxes, balances] = await Promise.all([this.listCashboxes(user, {}), this.partnerBalances(user, { limit: 200 })]);
    return {
      cashboxes: boxes,
      totalUsdCash: Number(boxes.filter(box => box.currency === 'USD').reduce((sum, box) => sum + box.balanceAmount, 0).toFixed(4)),
      totalSypCash: Number(boxes.filter(box => box.currency === 'SYP').reduce((sum, box) => sum + box.balanceAmount, 0).toFixed(2)),
      totalReceivablesUSD: Number(balances.reduce((sum, row) => sum + row.receivableUSD, 0).toFixed(4)),
      totalPayablesUSD: Number(balances.reduce((sum, row) => sum + row.payableUSD, 0).toFixed(4)),
    };
  }

  async listExpenseCategories() { return (await this.db.select().from(expenseCategories).where(eq(expenseCategories.isActive, true)).orderBy(asc(expenseCategories.name))).map(row => ({ id: row.id, name: row.name })); }
  async createExpenseCategory(user: AuthIdentity, input: Record<string, unknown>) {
    const name = this.text(input.name, 'name', 120);
    const row = (await this.db.insert(expenseCategories).values({ name, createdByUserId: user.id }).onConflictDoNothing().returning())[0];
    return row ? { id: row.id, name: row.name } : (await this.listExpenseCategories()).find(category => category.name === name)!;
  }

  private allocations(value: unknown) {
    if (value === undefined || value === null) return [] as Array<{ salesInvoiceId?: string; purchaseInvoiceId?: string; returnInvoiceId?: string; amountUSD: number }>;
    if (!Array.isArray(value) || value.length > 50) throw new ConflictException('allocations is invalid.');
    return value.map((raw: any, index) => {
      const targets = ['salesInvoiceId', 'purchaseInvoiceId', 'returnInvoiceId'].filter(key => raw?.[key]);
      if (targets.length !== 1) throw new ConflictException(`allocations[${index}] must reference exactly one document.`);
      return { [targets[0]!]: uuid(raw[targets[0]!], `allocations[${index}].${targets[0]}`), amountUSD: Number(number(raw.amountUSD ?? raw.amountUsd, `allocations[${index}].amountUSD`, 4, 0.0001)) } as any;
    });
  }

  private text(value: unknown, field: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} is invalid.`); return value.trim(); }
  private optional(value: unknown, max: number) { return value === undefined || value === null || value === '' ? null : this.text(value, 'note', max); }
  private page(value: unknown) { const parsed = Number(value ?? 1); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1; }
  private limit(value: unknown) { const parsed = Number(value ?? 30); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 30; }
}
