import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  auditLogs, cashMovements, cashboxes, goldAccounts, goldLedgerEntries, goldTransactions, goldPrices, inventoryItems,
  partnerLedgerEntries, partners, purchaseInvoices, returnInvoiceItems, returnInvoices, salesInvoiceItems, salesInvoices,
  shifts, users, warehouses, weightCustodyPeople,
} from '../database/schema.js';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KARATS = ['24', '22', '21', '18', '14'] as const;
/** Pure gold content of one gram at a given karat — the only figure karats may legitimately share. */
const PURITY: Record<string, number> = { '24': 1, '22': 22 / 24, '21': 21 / 24, '18': 18 / 24, '14': 14 / 24 };

const money = (value: unknown) => Number(Number(value ?? 0).toFixed(4));
const grams = (value: unknown) => Number(Number(value ?? 0).toFixed(3));

/**
 * TASK 19: operational reports.
 *
 * Three rules shape every method here, and each exists because breaking it produces a number that
 * looks authoritative and is wrong.
 *
 * 1. **Derived, never stored.** Everything is computed from the authoritative records at read
 *    time. There is no rollup table and no cached total, which is why these figures reconcile
 *    against the modules they summarise.
 * 2. **Currencies are never summed and karats are never merged.** USD and SYP sit side by side.
 *    Where a single weight is genuinely needed it is stated in pure gold and labelled as such.
 * 3. **No cost, no profit, no valuation.** TASK 16 is deferred and production has almost no
 *    purchased stock, so a gross-profit figure would have no basis. Workmanship revenue is
 *    reported because it is a recorded fact on every sale line — under its own name, never as
 *    "profit".
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService,
  ) {}

  // ---------------------------------------------------------------- shared filters

  /**
   * §6: the warehouse filter comes from the caller's own scope. A `warehouseId` in the query may
   * narrow a manager to a branch they already hold and is refused outright otherwise — it can
   * never widen anyone's view.
   */
  private warehouseIds(user: AuthIdentity, query: Record<string, unknown>): string[] | null {
    const requested = typeof query.warehouseId === 'string' && query.warehouseId ? query.warehouseId : undefined;
    if (requested) {
      if (!UUID.test(requested)) throw new ConflictException('warehouseId is invalid.');
      this.scope.assertAccess(user, requested);
      return [requested];
    }
    return this.scope.allowedWarehouseIds(user);
  }

  /** Inclusive day boundaries; an absent bound simply does not constrain that end. */
  private range(query: Record<string, unknown>) {
    const parse = (value: unknown, endOfDay: boolean) => {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      const stamp = Date.parse(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
      if (Number.isNaN(stamp)) throw new ConflictException('The date range is invalid.');
      return new Date(stamp);
    };
    const from = parse(query.from ?? query.dateFrom, false);
    const to = parse(query.to ?? query.dateTo, true);
    if (from && to && from > to) throw new ConflictException('The date range is invalid.');
    return { from, to };
  }

  private conditions(column: any, dateColumn: any, ids: string[] | null, query: Record<string, unknown>) {
    const { from, to } = this.range(query);
    const list: any[] = [];
    if (ids) { if (!ids.length) return null; list.push(inArray(column, ids)); }
    if (from) list.push(gte(dateColumn, from));
    if (to) list.push(lte(dateColumn, to));
    return list;
  }

  private karat(query: Record<string, unknown>) {
    const value = typeof query.karat === 'string' ? query.karat : '';
    if (!value) return undefined;
    if (!KARATS.includes(value as typeof KARATS[number])) throw new ConflictException('karat is invalid.');
    return value;
  }

  private sellerId(query: Record<string, unknown>) {
    const value = typeof query.sellerId === 'string' && query.sellerId ? query.sellerId : undefined;
    if (value && !UUID.test(value)) throw new ConflictException('sellerId is invalid.');
    return value;
  }

  private empty = { meta: { scoped: true }, rows: [] as unknown[] };

  // ---------------------------------------------------------------- sales

  /**
   * §9: sales for a period, with the karat breakdown alongside.
   *
   * §33: cancelled invoices are excluded from every total and reported as a separate count, so a
   * reader can see they exist rather than wonder where the difference went.
   */
  async sales(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const base = this.conditions(salesInvoices.warehouseId, salesInvoices.createdAt, ids, query);
    if (!base) return { totals: null, byKarat: [], cancelled: { count: 0, valueUSD: 0 } };
    const seller = this.sellerId(query);
    if (seller) base.push(eq(salesInvoices.createdByUserId, seller));

    const posted = and(...base, eq(salesInvoices.status, 'posted'))!;
    const cancelled = and(...base, eq(salesInvoices.status, 'cancelled'))!;

    const [totalsRow] = await this.db.select({
      invoices: sql<number>`count(*)::int`,
      valueUSD: sql<string>`coalesce(sum(${salesInvoices.finalTotalUsd}), 0)`,
      valueSYP: sql<string>`coalesce(sum(${salesInvoices.finalTotalSyp}), 0)`,
      paidUSD: sql<string>`coalesce(sum(${salesInvoices.paidUsd}), 0)`,
      paidSYP: sql<string>`coalesce(sum(${salesInvoices.paidSyp}), 0)`,
      outstandingUSD: sql<string>`coalesce(sum(${salesInvoices.remainingDebtUsd}), 0)`,
    }).from(salesInvoices).where(posted);

    const [cancelledRow] = await this.db.select({
      count: sql<number>`count(*)::int`,
      valueUSD: sql<string>`coalesce(sum(${salesInvoices.finalTotalUsd}), 0)`,
    }).from(salesInvoices).where(cancelled);

    const karat = this.karat(query);
    const lineWhere = karat ? and(posted, eq(salesInvoiceItems.karatSnapshot, karat))! : posted;
    const byKarat = await this.db.select({
      karat: salesInvoiceItems.karatSnapshot,
      lines: sql<number>`count(*)::int`,
      pieces: sql<string>`coalesce(sum(${salesInvoiceItems.quantity}), 0)`,
      weightGrams: sql<string>`coalesce(sum(${salesInvoiceItems.netWeightGrams}), 0)`,
      goldValueUSD: sql<string>`coalesce(sum(${salesInvoiceItems.goldValueUsd}), 0)`,
      workmanshipUSD: sql<string>`coalesce(sum(${salesInvoiceItems.workmanshipValueUsd}), 0)`,
    }).from(salesInvoiceItems).innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceItems.salesInvoiceId))
      .where(lineWhere).groupBy(salesInvoiceItems.karatSnapshot);

    // §34: a sale of 50 g with a 20 g return must not read as 50 g sold. Returned weight is
    // subtracted per karat rather than netted into one figure.
    const returned = await this.returnedWeightByKarat(ids, query, 'sales_return');

    return {
      totals: {
        invoices: totalsRow?.invoices ?? 0,
        valueUSD: money(totalsRow?.valueUSD), valueSYP: money(totalsRow?.valueSYP),
        paidUSD: money(totalsRow?.paidUSD), paidSYP: money(totalsRow?.paidSYP),
        outstandingUSD: money(totalsRow?.outstandingUSD),
      },
      byKarat: byKarat.map(row => {
        const back = returned.get(row.karat) ?? { weightGrams: 0, pieces: 0 };
        return {
          karat: row.karat, lines: row.lines,
          pieces: grams(row.pieces), returnedPieces: grams(back.pieces),
          soldWeightGrams: grams(row.weightGrams), returnedWeightGrams: grams(back.weightGrams),
          netWeightGrams: grams(Number(row.weightGrams) - back.weightGrams),
          goldValueUSD: money(row.goldValueUSD), workmanshipUSD: money(row.workmanshipUSD),
        };
      }).sort((a, b) => Number(b.karat) - Number(a.karat)),
      cancelled: { count: cancelledRow?.count ?? 0, valueUSD: money(cancelledRow?.valueUSD) },
    };
  }

  /** Weight returned in the period, per karat, so it can be subtracted rather than merged away. */
  private async returnedWeightByKarat(ids: string[] | null, query: Record<string, unknown>, type: 'sales_return' | 'purchase_return') {
    const conditions = this.conditions(returnInvoices.warehouseId, returnInvoices.createdAt, ids, query);
    const map = new Map<string, { weightGrams: number; pieces: number }>();
    if (!conditions) return map;
    const rows = await this.db.select({
      karat: returnInvoiceItems.karatSnapshot,
      weight: sql<string>`coalesce(sum(${returnInvoiceItems.netWeightGrams}), 0)`,
      pieces: sql<string>`coalesce(sum(${returnInvoiceItems.quantity}), 0)`,
    }).from(returnInvoiceItems)
      .innerJoin(returnInvoices, eq(returnInvoices.id, returnInvoiceItems.returnInvoiceId))
      .where(and(...conditions, eq(returnInvoices.type, type), eq(returnInvoices.status, 'posted'))!)
      .groupBy(returnInvoiceItems.karatSnapshot);
    for (const row of rows) map.set(row.karat, { weightGrams: Number(row.weight), pieces: Number(row.pieces) });
    return map;
  }

  /** §10: per partner. Tapping a row opens the TASK 17 customer workspace rather than a new screen. */
  async salesByCustomer(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const base = this.conditions(salesInvoices.warehouseId, salesInvoices.createdAt, ids, query);
    if (!base) return [];
    const rows = await this.db.select({
      partnerId: salesInvoices.customerPartnerId, partnerName: partners.name, partnerType: partners.type,
      invoices: sql<number>`count(*)::int`,
      valueUSD: sql<string>`coalesce(sum(${salesInvoices.finalTotalUsd}), 0)`,
      paidUSD: sql<string>`coalesce(sum(${salesInvoices.paidUsd}), 0)`,
      outstandingUSD: sql<string>`coalesce(sum(${salesInvoices.remainingDebtUsd}), 0)`,
      lastAt: sql<Date>`max(${salesInvoices.createdAt})`,
    }).from(salesInvoices).innerJoin(partners, eq(partners.id, salesInvoices.customerPartnerId))
      .where(and(...base, eq(salesInvoices.status, 'posted'))!)
      .groupBy(salesInvoices.customerPartnerId, partners.name, partners.type)
      .orderBy(sql`coalesce(sum(${salesInvoices.finalTotalUsd}), 0) desc`).limit(200);

    return rows.map(row => ({
      partnerId: row.partnerId, partnerName: row.partnerName, partnerType: row.partnerType,
      invoices: row.invoices, valueUSD: money(row.valueUSD), paidUSD: money(row.paidUSD),
      outstandingUSD: money(row.outstandingUSD),
      lastAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
    }));
  }

  // ---------------------------------------------------------------- purchases

  /** §12: the mirror of sales. Counterparties whose master role is `customer` belong here too. */
  async purchases(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const base = this.conditions(purchaseInvoices.warehouseId, purchaseInvoices.createdAt, ids, query);
    if (!base) return { totals: null, byPartner: [], cancelled: { count: 0, valueUSD: 0 } };

    const posted = and(...base, eq(purchaseInvoices.status, 'posted'))!;
    const [totals] = await this.db.select({
      invoices: sql<number>`count(*)::int`,
      valueUSD: sql<string>`coalesce(sum(${purchaseInvoices.finalTotalUsd}), 0)`,
      paidUSD: sql<string>`coalesce(sum(${purchaseInvoices.paidUsd}), 0)`,
      outstandingUSD: sql<string>`coalesce(sum(${purchaseInvoices.remainingDebtUsd}), 0)`,
    }).from(purchaseInvoices).where(posted);

    const [cancelled] = await this.db.select({
      count: sql<number>`count(*)::int`,
      valueUSD: sql<string>`coalesce(sum(${purchaseInvoices.finalTotalUsd}), 0)`,
    }).from(purchaseInvoices).where(and(...base, eq(purchaseInvoices.status, 'cancelled'))!);

    const byPartner = await this.db.select({
      partnerId: purchaseInvoices.supplierPartnerId, partnerName: partners.name, partnerType: partners.type,
      invoices: sql<number>`count(*)::int`,
      valueUSD: sql<string>`coalesce(sum(${purchaseInvoices.finalTotalUsd}), 0)`,
      outstandingUSD: sql<string>`coalesce(sum(${purchaseInvoices.remainingDebtUsd}), 0)`,
    }).from(purchaseInvoices).innerJoin(partners, eq(partners.id, purchaseInvoices.supplierPartnerId))
      .where(posted).groupBy(purchaseInvoices.supplierPartnerId, partners.name, partners.type)
      .orderBy(sql`coalesce(sum(${purchaseInvoices.finalTotalUsd}), 0) desc`).limit(200);

    return {
      totals: totals ? { invoices: totals.invoices, valueUSD: money(totals.valueUSD), paidUSD: money(totals.paidUSD), outstandingUSD: money(totals.outstandingUSD) } : null,
      byPartner: byPartner.map(row => ({ ...row, valueUSD: money(row.valueUSD), outstandingUSD: money(row.outstandingUSD) })),
      cancelled: { count: cancelled?.count ?? 0, valueUSD: money(cancelled?.valueUSD) },
    };
  }

  // ---------------------------------------------------------------- workmanship

  /**
   * §13: workmanship revenue — a recorded figure on every sale line, reported under its own name.
   *
   * This is **not** the shop's profit and the response deliberately carries no field that could be
   * read as one. Gross profit on the gold needs an acquisition cost, which TASK 16 defers and
   * which almost no item in production has.
   */
  async workmanship(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const base = this.conditions(salesInvoices.warehouseId, salesInvoices.createdAt, ids, query);
    if (!base) return { note: 'workmanship revenue only', totalUSD: 0, byKarat: [] };

    const rows = await this.db.select({
      karat: salesInvoiceItems.karatSnapshot,
      weightGrams: sql<string>`coalesce(sum(${salesInvoiceItems.netWeightGrams}), 0)`,
      workmanshipUSD: sql<string>`coalesce(sum(${salesInvoiceItems.workmanshipValueUsd}), 0)`,
    }).from(salesInvoiceItems).innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceItems.salesInvoiceId))
      .where(and(...base, eq(salesInvoices.status, 'posted'))!)
      .groupBy(salesInvoiceItems.karatSnapshot);

    const byKarat = rows.map(row => ({
      karat: row.karat, weightGrams: grams(row.weightGrams), workmanshipUSD: money(row.workmanshipUSD),
    })).sort((a, b) => Number(b.karat) - Number(a.karat));

    return {
      // Carried in the payload so no screen can quietly relabel it.
      note: 'إيراد المصنعية المسجَّل — ليس ربحاً وليس هامشاً',
      totalUSD: money(byKarat.reduce((sum, row) => sum + row.workmanshipUSD, 0)),
      byKarat,
    };
  }

  // ---------------------------------------------------------------- inventory

  /** §14: pieces and weight by karat, warehouse and origin. Weight only — no valuation (§5). */
  async inventory(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    if (ids && !ids.length) return { byKarat: [], byWarehouse: [], byOrigin: [], pureGoldGrams: 0, totalGrossWeightGrams: 0, estimatedSellValueUSD: 0 };
    const scope = ids ? inArray(inventoryItems.warehouseId, ids) : undefined;
    const inStock = and(eq(inventoryItems.status, 'in_stock'), sql`${inventoryItems.archivedAt} is null`, scope)!;

    const byKarat = await this.db.select({
      karat: inventoryItems.karat,
      pieces: sql<string>`coalesce(sum(${inventoryItems.quantity}), 0)`,
      grossWeightGrams: sql<string>`coalesce(sum(${inventoryItems.grossWeightGrams}), 0)`,
      weightGrams: sql<string>`coalesce(sum(${inventoryItems.netWeightGrams}), 0)`,
    }).from(inventoryItems).where(inStock).groupBy(inventoryItems.karat);

    const [estimate] = await this.db.select({
      valueUSD: sql<string>`coalesce(sum(${inventoryItems.netWeightGrams} * coalesce(${goldPrices.sellPriceUsdPerGram}, 0) + ${inventoryItems.totalLaborFeeUsd}), 0)`,
    }).from(inventoryItems).leftJoin(goldPrices, eq(goldPrices.karat, inventoryItems.karat)).where(inStock);

    const byWarehouse = await this.db.select({
      warehouseId: inventoryItems.warehouseId, warehouseName: warehouses.name,
      pieces: sql<string>`coalesce(sum(${inventoryItems.quantity}), 0)`,
      weightGrams: sql<string>`coalesce(sum(${inventoryItems.netWeightGrams}), 0)`,
    }).from(inventoryItems).innerJoin(warehouses, eq(warehouses.id, inventoryItems.warehouseId))
      .where(inStock).groupBy(inventoryItems.warehouseId, warehouses.name);

    // TASK 17 derived provenance server-side; this reuses the same rule rather than re-deriving it.
    const byOrigin = await this.db.execute(sql`
      select case
               when item.is_manual_sale_entry then 'historical'
               when item.condition = 'used' and item.source_type = 'gold_scrap_conversion' then 'used_gold'
               when (select first.type from inventory_movements first where first.inventory_item_id = item.id
                      order by first.created_at asc, first.id asc limit 1) = 'purchase' then 'purchase'
               else 'direct' end as origin,
             count(*)::int as items,
             coalesce(sum(item.net_weight_grams), 0) as weight
        from inventory_items item
       where item.status = 'in_stock' and item.archived_at is null
         ${ids ? sql`and item.warehouse_id in (${sql.join(ids.map(value => sql`${value}::uuid`), sql`, `)})` : sql``}
       group by 1`);

    const karats = byKarat.map(row => ({ karat: row.karat, pieces: grams(row.pieces), grossWeightGrams: grams(row.grossWeightGrams), weightGrams: grams(row.weightGrams) }))
      .sort((a, b) => Number(b.karat) - Number(a.karat));

    return {
      byKarat: karats,
      byWarehouse: byWarehouse.map(row => ({ ...row, pieces: grams(row.pieces), weightGrams: grams(row.weightGrams) })),
      byOrigin: (byOrigin as unknown as Array<{ origin: string; items: number; weight: string }>)
        .map(row => ({ origin: row.origin, items: row.items, weightGrams: grams(row.weight) })),
      // §3: the one figure karats may share, and it is labelled.
      pureGoldGrams: grams(karats.reduce((sum, row) => sum + row.weightGrams * (PURITY[row.karat] ?? 0), 0)),
      totalGrossWeightGrams: grams(karats.reduce((sum, row) => sum + row.grossWeightGrams, 0)),
      estimatedSellValueUSD: money(estimate?.valueUSD),
    };
  }

  // ---------------------------------------------------------------- receivables

  /**
   * §16: from the subledger fixed in TASK 17, never from `partners.opening_balance_usd`.
   *
   * A positive balance means the partner owes the shop, which is the ledger's own convention.
   * Aging buckets the outstanding remainder of posted sales by invoice age.
   */
  async receivables(user: AuthIdentity, query: Record<string, unknown>) {
    // The subledger is summed in its own grouped query and merged here. A correlated `sql`
    // expression mixed into a select alongside table columns does not map back reliably — the
    // same trap TASK 17 hit on this exact table, which is why it is not repeated.
    const ids = this.warehouseIds(user, query);
    if (ids && !ids.length) return { totalOwedToShopUSD: 0, totalOwedByShopUSD: 0, rows: [] };
    const scoped = ids ? inArray(partnerLedgerEntries.warehouseId, ids) : undefined;
    const [partnerRows, ledgerRows, invoiceRows] = await Promise.all([
      // An opening balance belongs to the company, not to an arbitrary branch.  It is
      // therefore shown only to global users until it has an explicit warehouse movement.
      ids ? Promise.resolve([]) : this.db.select({ partnerId: partners.id, partnerName: partners.name, partnerType: partners.type, opening: partners.openingBalanceUsd }).from(partners),
      this.db.select({
        partnerId: partnerLedgerEntries.partnerId,
        net: sql<string>`coalesce(sum(${partnerLedgerEntries.debitUsd} - ${partnerLedgerEntries.creditUsd}), 0)`,
      }).from(partnerLedgerEntries).where(scoped).groupBy(partnerLedgerEntries.partnerId),
      this.db.select({ partnerId: salesInvoices.customerPartnerId, remaining: salesInvoices.remainingDebtUsd, createdAt: salesInvoices.createdAt })
        .from(salesInvoices).where(and(eq(salesInvoices.status, 'posted'), sql`${salesInvoices.remainingDebtUsd} > 0`, ids ? inArray(salesInvoices.warehouseId, ids) : undefined)),
    ]);
    const netByPartner = new Map(ledgerRows.map(row => [row.partnerId, Number(row.net)]));
    const names = new Map(partnerRows.map(row => [row.partnerId, row]));
    if (ids && ledgerRows.length) {
      const scopedPartners = await this.db.select({ partnerId: partners.id, partnerName: partners.name, partnerType: partners.type }).from(partners).where(inArray(partners.id, ledgerRows.map(row => row.partnerId)));
      for (const partner of scopedPartners) names.set(partner.partnerId, { ...partner, opening: '0' });
    }
    const balances = [...names.values()].map(row => ({ ...row, ledger: netByPartner.get(row.partnerId) ?? 0 }));

    const byPartner = new Map<string, any>();
    for (const invoice of invoiceRows) {
      const age = Date.now() - new Date(invoice.createdAt).getTime();
      const key = age <= 30 * 86400000 ? 'bucket_current' : age <= 60 * 86400000 ? 'bucket_30' : age <= 90 * 86400000 ? 'bucket_60' : 'bucket_90';
      const bucket = byPartner.get(invoice.partnerId) ?? { bucket_current: 0, bucket_30: 0, bucket_60: 0, bucket_90: 0 };
      bucket[key] += Number(invoice.remaining);
      byPartner.set(invoice.partnerId, bucket);
    }

    const rows = balances.map(row => {
      const balance = money(Number(row.opening) + Number(row.ledger));
      const bucket = byPartner.get(row.partnerId);
      return {
        partnerId: row.partnerId, partnerName: row.partnerName, partnerType: row.partnerType,
        balanceUSD: balance,
        // Positive is owed to the shop; negative is owed by it. Never added together.
        owedToShopUSD: balance > 0 ? balance : 0,
        owedByShopUSD: balance < 0 ? money(-balance) : 0,
        aging: {
          currentUSD: money(bucket?.bucket_current), days30USD: money(bucket?.bucket_30),
          days60USD: money(bucket?.bucket_60), days90PlusUSD: money(bucket?.bucket_90),
        },
      };
    }).filter(row => row.balanceUSD !== 0);

    return {
      totalOwedToShopUSD: money(rows.reduce((sum, row) => sum + row.owedToShopUSD, 0)),
      totalOwedByShopUSD: money(rows.reduce((sum, row) => sum + row.owedByShopUSD, 0)),
      rows: rows.sort((a, b) => b.owedToShopUSD - a.owedToShopUSD),
    };
  }

  // ---------------------------------------------------------------- cash

  /** §17: each cashbox in its own currency. There is deliberately no combined total. */
  async cash(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const { from, to } = this.range(query);
    const boxes = await this.db.select().from(cashboxes).where(eq(cashboxes.isActive, true));
    const visible = ids ? boxes.filter(box => box.warehouseId && ids.includes(box.warehouseId)) : boxes;

    const movementConditions: any[] = [];
    if (from) movementConditions.push(gte(cashMovements.createdAt, from));
    if (to) movementConditions.push(lte(cashMovements.createdAt, to));

    const totals = await this.db.select({
      cashboxId: cashMovements.cashboxId,
      inflow: sql<string>`coalesce(sum(case when ${cashMovements.direction} = 'inflow' then ${cashMovements.amount} else 0 end), 0)`,
      outflow: sql<string>`coalesce(sum(case when ${cashMovements.direction} = 'outflow' then ${cashMovements.amount} else 0 end), 0)`,
    }).from(cashMovements).where(movementConditions.length ? and(...movementConditions) : undefined).groupBy(cashMovements.cashboxId);

    const closing = await this.db.select({
      cashboxId: cashMovements.cashboxId,
      net: sql<string>`coalesce(sum(case when ${cashMovements.direction} = 'inflow' then ${cashMovements.amount} else -${cashMovements.amount} end), 0)`,
    }).from(cashMovements).groupBy(cashMovements.cashboxId);

    return {
      note: 'كل صندوق بعملته — لا يُجمع الدولار مع الليرة',
      boxes: visible.map(box => {
        const period = totals.find(row => row.cashboxId === box.id);
        const net = closing.find(row => row.cashboxId === box.id);
        return {
          cashboxId: box.id, name: box.name, currency: box.currency, warehouseId: box.warehouseId,
          openingBalance: money(box.openingBalance),
          periodInflow: money(period?.inflow), periodOutflow: money(period?.outflow),
          closingBalance: money(Number(box.openingBalance) + Number(net?.net ?? 0)),
        };
      }),
    };
  }

  // ---------------------------------------------------------------- gold

  /** §19: physical gold and weight custody, per karat, kept as the separate domains they are. */
  async gold(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const scope = ids ? inArray(goldAccounts.warehouseId, ids) : undefined;

    const physical = await this.db.select({
      karat: goldLedgerEntries.karat,
      debit: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams}), 0)`,
      credit: sql<string>`coalesce(sum(${goldLedgerEntries.creditGrams}), 0)`,
    }).from(goldLedgerEntries)
      .innerJoin(goldAccounts, eq(goldAccounts.id, goldLedgerEntries.goldAccountId))
      .innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
      .where(and(eq(goldTransactions.status, 'posted'), sql`${goldAccounts.custodyPersonId} is null`, scope))
      .groupBy(goldLedgerEntries.karat);

    const custody = await this.db.select({
      personId: weightCustodyPeople.id, name: weightCustodyPeople.displayName, partnerId: weightCustodyPeople.partnerId,
      karat: goldLedgerEntries.karat,
      handedOut: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams}), 0)`,
      receivedBack: sql<string>`coalesce(sum(${goldLedgerEntries.creditGrams}), 0)`,
    }).from(weightCustodyPeople)
      .innerJoin(goldAccounts, eq(goldAccounts.custodyPersonId, weightCustodyPeople.id))
      .innerJoin(goldLedgerEntries, eq(goldLedgerEntries.goldAccountId, goldAccounts.id))
      .innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
      .where(and(eq(goldTransactions.status, 'posted'), scope))
      .groupBy(weightCustodyPeople.id, weightCustodyPeople.displayName, weightCustodyPeople.partnerId, goldLedgerEntries.karat);

    const people = new Map<string, any>();
    for (const row of custody) {
      const entry = people.get(row.personId) ?? { personId: row.personId, name: row.name, partnerId: row.partnerId, balances: [] };
      entry.balances.push({ karat: row.karat, outstandingGrams: grams(Number(row.handedOut) - Number(row.receivedBack)) });
      people.set(row.personId, entry);
    }

    // A positive partner balance is gold the partner owes the shop. It is kept per karat;
    // combining different karats into one raw-gram number would be misleading.
    const partnerRows = await this.db.select({
      karat: goldLedgerEntries.karat,
      grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)`,
    }).from(goldAccounts)
      .innerJoin(goldLedgerEntries, eq(goldLedgerEntries.goldAccountId, goldAccounts.id))
      .innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
      .where(and(eq(goldAccounts.kind, 'partner'), eq(goldTransactions.status, 'posted'), ids ? inArray(goldLedgerEntries.warehouseId, ids) : undefined))
      .groupBy(goldLedgerEntries.karat);

    return {
      note: 'الذهب الفعلي وذمم الأوزان نطاقان منفصلان ولا يُجمعان',
      physicalByKarat: physical.map(row => ({ karat: row.karat, grams: grams(Number(row.debit) - Number(row.credit)) }))
        .sort((a, b) => Number(b.karat) - Number(a.karat)),
      custody: [...people.values()].map(person => ({ ...person, balances: person.balances.filter((row: any) => row.outstandingGrams !== 0) }))
        .filter(person => person.balances.length),
      partnerOwedToShopByKarat: partnerRows.map(row => ({ karat: row.karat, grams: grams(row.grams) })).filter(row => row.grams > 0)
        .sort((a, b) => Number(b.karat) - Number(a.karat)),
    };
  }

  /** Latest persisted audit events; dashboard history must never come from browser storage. */
  async activity(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    if (ids && !ids.length) return [];
    const rawLimit = Number(query.limit ?? 5);
    const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.floor(rawLimit))) : 5;
    const scope = ids ? inArray(auditLogs.warehouseId, ids) : undefined;
    const rows = await this.db.select({
      id: auditLogs.id, action: auditLogs.action, module: auditLogs.module, createdAt: auditLogs.createdAt,
      actorName: users.fullName, warehouseName: warehouses.name,
    }).from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .leftJoin(warehouses, eq(warehouses.id, auditLogs.warehouseId))
      .where(scope).orderBy(desc(auditLogs.createdAt)).limit(limit);
    return rows.map(row => ({ ...row, actorName: row.actorName ?? 'النظام', warehouseName: row.warehouseName ?? null, createdAt: row.createdAt.toISOString() }));
  }

  // ---------------------------------------------------------------- shifts

  /** §20: what TASK 11 already computes per shift, presented across a period. */
  async shifts(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const base = this.conditions(shifts.warehouseId, shifts.openedAt, ids, query);
    if (!base) return [];
    const rows = await this.db.select({
      id: shifts.id, number: shifts.shiftNumber, status: shifts.status,
      sellerId: shifts.sellerUserId, sellerName: users.fullName,
      warehouseId: shifts.warehouseId, warehouseName: warehouses.name,
      openedAt: shifts.openedAt, closedAt: shifts.closedAt,
    }).from(shifts)
      .innerJoin(users, eq(users.id, shifts.sellerUserId))
      .innerJoin(warehouses, eq(warehouses.id, shifts.warehouseId))
      .where(and(...base)!).orderBy(sql`${shifts.openedAt} desc`).limit(100);

    return rows.map(row => ({
      ...row,
      openedAt: row.openedAt ? new Date(row.openedAt).toISOString() : null,
      closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
    }));
  }

  // ---------------------------------------------------------------- timeline

  /**
   * A real daily series for the dashboard chart.
   *
   * This exists because the dashboard was drawing a hardcoded week of invented sales figures with
   * only the last point real. A chart that looks like data and is not is worse than no chart.
   */
  async salesTimeline(user: AuthIdentity, query: Record<string, unknown>) {
    const ids = this.warehouseIds(user, query);
    const days = Math.min(90, Math.max(1, Number(query.days ?? 14) || 14));
    if (ids && !ids.length) return [];
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);

    const scope = ids ? inArray(salesInvoices.warehouseId, ids) : undefined;
    const sales = await this.db.select({
      day: sql<string>`to_char(${salesInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      valueUSD: sql<string>`coalesce(sum(${salesInvoices.finalTotalUsd}), 0)`,
      invoices: sql<number>`count(*)::int`,
    }).from(salesInvoices)
      .where(and(eq(salesInvoices.status, 'posted'), gte(salesInvoices.createdAt, since), scope))
      .groupBy(sql`to_char(${salesInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`);

    const purchaseScope = ids ? inArray(purchaseInvoices.warehouseId, ids) : undefined;
    const purchases = await this.db.select({
      day: sql<string>`to_char(${purchaseInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      valueUSD: sql<string>`coalesce(sum(${purchaseInvoices.finalTotalUsd}), 0)`,
    }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.status, 'posted'), gte(purchaseInvoices.createdAt, since), purchaseScope))
      .groupBy(sql`to_char(${purchaseInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`);

    const saleByDay = new Map(sales.map(row => [row.day, row]));
    const purchaseByDay = new Map(purchases.map(row => [row.day, row]));
    // Every day in the window is present, including the quiet ones. A gap silently closed up
    // makes a slow week look like a busy one.
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(since.getTime() + index * 86400000).toISOString().slice(0, 10);
      return {
        date,
        salesUSD: money(saleByDay.get(date)?.valueUSD),
        purchasesUSD: money(purchaseByDay.get(date)?.valueUSD),
        invoices: saleByDay.get(date)?.invoices ?? 0,
      };
    });
  }

  // ---------------------------------------------------------------- overview

  /** §8: the manager's first screen. Headline figures only, each from its own report. */
  async overview(user: AuthIdentity, query: Record<string, unknown>) {
    const [sales, inventory, receivables, cash, gold] = await Promise.all([
      this.sales(user, query), this.inventory(user, query), this.receivables(user, query),
      this.cash(user, query), this.gold(user, query),
    ]);
    return {
      sales: sales.totals, salesCancelled: sales.cancelled,
      inventory: { pureGoldGrams: inventory.pureGoldGrams, byKarat: inventory.byKarat },
      receivables: { owedToShopUSD: receivables.totalOwedToShopUSD, owedByShopUSD: receivables.totalOwedByShopUSD },
      cash: cash.boxes.map(box => ({ name: box.name, currency: box.currency, closingBalance: box.closingBalance })),
      gold: gold.physicalByKarat,
      notes: [
        'الأرقام مشتقّة من السجلات الموثوقة عند القراءة — لا مجاميع مخزَّنة.',
        'لا تظهر هنا كلفة ولا ربح: احتساب التكلفة مؤجّل، ولا يوجد أساس كلفة لمعظم المخزون.',
      ],
    };
  }
}
