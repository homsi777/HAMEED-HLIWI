import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { publicImageUrl } from '../config/upload-path.js';
import { inventoryItems, inventoryMovements, stocktakes } from '../database/schema.js';
import type { AuthIdentity } from '../auth/auth.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';

const karats = new Set(['24', '22', '21', '18', '14']);
const categories = new Set(['أطقم', 'خواتم ومحابس', 'أساور ومبارم', 'قلائد وسلاسل', 'أقراط', 'سبائك وليرات', 'ذهب كسر', 'متنوع']);
const decimal = (value: unknown, name: string, minimum = 0) => { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < minimum || !/^\d+(\.\d{1,3})?$/.test(String(value))) throw new ConflictException(`${name} is invalid.`); return parsed.toFixed(3); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value: unknown, name: string) => { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new ConflictException(`${name} is invalid.`); return parsed.toFixed(4); };
// TASK 17 §11–§14: where a piece came from, derived from records that already exist.
export type ItemOrigin = 'purchase' | 'direct' | 'historical' | 'used_gold';
const ORIGIN_LABEL: Record<ItemOrigin, string> = {
  purchase: 'من فاتورة شراء',
  direct: 'إدخال مباشر للمخزون',
  historical: 'من فاتورة بيع',
  // §17: what sits in inventory is the converted metal, never the unconverted scrap, which stays
  // in the gold domain and is not stock at all.
  used_gold: 'ذهب مستعمل — من كسر مقايضة',
};

/**
 * §12/§13: one rule, in one place, reading only authoritative records — no migration.
 *
 * §14: origin is the *first* movement, so a piece bought and later transferred between branches
 * is still a purchase. Transfer is movement history, not provenance.
 */
const originOf = (item: typeof inventoryItems.$inferSelect, firstMovementType?: string): ItemOrigin =>
  item.isManualSaleEntry ? 'historical'
    : (item.condition === 'used' && item.sourceType === 'gold_scrap_conversion') || firstMovementType === 'gold_used_conversion' ? 'used_gold'
    : firstMovementType === 'purchase' ? 'purchase'
    : 'direct';

const itemDto = (item: typeof inventoryItems.$inferSelect, provenance?: { type?: string; documentNumber?: string | null }) => {
  const origin = originOf(item, provenance?.type);
  const document = provenance?.documentNumber ?? null;
  return { ...item, grossWeightGrams: Number(item.grossWeightGrams), stoneWeightGrams: Number(item.stoneWeightGrams), netWeightGrams: Number(item.netWeightGrams), quantity: Number(item.quantity), laborFeeUSDPerGram: Number(item.laborFeeUsdPerGram), totalLaborFeeUSD: Number(item.totalLaborFeeUsd), imageUrl: publicImageUrl(item.imagePath, item.updatedAt),
    origin,
    sourceDocumentNumber: document,
    // The line the card shows: the origin, and the document behind it when there is one.
    sourceDescription: document && (origin === 'purchase' || origin === 'historical') ? `${ORIGIN_LABEL[origin]} ${document}` : ORIGIN_LABEL[origin] };
};

