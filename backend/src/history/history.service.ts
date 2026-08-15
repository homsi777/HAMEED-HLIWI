import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import { DATABASE, type Database } from '../database/database.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KARATS = new Set(['24', '22', '21', '18', '14']);
const KARAT_ORDER = ['24', '22', '21', '18', '14'];

export type DocumentType = 'sale' | 'sales_return' | 'all';
export type PaymentState = 'paid' | 'partial' | 'credit' | 'cancelled';

/**
 * Permanent commercial history, derived rather than duplicated.
 *
 * Every fact these screens need is already persisted immutably at the moment of sale:
 * `sales_invoices` carries the seller, the warehouse, the shift and the customer name as it
 * was, and `sales_invoice_items` carries the item name, code, karat, quantity and weight as a
 * snapshot on the line. A second denormalised copy would add a way for history to disagree
 * with the documents without adding a single fact, so none is written — this service is the
 * authoritative read over what already exists.
 *
 * Consequently, history has no side effects at all: no voucher, no cash movement, no journal
 * entry, no gold transaction, no inventory write.
 */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService,
  ) {}

  // ---------------------------------------------------------------- سجل الفواتير

  async invoices(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page);
    const limit = this.limit(query.limit);
    const type = this.type(query.type);
    const sales = this.saleConditions(user, query);
    const returns = this.returnConditions(user, query);

    // A sale and a sales return are different tables but one history. They are unioned in
    // SQL so paging and ordering stay correct across both, rather than merged in the browser.
    const saleSelect = sql`
      select s.id, s.invoice_number as number, 'sale'::text as type, s.created_at, s.status::text as status,
             s.customer_name_snapshot as partner_name, s.customer_partner_id as partner_id,
             s.final_total_usd as total_usd, s.paid_usd, s.paid_syp, s.remaining_debt_usd,
             s.payment_method::text as payment_method, s.warehouse_id, w.name as warehouse_name,
             s.created_by_user_id as seller_id, u.full_name as seller_name,
             s.shift_id, sh.shift_number,
             (select coalesce(sum(i.quantity), 0)::numeric from sales_invoice_items i where i.sales_invoice_id = s.id) as item_count,
             (select count(*) filter (where i.line_type = 'manual') from sales_invoice_items i where i.sales_invoice_id = s.id) as manual_line_count,
             (select count(*) from sales_invoice_items i where i.sales_invoice_id = s.id) as line_count
      from sales_invoices s
      join users u on u.id = s.created_by_user_id
      join warehouses w on w.id = s.warehouse_id
      left join shifts sh on sh.id = s.shift_id
      where ${sales}`;

    const returnSelect = sql`
      select r.id, r.return_number as number, 'sales_return'::text as type, r.created_at, r.status::text as status,
             r.partner_name_snapshot as partner_name, r.partner_id,
             r.final_total_usd as total_usd, r.refunded_usd as paid_usd, r.refunded_syp as paid_syp,
             r.outstanding_adjustment_usd as remaining_debt_usd,
             'return'::text as payment_method, r.warehouse_id, w.name as warehouse_name,
             r.created_by_user_id as seller_id, u.full_name as seller_name,
             r.shift_id, sh.shift_number,
             (select coalesce(sum(i.quantity), 0)::numeric from return_invoice_items i where i.return_invoice_id = r.id) as item_count,
             0::bigint as manual_line_count,
             (select count(*) from return_invoice_items i where i.return_invoice_id = r.id) as line_count
      from return_invoices r
      join users u on u.id = r.created_by_user_id
      join warehouses w on w.id = r.warehouse_id
      left join shifts sh on sh.id = r.shift_id
      where ${returns}`;

    const body = type === 'sale' ? saleSelect : type === 'sales_return' ? returnSelect : sql`${saleSelect} union all ${returnSelect}`;
    const payment = this.paymentState(query.paymentState);
    // The payment state is derived from the money already on the document, never stored.
    const filtered = payment
      ? sql`select * from (${body}) as history where ${this.paymentCondition(payment)}`
      : sql`select * from (${body}) as history`;

    const [rows, total] = await Promise.all([
      this.db.execute(sql`${filtered} order by created_at desc, number desc limit ${limit} offset ${(page - 1) * limit}`),
      this.db.execute(sql`select count(*)::int as count from (${filtered}) as counted`),
    ]);

    return {
      items: (rows as unknown as any[]).map(row => this.invoiceDto(row)),
      meta: { page, limit, total: Number((total as unknown as any[])[0]?.count ?? 0) },
    };
  }

  // ---------------------------------------------------------------- سجل الأوزان المباعة

  async soldWeights(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page);
    const limit = this.limit(query.limit);
    const where = this.lineConditions(user, query);
    const rows = await this.db.execute(sql`
      ${this.soldWeightBase(where)}
      order by s.created_at desc, s.invoice_number desc, i.line_number asc
      limit ${limit} offset ${(page - 1) * limit}`);
    const total = await this.db.execute(sql`
      select count(*)::int as count
      from sales_invoice_items i
      join sales_invoices s on s.id = i.sales_invoice_id
      where ${where}`);

    return {
      items: (rows as unknown as any[]).map(row => ({
        lineId: row.line_id,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        soldAt: new Date(row.created_at).toISOString(),
        status: row.status,
        itemName: row.item_name,
        itemCode: row.item_code,
        category: row.category,
        karat: row.karat,
        source: row.line_type === 'manual' ? 'manual' : 'stock',
        quantity: Number(row.quantity),
        grossWeightGrams: Number(row.gross_weight_grams),
        netWeightGrams: Number(row.net_weight_grams),
        // The original sale is never rewritten: what came back is reported beside it.
        returnedQuantity: Number(row.returned_quantity ?? 0),
        returnedWeightGrams: Number(row.returned_weight ?? 0),
        netAfterReturnsGrams: Number((Number(row.net_weight_grams) - Number(row.returned_weight ?? 0)).toFixed(3)),
        pricePerGramUSD: Number(row.gold_price_usd_per_gram),
        lineTotalUSD: Number(row.line_total_usd),
        customerName: row.customer_name,
        sellerId: row.seller_id,
        sellerName: row.seller_name,
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
        shiftId: row.shift_id,
        shiftNumber: row.shift_number,
      })),
      meta: { page, limit, total: Number((total as unknown as any[])[0]?.count ?? 0) },
    };
  }

  /**
   * Totals for the whole filtered set, not the visible page, grouped in SQL by karat.
   * Karats are reported separately — 21K grams and 18K grams are different facts and are
   * never added together into one number.
   */
  async soldWeightSummary(user: AuthIdentity, query: Record<string, unknown>) {
    const where = this.lineConditions(user, query);
    const rows = await this.db.execute(sql`
      select i.karat_snapshot as karat,
             count(*)::int as line_count,
             coalesce(sum(i.quantity), 0) as quantity,
             coalesce(sum(i.net_weight_grams), 0) as sold_weight,
             coalesce(sum(case when s.status = 'cancelled' then i.net_weight_grams else 0 end), 0) as cancelled_weight,
             coalesce(sum((select coalesce(sum(ri.net_weight_grams), 0)
                           from return_invoice_items ri
                           join return_invoices r on r.id = ri.return_invoice_id and r.status = 'posted'
                           where ri.source_sales_invoice_item_id = i.id)), 0) as returned_weight
      from sales_invoice_items i
      join sales_invoices s on s.id = i.sales_invoice_id
      where ${where}
      group by i.karat_snapshot`);

    const byKarat = (rows as unknown as any[]).map(row => {
      const sold = Number(Number(row.sold_weight).toFixed(3));
      const cancelled = Number(Number(row.cancelled_weight).toFixed(3));
      const returned = Number(Number(row.returned_weight).toFixed(3));
      return {
        karat: row.karat,
        lineCount: row.line_count,
        quantity: Number(Number(row.quantity).toFixed(3)),
        soldWeightGrams: sold,
        returnedWeightGrams: returned,
        cancelledWeightGrams: cancelled,
        // A cancelled sale stays visible in history but never counts as sold.
        netWeightGrams: Number((sold - cancelled - returned).toFixed(3)),
      };
    }).sort((left, right) => KARAT_ORDER.indexOf(left.karat) - KARAT_ORDER.indexOf(right.karat));

    return {
      byKarat,
      lineCount: byKarat.reduce((sum, row) => sum + row.lineCount, 0),
      pieceCount: Number(byKarat.reduce((sum, row) => sum + row.quantity, 0).toFixed(3)),
    };
  }

  /** Sellers and warehouses the caller may filter by. An own-scope seller gets no seller list. */
  async filterOptions(user: AuthIdentity) {
    const ownOnly = this.authorization.isOwnDataOnly(user);
    const allowed = this.authorization.allowedWarehouseIds(user);
    const warehouses = await this.db.execute(sql`
      select id, name from warehouses
      where is_active = true ${allowed ? sql`and id in (${sql.join(allowed.map(id => sql`${id}`), sql`, `)})` : sql``}
      order by name`);
    const sellers = ownOnly ? [] : (await this.db.execute(sql`
      select distinct u.id, u.full_name as name
      from sales_invoices s join users u on u.id = s.created_by_user_id
      where ${this.warehouseCondition(user, 's')}
      order by u.full_name`)) as unknown as any[];
    return {
      warehouses: (warehouses as unknown as any[]).map(row => ({ id: row.id, name: row.name })),
      sellers: (sellers as any[]).map(row => ({ id: row.id, name: row.name })),
      canFilterBySeller: !ownOnly,
      karats: KARAT_ORDER,
    };
  }

  // ---------------------------------------------------------------- conditions

  /** Warehouse scope for a table alias. `null` allowed list means global scope. */
  private warehouseCondition(user: AuthIdentity, alias: string): SQL {
    const allowed = this.authorization.allowedWarehouseIds(user);
    if (!allowed) return sql`true`;
    if (!allowed.length) return sql`false`;
    return sql`${sql.raw(alias)}.warehouse_id in (${sql.join(allowed.map(id => sql`${id}`), sql`, `)})`;
  }

  /** Ownership isolation, pushed into the query so hidden rows are never fetched or counted. */
  private ownerCondition(user: AuthIdentity, alias: string, requestedSellerId: unknown): SQL {
    if (this.authorization.isOwnDataOnly(user)) return sql`${sql.raw(alias)}.created_by_user_id = ${user.id}`;
    if (typeof requestedSellerId === 'string' && requestedSellerId) return sql`${sql.raw(alias)}.created_by_user_id = ${this.id(requestedSellerId, 'sellerId')}`;
    return sql`true`;
  }

  private commonConditions(user: AuthIdentity, alias: string, query: Record<string, unknown>): SQL[] {
    const a = (column: string) => sql.raw(`${alias}.${column}`);
    const conditions: SQL[] = [this.warehouseCondition(user, alias), this.ownerCondition(user, alias, query.sellerId)];
    if (query.warehouseId) {
      const warehouseId = this.id(query.warehouseId, 'warehouseId');
      this.authorization.assertWarehouse(user, warehouseId);
      conditions.push(sql`${a('warehouse_id')} = ${warehouseId}`);
    }
    if (query.shiftId) conditions.push(sql`${a('shift_id')} = ${this.id(query.shiftId, 'shiftId')}`);
    if (query.status === 'posted' || query.status === 'cancelled') conditions.push(sql`${a('status')} = ${query.status}`);
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(sql`${a('created_at')} >= ${new Date(query.dateFrom).toISOString()}::timestamptz`);
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(sql`${a('created_at')} <= ${new Date(`${query.dateTo}T23:59:59.999Z`).toISOString()}::timestamptz`);
    return conditions;
  }

  private saleConditions(user: AuthIdentity, query: Record<string, unknown>): SQL {
    const conditions = this.commonConditions(user, 's', query);
    if (typeof query.invoiceNumber === 'string' && query.invoiceNumber.trim()) conditions.push(sql`s.invoice_number ilike ${`%${query.invoiceNumber.trim()}%`}`);
    if (query.customerId) conditions.push(sql`s.customer_partner_id = ${this.id(query.customerId, 'customerId')}`);
    if (typeof query.customerName === 'string' && query.customerName.trim()) conditions.push(sql`s.customer_name_snapshot ilike ${`%${query.customerName.trim()}%`}`);
    return sql.join(conditions, sql` and `);
  }

  private returnConditions(user: AuthIdentity, query: Record<string, unknown>): SQL {
    const conditions = this.commonConditions(user, 'r', query);
    conditions.push(sql`r.type = 'sales_return'`);
    if (typeof query.invoiceNumber === 'string' && query.invoiceNumber.trim()) conditions.push(sql`r.return_number ilike ${`%${query.invoiceNumber.trim()}%`}`);
    if (query.customerId) conditions.push(sql`r.partner_id = ${this.id(query.customerId, 'customerId')}`);
    if (typeof query.customerName === 'string' && query.customerName.trim()) conditions.push(sql`r.partner_name_snapshot ilike ${`%${query.customerName.trim()}%`}`);
    return sql.join(conditions, sql` and `);
  }

  /** Sold-line conditions. The commercial source is the sale line, never an inventory movement. */
  private lineConditions(user: AuthIdentity, query: Record<string, unknown>): SQL {
    const conditions = this.commonConditions(user, 's', query);
    if (typeof query.invoiceNumber === 'string' && query.invoiceNumber.trim()) conditions.push(sql`s.invoice_number ilike ${`%${query.invoiceNumber.trim()}%`}`);
    if (typeof query.karat === 'string' && KARATS.has(query.karat)) conditions.push(sql`i.karat_snapshot = ${query.karat}`);
    if (typeof query.itemName === 'string' && query.itemName.trim()) conditions.push(sql`i.item_name_snapshot ilike ${`%${query.itemName.trim()}%`}`);
    if (typeof query.itemCode === 'string' && query.itemCode.trim()) conditions.push(sql`i.item_code_snapshot ilike ${`%${query.itemCode.trim()}%`}`);
    if (query.source === 'stock' || query.source === 'manual') conditions.push(sql`i.line_type = ${query.source}`);
    return sql.join(conditions, sql` and `);
  }

  private soldWeightBase(where: SQL): SQL {
    return sql`
      select i.id as line_id, i.line_number, i.line_type, i.item_name_snapshot as item_name,
             i.item_code_snapshot as item_code, i.category_snapshot as category, i.karat_snapshot as karat,
             i.quantity, i.gross_weight_grams, i.net_weight_grams,
             i.gold_price_usd_per_gram, i.line_total_usd,
             s.id as invoice_id, s.invoice_number, s.created_at, s.status,
             s.customer_name_snapshot as customer_name,
             s.created_by_user_id as seller_id, u.full_name as seller_name,
             s.warehouse_id, w.name as warehouse_name, s.shift_id, sh.shift_number,
             (select coalesce(sum(ri.quantity), 0) from return_invoice_items ri
               join return_invoices r on r.id = ri.return_invoice_id and r.status = 'posted'
              where ri.source_sales_invoice_item_id = i.id) as returned_quantity,
             (select coalesce(sum(ri.net_weight_grams), 0) from return_invoice_items ri
               join return_invoices r on r.id = ri.return_invoice_id and r.status = 'posted'
              where ri.source_sales_invoice_item_id = i.id) as returned_weight
      from sales_invoice_items i
      join sales_invoices s on s.id = i.sales_invoice_id
      join users u on u.id = s.created_by_user_id
      join warehouses w on w.id = s.warehouse_id
      left join shifts sh on sh.id = s.shift_id
      where ${where}`;
  }

  private paymentCondition(state: PaymentState): SQL {
    if (state === 'cancelled') return sql`status = 'cancelled'`;
    if (state === 'paid') return sql`status <> 'cancelled' and remaining_debt_usd <= 0.00005`;
    if (state === 'partial') return sql`status <> 'cancelled' and remaining_debt_usd > 0.00005 and paid_usd > 0.00005`;
    return sql`status <> 'cancelled' and remaining_debt_usd > 0.00005 and paid_usd <= 0.00005`;
  }

  private invoiceDto(row: any) {
    const remaining = Number(row.remaining_debt_usd);
    const paid = Number(row.paid_usd);
    const paymentState: PaymentState = row.status === 'cancelled' ? 'cancelled'
      : remaining <= 0.00005 ? 'paid' : paid > 0.00005 ? 'partial' : 'credit';
    return {
      id: row.id,
      invoiceNumber: row.number,
      type: row.type,
      date: new Date(row.created_at).toISOString(),
      status: row.status,
      paymentState,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      finalTotalUSD: Number(row.total_usd),
      paidUSD: paid,
      paidSYP: Number(row.paid_syp),
      remainingDebtUSD: remaining,
      paymentMethod: row.payment_method,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      // Sales made before the shifts module simply have none. Nothing is fabricated.
      shiftId: row.shift_id,
      shiftNumber: row.shift_number,
      itemCount: Number(row.item_count),
      lineCount: Number(row.line_count),
      manualLineCount: Number(row.manual_line_count),
    };
  }

  // ---------------------------------------------------------------- validation

  private type(value: unknown): DocumentType {
    if (value === 'sales_return' || value === 'all') return value;
    if (value === undefined || value === null || value === '' || value === 'sale') return 'sale';
    throw new ConflictException('type is invalid.');
  }
  private paymentState(value: unknown): PaymentState | undefined {
    if (value === undefined || value === null || value === '' || value === 'all') return undefined;
    if (value === 'paid' || value === 'partial' || value === 'credit' || value === 'cancelled') return value;
    throw new ConflictException('paymentState is invalid.');
  }
  private id(value: unknown, field: string) { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; }
  private page(value: unknown) { const parsed = Number(value ?? 1); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1; }
  private limit(value: unknown) { const parsed = Number(value ?? 30); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 30; }
}