@Injectable()
export class InventoryService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService, @Inject(AuditService) private readonly audit: AuditService, @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway) {}

  async list(user: AuthIdentity, query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page ?? 1) || 1); const limit = Math.min(100, Math.max(1, Number(query.limit ?? 30) || 30));
    const warehouseId = typeof query.warehouseId === 'string' ? query.warehouseId : undefined;
    if (warehouseId) this.scope.assertAccess(user, warehouseId);
    const conditions = [isNull(inventoryItems.archivedAt)];
    if (warehouseId) conditions.push(eq(inventoryItems.warehouseId, warehouseId)); else if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; if (!ids.length) return { items: [], meta: { page, limit, total: 0 } }; conditions.push(inArray(inventoryItems.warehouseId, ids)); }
    if (typeof query.status === 'string' && ['in_stock', 'reserved', 'sold'].includes(query.status)) conditions.push(eq(inventoryItems.status, query.status as 'in_stock' | 'reserved' | 'sold')); else if (!query.status) conditions.push(eq(inventoryItems.status, 'in_stock'));
    if (typeof query.karat === 'string' && karats.has(query.karat)) conditions.push(eq(inventoryItems.karat, query.karat));
    if (typeof query.category === 'string' && query.category.length) conditions.push(eq(inventoryItems.category, query.category));
    if (typeof query.search === 'string' && query.search.trim()) { const pattern = `%${query.search.trim()}%`; conditions.push(or(ilike(inventoryItems.code, pattern), ilike(inventoryItems.name, pattern))!); }
    const sortMap = { createdAt: inventoryItems.createdAt, code: inventoryItems.code, netWeightGrams: inventoryItems.netWeightGrams, category: inventoryItems.category, karat: inventoryItems.karat } as const;
    const sort = typeof query.sort === 'string' && query.sort in sortMap ? query.sort as keyof typeof sortMap : 'createdAt'; const order = query.order === 'asc' ? asc(sortMap[sort]) : desc(sortMap[sort]);
    // §18: filtering by origin happens on the server so it survives pagination. The same rule the
    // DTO uses is expressed here in SQL, with the first movement resolved per row.
    const firstMovementType = sql`(select earliest.type from inventory_movements earliest where earliest.inventory_item_id = ${inventoryItems.id} order by earliest.created_at asc, earliest.id asc limit 1)`;
    const usedGold = sql`((${inventoryItems.condition} = 'used' and ${inventoryItems.sourceType} = 'gold_scrap_conversion') or ${firstMovementType} = 'gold_used_conversion')`;
    if (typeof query.origin === 'string' && query.origin !== 'all') {
      if (query.origin === 'historical') conditions.push(eq(inventoryItems.isManualSaleEntry, true));
      else if (query.origin === 'used_gold') conditions.push(and(eq(inventoryItems.isManualSaleEntry, false), usedGold)!);
      else if (query.origin === 'purchase') conditions.push(and(eq(inventoryItems.isManualSaleEntry, false), sql`not ${usedGold}`, sql`${firstMovementType} = 'purchase'`)!);
      else if (query.origin === 'direct') conditions.push(and(eq(inventoryItems.isManualSaleEntry, false), sql`not ${usedGold}`, sql`coalesce(${firstMovementType}::text, '') <> 'purchase'`)!);
    }

    const where = and(...conditions); const [rows, count] = await Promise.all([this.db.select().from(inventoryItems).where(where).orderBy(order).limit(limit).offset((page - 1) * limit), this.db.select({ count: sql<number>`count(*)` }).from(inventoryItems).where(where)]);
    // §66-style: one grouped lookup for the whole page rather than one per row.
    const provenance = await this.provenance(rows.map(row => row.id));
    return { items: rows.map(row => itemDto(row, provenance.get(row.id))), meta: { page, limit, total: Number(count[0]?.count ?? 0) } };
  }

  async get(user: AuthIdentity, id: string) { const item = await this.findAccessible(user, this.uuid(id, 'id')); return itemDto(item, (await this.provenance([item.id])).get(item.id)); }

  /**
   * §13/§14: the first movement of each item, with the document behind it. One query for a whole
   * page — `distinct on` picks the earliest row per item, which is what makes a later transfer
   * unable to overwrite where the piece actually came from.
   */
  private async provenance(itemIds: string[]) {
    const found = new Map<string, { type: string; documentNumber: string | null }>();
    if (!itemIds.length) return found;
    const rows = await this.db.execute(sql`
      select distinct on (movement.inventory_item_id)
             movement.inventory_item_id as item_id,
             movement.type::text        as type,
             coalesce(purchase.purchase_number, sale.invoice_number) as document_number
        from inventory_movements movement
        left join purchase_invoices purchase on purchase.id = movement.purchase_invoice_id
        left join sales_invoices    sale     on sale.id     = movement.sales_invoice_id
       where movement.inventory_item_id in (${sql.join(itemIds.map(value => sql`${value}::uuid`), sql`, `)})
       order by movement.inventory_item_id, movement.created_at asc, movement.id asc`);
    for (const row of rows as unknown as Array<{ item_id: string; type: string; document_number: string | null }>) {
      found.set(row.item_id, { type: row.type, documentNumber: row.document_number });
    }
    return found;
  }

  async create(user: AuthIdentity, input: Record<string, unknown>) {
    this.scope.assertAccess(user, this.uuid(this.text(input.warehouseId, 'warehouseId'), 'warehouseId')); const values = this.values(input);
    try { const row = await this.db.transaction(async tx => { const created = (await tx.insert(inventoryItems).values({ ...values, createdByUserId: user.id, updatedByUserId: user.id }).returning())[0]!; await tx.insert(inventoryMovements).values({ inventoryItemId: created.id, type: 'initial', toWarehouseId: created.warehouseId, actorUserId: user.id, note: this.optional(input.notes) }); return created; }); await this.audit.record({ actorUserId: user.id, action: 'inventory.create', module: 'inventory', entityId: row.id, warehouseId: row.warehouseId }); this.realtime.emitToWarehouse(row.warehouseId, 'inventory.created', { id: row.id }); return itemDto(row); } catch (error: any) { if (error?.code === '23505' || error?.cause?.code === '23505') throw new ConflictException('Item code already exists.'); throw error; }
  }

  async update(user: AuthIdentity, id: string, input: Record<string, unknown>) {
    id = this.uuid(id, 'id'); const current = await this.findAccessible(user, id); const expected = Number(input.version); if (!Number.isInteger(expected) || expected !== current.version) throw new ConflictException('Inventory item changed by another user. Reload and retry.');
    const values = this.values({ ...current, ...input, warehouseId: current.warehouseId }); const updated = await this.db.update(inventoryItems).set({ ...values, version: sql`${inventoryItems.version} + 1`, updatedByUserId: user.id, updatedAt: new Date() }).where(and(eq(inventoryItems.id, id), eq(inventoryItems.version, expected))).returning();
    if (!updated[0]) throw new ConflictException('Inventory item changed by another user.'); await this.audit.record({ actorUserId: user.id, action: 'inventory.update', module: 'inventory', entityId: id, warehouseId: current.warehouseId }); this.realtime.emitToWarehouse(current.warehouseId, 'inventory.updated', { id }); return itemDto(updated[0]);
  }

  async archive(user: AuthIdentity, id: string, version: number) { id = this.uuid(id, 'id'); const current = await this.findAccessible(user, id); if (version !== current.version) throw new ConflictException('Inventory item changed by another user.'); const rows = await this.db.update(inventoryItems).set({ archivedAt: new Date(), archivedByUserId: user.id, updatedByUserId: user.id, version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, id), eq(inventoryItems.version, version))).returning(); if (!rows[0]) throw new ConflictException('Inventory item changed by another user.'); await this.audit.record({ actorUserId: user.id, action: 'inventory.archive', module: 'inventory', entityId: id, warehouseId: current.warehouseId }); this.realtime.emitToWarehouse(current.warehouseId, 'inventory.archived', { id }); return { success: true }; }

  async transfer(user: AuthIdentity, id: string, input: Record<string, unknown>) { id = this.uuid(id, 'id'); const destination = this.uuid(this.text(input.destinationWarehouseId, 'destinationWarehouseId'), 'destinationWarehouseId'); this.scope.assertAccess(user, destination); const expected = Number(input.version); return this.db.transaction(async tx => { const current = (await tx.select().from(inventoryItems).where(and(eq(inventoryItems.id, id), isNull(inventoryItems.archivedAt))).limit(1))[0]; if (!current) throw new NotFoundException('Inventory item not found.'); this.scope.assertAccess(user, current.warehouseId); if (expected !== current.version) throw new ConflictException('Inventory item changed by another user.'); if (current.warehouseId === destination) throw new ConflictException('Destination warehouse is the current warehouse.'); const updated = (await tx.update(inventoryItems).set({ warehouseId: destination, version: sql`${inventoryItems.version} + 1`, updatedByUserId: user.id, updatedAt: new Date() }).where(and(eq(inventoryItems.id, id), eq(inventoryItems.version, expected))).returning())[0]; if (!updated) throw new ConflictException('Inventory item changed by another user.'); await tx.insert(inventoryMovements).values({ inventoryItemId: id, type: 'transfer', fromWarehouseId: current.warehouseId, toWarehouseId: destination, actorUserId: user.id, note: this.optional(input.note) }); await this.audit.record({ actorUserId: user.id, action: 'inventory.transfer', module: 'inventory', entityId: id, warehouseId: destination, metadata: { fromWarehouseId: current.warehouseId, toWarehouseId: destination } }); this.realtime.emitToWarehouse(current.warehouseId, 'inventory.transferred', { id, fromWarehouseId: current.warehouseId }); this.realtime.emitToWarehouse(destination, 'inventory.transferred', { id, toWarehouseId: destination }); return itemDto(updated); }); }

  async movements(user: AuthIdentity, id: string) { id = this.uuid(id, 'id'); await this.findAccessible(user, id); return this.db.select().from(inventoryMovements).where(eq(inventoryMovements.inventoryItemId, id)).orderBy(desc(inventoryMovements.createdAt)); }
  async stocktake(user: AuthIdentity, warehouseId: string) { warehouseId = this.uuid(warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); const rows = await this.db.select().from(inventoryItems).where(and(eq(inventoryItems.warehouseId, warehouseId), eq(inventoryItems.status, 'in_stock'), isNull(inventoryItems.archivedAt))); const snapshot = rows.map(row => itemDto(row)); const netWeight = snapshot.reduce((sum, row) => sum + row.netWeightGrams, 0).toFixed(3); const created = (await this.db.insert(stocktakes).values({ warehouseId, actorUserId: user.id, itemCount: snapshot.length, netWeightGrams: netWeight, snapshot }).returning())[0]!; await this.audit.record({ actorUserId: user.id, action: 'inventory.stocktake', module: 'inventory', entityId: created.id, warehouseId }); return created; }
  async stocktakesFor(user: AuthIdentity, warehouseId?: string) { if (warehouseId) { warehouseId = this.uuid(warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); } const conditions = warehouseId ? [eq(stocktakes.warehouseId, warehouseId)] : this.scope.canAccessAll(user) ? [] : [inArray(stocktakes.warehouseId, this.scope.allowedWarehouseIds(user) ?? [])]; return this.db.select().from(stocktakes).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(stocktakes.createdAt)).limit(50); }

  private async findAccessible(user: AuthIdentity, id: string, db: Database = this.db) { const item = (await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, id), isNull(inventoryItems.archivedAt))).limit(1))[0]; if (!item) throw new NotFoundException('Inventory item not found.'); this.scope.assertAccess(user, item.warehouseId); return item; }
  private text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) throw new ConflictException(`${field} is required.`); return value.trim(); }
  private uuid(value: string, field: string) { if (!uuid.test(value)) throw new ConflictException(`${field} must be a valid UUID.`); return value; }
  private optional(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : null; }
  private values(input: Record<string, unknown>) { const code = this.text(input.code, 'code'); const name = this.text(input.name, 'name'); const category = this.text(input.category, 'category'); const karat = this.text(input.karat, 'karat'); if (!categories.has(category) || !karats.has(karat)) throw new ConflictException('Category or karat is invalid.'); const inventoryMode: 'individual' | 'aggregate' = input.inventoryMode === 'aggregate' ? 'aggregate' : 'individual'; const gross = decimal(input.grossWeightGrams, 'grossWeightGrams', inventoryMode === 'aggregate' ? 0 : 0.001); const stone = decimal(input.stoneWeightGrams ?? '0', 'stoneWeightGrams'); const net = Number(gross) - Number(stone); if (net < 0) throw new ConflictException('Stone weight cannot exceed gross weight.'); const quantityRaw = input.quantity ?? (inventoryMode === 'aggregate' ? '0' : '1'); const quantity = decimal(quantityRaw, 'quantity', inventoryMode === 'aggregate' ? 0 : 0.001); if (inventoryMode === 'individual' && Number(quantity) <= 0) throw new ConflictException('Individual item quantity must be positive.'); const labor = money(input.laborFeeUSDPerGram ?? input.laborFeeUsdPerGram ?? '0', 'laborFeeUSDPerGram'); const total = (net * Number(labor)).toFixed(4); const status: 'in_stock' | 'reserved' | 'sold' = input.status === 'reserved' || input.status === 'sold' ? input.status : 'in_stock'; return { code, name, category, karat, inventoryMode, quantity, grossWeightGrams: gross, stoneWeightGrams: stone, netWeightGrams: net.toFixed(3), laborFeeUsdPerGram: labor, totalLaborFeeUsd: total, warehouseId: this.uuid(this.text(input.warehouseId, 'warehouseId'), 'warehouseId'), status, notes: this.optional(input.notes), imagePath: typeof input.imagePath === 'string' ? input.imagePath : null }; }
}
