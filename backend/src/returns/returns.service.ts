import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { inventoryItems, inventoryMovements, partners, purchaseInvoiceItems, purchaseInvoices, returnInvoiceItems, returnInvoiceSequences, returnInvoices, returnPayments, salesInvoiceItems, salesInvoices, users } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';
import { FinancePostingService } from '../finance/finance-posting.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['sales_return', 'purchase_return']);
const WEIGHT_EPSILON = 0.0005;
const MONEY_EPSILON = 0.00005;

type ReturnKind = 'sales_return' | 'purchase_return';
type RequestedLine = { sourceLineId: string; quantity: number; netWeightGrams: number };

const number = (value: unknown, field: string, scale = 4, minimum = 0) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(raw)) throw new ConflictException(`${field} is invalid.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new ConflictException(`${field} is invalid.`);
  return parsed.toFixed(scale);
};
const uuid = (value: unknown, field: string) => { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; };

// The return document is reported in the same shape the invoice screen already renders,
// so the approved sales and purchase presentation stays untouched.
const dto = (invoice: any, items: any[] = [], payments: any[] = []) => ({
  id: invoice.id, invoiceNumber: invoice.returnNumber, type: 'return', returnType: invoice.type, date: invoice.createdAt.toISOString().slice(0, 10), status: invoice.status,
  warehouseId: invoice.warehouseId, customerOrSupplierId: invoice.partnerId, customerOrSupplierName: invoice.partnerNameSnapshot, customerPhone: invoice.partnerPhoneSnapshot ?? '',
  originalInvoiceId: invoice.originalSalesInvoiceId ?? invoice.originalPurchaseInvoiceId, originalInvoiceNumber: invoice.originalInvoiceNumber ?? null, reason: invoice.reason,
  items: items.map(item => ({ itemId: item.inventoryItemId ?? undefined, sourceLineId: item.sourceSalesInvoiceItemId ?? item.sourcePurchaseInvoiceItemId, itemName: item.itemNameSnapshot, category: item.categorySnapshot, karat: item.karatSnapshot, quantity: Number(item.quantity), grossWeightGrams: Number(item.grossWeightGrams), stoneWeightGrams: Number(item.stoneWeightGrams), netWeightGrams: Number(item.netWeightGrams), laborFeeUSDPerGram: Number(item.workmanshipUsdPerGram), pricePerGramUSD: Number(item.goldPriceUsdPerGram), totalPriceUSD: Number(item.lineGrossUsd), discountAllocatedUSD: Number(item.discountAllocatedUsd), scrapCreditAllocatedUSD: Number(item.scrapCreditAllocatedUsd), lineTotalUSD: Number(item.lineTotalUsd), warehouseId: invoice.warehouseId })),
  scrapGoldItems: [], subtotalGoldUSD: Number(invoice.goldSubtotalUsd), totalLaborUSD: Number(invoice.workmanshipSubtotalUsd), returnGrossUSD: Number(invoice.returnGrossUsd), scrapTotalValueUSD: Number(invoice.scrapCreditAllocatedUsd), discountUSD: Number(invoice.discountAllocatedUsd),
  finalTotalUSD: Number(invoice.finalTotalUsd), finalTotalSYP: Number(invoice.finalTotalSyp), paidUSD: Number(invoice.refundedUsd), paidSYPInUSD: Number(invoice.refundedSypInUsd), paidSYP: Number(invoice.refundedSyp), remainingDebtUSD: Number(invoice.outstandingAdjustmentUsd), outstandingAdjustmentUSD: Number(invoice.outstandingAdjustmentUsd), remainingDebtGold21kGrams: 0,
  paymentMethod: Number(invoice.refundedUsd) > 0 ? 'cash_usd' : Number(invoice.refundedSyp) > 0 ? 'cash_syp' : 'debt', notes: invoice.notes ?? '', createdBy: invoice.createdByName ?? '', createdAt: invoice.createdAt.toISOString(),
  cancelledAt: invoice.cancelledAt?.toISOString() ?? null, cancellationReason: invoice.cancellationReason ?? null,
  payments: payments.map(payment => ({ method: payment.method, amountUSD: Number(payment.amountUsd), amountSYP: Number(payment.amountSyp), exchangeRate: payment.exchangeRateSypPerUsd ? Number(payment.exchangeRateSypPerUsd) : null, appliedUSD: Number(payment.appliedUsd) })),
});

@Injectable()
export class ReturnsService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService, @Inject(AuditService) private readonly audit: AuditService, @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway, @Inject(FinancePostingService) private readonly finance: FinancePostingService) {}

  async list(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit); const conditions: any[] = [];
    const warehouseId = query.warehouseId ? uuid(query.warehouseId, 'warehouseId') : undefined;
    if (warehouseId) { this.scope.assertAccess(user, warehouseId); conditions.push(eq(returnInvoices.warehouseId, warehouseId)); }
    else if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; if (!ids.length) return { items: [], meta: { page, limit, total: 0 } }; conditions.push(inArray(returnInvoices.warehouseId, ids)); }
    if (query.type && TYPES.has(String(query.type))) conditions.push(eq(returnInvoices.type, query.type as ReturnKind));
    if (query.partnerId) conditions.push(eq(returnInvoices.partnerId, uuid(query.partnerId, 'partnerId')));
    if (query.status && ['posted', 'cancelled'].includes(String(query.status))) conditions.push(eq(returnInvoices.status, query.status as 'posted' | 'cancelled'));
    if (typeof query.returnNumber === 'string' && query.returnNumber.trim()) conditions.push(ilike(returnInvoices.returnNumber, `%${query.returnNumber.trim()}%`));
    if (typeof query.originalInvoiceNumber === 'string' && query.originalInvoiceNumber.trim()) conditions.push(or(ilike(salesInvoices.invoiceNumber, `%${query.originalInvoiceNumber.trim()}%`), ilike(purchaseInvoices.purchaseNumber, `%${query.originalInvoiceNumber.trim()}%`)));
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(returnInvoices.createdAt, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(returnInvoices.createdAt, new Date(`${query.dateTo}T23:59:59.999Z`)));
    const where = conditions.length ? and(...conditions) : undefined;
    const sort = query.sort === 'returnNumber' ? returnInvoices.returnNumber : query.sort === 'finalTotalUsd' ? returnInvoices.finalTotalUsd : returnInvoices.createdAt;
    const order = query.order === 'asc' ? asc(sort) : desc(sort);
    const rows = await this.db.select({ invoice: returnInvoices, createdByName: users.fullName, saleNumber: salesInvoices.invoiceNumber, purchaseNumber: purchaseInvoices.purchaseNumber, itemCount: sql<number>`(select count(*)::int from return_invoice_items where return_invoice_id = ${returnInvoices.id})` })
      .from(returnInvoices).innerJoin(users, eq(users.id, returnInvoices.createdByUserId))
      .leftJoin(salesInvoices, eq(salesInvoices.id, returnInvoices.originalSalesInvoiceId)).leftJoin(purchaseInvoices, eq(purchaseInvoices.id, returnInvoices.originalPurchaseInvoiceId))
      .where(where).orderBy(order, desc(returnInvoices.id)).limit(limit).offset((page - 1) * limit);
    const total = await this.db.select({ count: sql<number>`count(*)::int` }).from(returnInvoices).leftJoin(salesInvoices, eq(salesInvoices.id, returnInvoices.originalSalesInvoiceId)).leftJoin(purchaseInvoices, eq(purchaseInvoices.id, returnInvoices.originalPurchaseInvoiceId)).where(where);
    return { items: rows.map(row => ({ ...dto({ ...row.invoice, createdByName: row.createdByName, originalInvoiceNumber: row.saleNumber ?? row.purchaseNumber }), itemCount: row.itemCount })), meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  async get(user: AuthIdentity, returnId: string) {
    const invoice = await this.invoice(user, uuid(returnId, 'id'));
    const [items, payments] = await Promise.all([
      this.db.select().from(returnInvoiceItems).where(eq(returnInvoiceItems.returnInvoiceId, invoice.id)).orderBy(asc(returnInvoiceItems.lineNumber)),
      this.db.select().from(returnPayments).where(eq(returnPayments.returnInvoiceId, invoice.id)),
    ]);
    return dto(invoice, items, payments);
  }

  // Returnable amounts are always derived here so the browser never carries the authority.
  async returnable(user: AuthIdentity, query: Record<string, unknown>) {
    const type = typeof query.type === 'string' && TYPES.has(query.type) ? query.type as ReturnKind : (() => { throw new ConflictException('type is invalid.'); })();
    const invoiceId = uuid(query.invoiceId ?? query.originalInvoiceId, 'invoiceId');
    if (type === 'sales_return') {
      const invoice = (await this.db.select().from(salesInvoices).where(eq(salesInvoices.id, invoiceId)).limit(1))[0];
      if (!invoice) throw new NotFoundException('Sales invoice not found.');
      this.scope.assertAccess(user, invoice.warehouseId);
      const lines = await this.db.select().from(salesInvoiceItems).where(eq(salesInvoiceItems.salesInvoiceId, invoice.id)).orderBy(asc(salesInvoiceItems.lineNumber));
      const returned = await this.returnedByLine('sales_return', lines.map(line => line.id));
      const stock = lines.length ? await this.db.select({ id: inventoryItems.id, inventoryMode: inventoryItems.inventoryMode, status: inventoryItems.status, archivedAt: inventoryItems.archivedAt, isManualSaleEntry: inventoryItems.isManualSaleEntry }).from(inventoryItems).where(inArray(inventoryItems.id, lines.map(line => line.inventoryItemId).filter(Boolean) as string[])) : [];
      return {
        invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, type, status: invoice.status, warehouseId: invoice.warehouseId, partnerId: invoice.customerPartnerId, partnerName: invoice.customerNameSnapshot, partnerPhone: invoice.customerPhoneSnapshot ?? '',
        date: invoice.createdAt.toISOString().slice(0, 10), exchangeRateSypPerUsd: Number(invoice.exchangeRateSypPerUsd), grossTotalUSD: Number(invoice.goldSubtotalUsd) + Number(invoice.workmanshipSubtotalUsd), discountUSD: Number(invoice.discountUsd), scrapTotalValueUSD: Number(invoice.scrapTotalValueUsd), finalTotalUSD: Number(invoice.finalTotalUsd),
        alreadyReturnedValueUSD: await this.returnedValue('sales_return', invoice.id),
        lines: lines.map(line => { const done = returned.get(line.id) ?? { quantity: 0, net: 0 }; const item = stock.find(row => row.id === line.inventoryItemId); return { sourceLineId: line.id, lineNumber: line.lineNumber, lineType: line.lineType, inventoryItemId: line.inventoryItemId, inventoryMode: item?.inventoryMode ?? null, inventoryRestorable: Boolean(item && !item.archivedAt && (item.isManualSaleEntry || item.inventoryMode === 'aggregate' || item.status === 'sold')), itemCode: line.itemCodeSnapshot, itemName: line.itemNameSnapshot, category: line.categorySnapshot, karat: line.karatSnapshot, pricePerGramUSD: Number(line.goldPriceUsdPerGram), laborFeeUSDPerGram: Number(line.workmanshipUsdPerGram), originalQuantity: Number(line.quantity), originalGrossWeightGrams: Number(line.grossWeightGrams), originalStoneWeightGrams: Number(line.stoneWeightGrams), originalNetWeightGrams: Number(line.netWeightGrams), returnedQuantity: done.quantity, returnedNetWeightGrams: done.net, remainingQuantity: Number((Number(line.quantity) - done.quantity).toFixed(3)), remainingNetWeightGrams: Number((Number(line.netWeightGrams) - done.net).toFixed(3)) }; }),
      };
    }
    const invoice = (await this.db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)).limit(1))[0];
    if (!invoice) throw new NotFoundException('Purchase invoice not found.');
    this.scope.assertAccess(user, invoice.warehouseId);
    const lines = await this.db.select().from(purchaseInvoiceItems).where(eq(purchaseInvoiceItems.purchaseInvoiceId, invoice.id)).orderBy(asc(purchaseInvoiceItems.lineNumber));
    const returned = await this.returnedByLine('purchase_return', lines.map(line => line.id));
    const received = lines.map(line => line.receivedInventoryItemId).filter(Boolean) as string[];
    const stock = received.length ? await this.db.select({ id: inventoryItems.id, inventoryMode: inventoryItems.inventoryMode, status: inventoryItems.status, archivedAt: inventoryItems.archivedAt, quantity: inventoryItems.quantity, netWeightGrams: inventoryItems.netWeightGrams }).from(inventoryItems).where(inArray(inventoryItems.id, received)) : [];
    return {
      invoiceId: invoice.id, invoiceNumber: invoice.purchaseNumber, type, status: invoice.status, warehouseId: invoice.warehouseId, partnerId: invoice.supplierPartnerId, partnerName: invoice.supplierNameSnapshot, partnerPhone: invoice.supplierPhoneSnapshot ?? '',
      date: invoice.createdAt.toISOString().slice(0, 10), exchangeRateSypPerUsd: Number(invoice.exchangeRateSypPerUsd), grossTotalUSD: Number(invoice.goldSubtotalUsd) + Number(invoice.workmanshipSubtotalUsd), discountUSD: Number(invoice.discountUsd), scrapTotalValueUSD: 0, finalTotalUSD: Number(invoice.finalTotalUsd),
      alreadyReturnedValueUSD: await this.returnedValue('purchase_return', invoice.id),
      lines: lines.map(line => { const done = returned.get(line.id) ?? { quantity: 0, net: 0 }; const item = stock.find(row => row.id === line.receivedInventoryItemId); return { sourceLineId: line.id, lineNumber: line.lineNumber, lineType: 'stock', inventoryItemId: line.receivedInventoryItemId, inventoryMode: item?.inventoryMode ?? null, inventoryRestorable: Boolean(item && !item.archivedAt && item.status === 'in_stock'), availableQuantity: item ? Number(item.quantity) : 0, availableNetWeightGrams: item ? Number(item.netWeightGrams) : 0, itemCode: line.itemCodeSnapshot, itemName: line.itemNameSnapshot, category: line.categorySnapshot, karat: line.karatSnapshot, pricePerGramUSD: Number(line.goldPriceUsdPerGram), laborFeeUSDPerGram: Number(line.workmanshipUsdPerGram), originalQuantity: Number(line.quantity), originalGrossWeightGrams: Number(line.grossWeightGrams), originalStoneWeightGrams: Number(line.stoneWeightGrams), originalNetWeightGrams: Number(line.netWeightGrams), returnedQuantity: done.quantity, returnedNetWeightGrams: done.net, remainingQuantity: Number((Number(line.quantity) - done.quantity).toFixed(3)), remainingNetWeightGrams: Number((Number(line.netWeightGrams) - done.net).toFixed(3)) }; }),
    };
  }

  async create(user: AuthIdentity, input: Record<string, unknown>) {
    const type = typeof input.type === 'string' && TYPES.has(input.type) ? input.type as ReturnKind : (() => { throw new ConflictException('type is invalid.'); })();
    const originalInvoiceId = uuid(input.originalInvoiceId ?? input.invoiceId, 'originalInvoiceId');
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const reason = this.text(input.reason, 'reason', 1000);
    const notes = this.optional(input.notes, 2000);
    const requested = this.lines(input.items);
    const refundUsd = number(input.refundUSD ?? '0', 'refundUSD');
    const refundSyp = number(input.refundSYP ?? '0', 'refundSYP', 2);
    const exchangeRate = number(input.exchangeRateSypPerUsd, 'exchangeRateSypPerUsd', 4, 0.0001);
    const expectedPartnerId = input.partnerId === undefined || input.partnerId === null || input.partnerId === '' ? undefined : uuid(input.partnerId, 'partnerId');
    const existing = await this.db.select({ id: returnInvoices.id }).from(returnInvoices).where(eq(returnInvoices.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.get(user, existing[0].id);

    let created: { id: string; warehouseId: string };
    try {
      created = await this.db.transaction(async tx => {
        // Locking the original document serialises every concurrent return against it,
        // so two cashiers can never consume the same remaining quantity or weight.
        const original = type === 'sales_return'
          ? (await tx.select().from(salesInvoices).where(eq(salesInvoices.id, originalInvoiceId)).limit(1).for('update'))[0]
          : (await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, originalInvoiceId)).limit(1).for('update'))[0];
        if (!original) throw new NotFoundException(type === 'sales_return' ? 'Sales invoice not found.' : 'Purchase invoice not found.');
        if (original.status !== 'posted') throw new ConflictException('A cancelled invoice cannot be returned.');
        const warehouseId = original.warehouseId;
        this.scope.assertAccess(user, warehouseId);
        const partnerId = type === 'sales_return' ? (original as any).customerPartnerId : (original as any).supplierPartnerId;
        if (expectedPartnerId && expectedPartnerId !== partnerId) throw new ConflictException(type === 'sales_return' ? 'The selected customer does not match the original sale.' : 'The selected supplier does not match the original purchase.');
        const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
        if (!partner) throw new ConflictException('The original partner record is no longer available.');

        const sourceLines = type === 'sales_return'
          ? await tx.select().from(salesInvoiceItems).where(eq(salesInvoiceItems.salesInvoiceId, original.id))
          : await tx.select().from(purchaseInvoiceItems).where(eq(purchaseInvoiceItems.purchaseInvoiceId, original.id));
        const returnedSoFar = await this.returnedByLine(type, sourceLines.map(line => line.id), tx);

        const year = new Date().getUTCFullYear();
        const sequence = (await tx.insert(returnInvoiceSequences).values({ year, lastNumber: 1 }).onConflictDoUpdate({ target: returnInvoiceSequences.year, set: { lastNumber: sql`${returnInvoiceSequences.lastNumber} + 1`, updatedAt: new Date() } }).returning())[0]!.lastNumber;
        const header = (await tx.insert(returnInvoices).values({
          returnNumber: `RET-${year}-${String(sequence).padStart(3, '0')}`, returnYear: year, sequenceNumber: sequence, type, warehouseId, partnerId, partnerNameSnapshot: partner.name, partnerPhoneSnapshot: partner.phone, reason,
          originalSalesInvoiceId: type === 'sales_return' ? original.id : null, originalPurchaseInvoiceId: type === 'purchase_return' ? original.id : null,
          exchangeRateSypPerUsd: exchangeRate, notes, idempotencyKey, createdByUserId: user.id, updatedByUserId: user.id,
        }).returning())[0]!;

        const originalGrossTotal = Number(original.goldSubtotalUsd) + Number(original.workmanshipSubtotalUsd);
        const originalDiscount = Number(original.discountUsd);
        const originalScrap = type === 'sales_return' ? Number((original as any).scrapTotalValueUsd ?? 0) : 0;
        let goldTotal = 0; let laborTotal = 0; let grossTotal = 0; let discountTotal = 0; let scrapTotal = 0;

        for (const [index, request] of requested.entries()) {
          const source = sourceLines.find(line => line.id === request.sourceLineId);
          if (!source) throw new ConflictException(`items[${index}] does not belong to the original invoice.`);
          const done = returnedSoFar.get(source.id) ?? { quantity: 0, net: 0 };
          const remainingQuantity = Number(source.quantity) - done.quantity;
          const remainingNet = Number(source.netWeightGrams) - done.net;
          if (request.quantity > remainingQuantity + WEIGHT_EPSILON || request.netWeightGrams > remainingNet + WEIGHT_EPSILON) throw new ConflictException(`Returned amount exceeds the remaining returnable quantity or weight for line ${source.lineNumber}.`);
          if (remainingQuantity <= WEIGHT_EPSILON || remainingNet <= WEIGHT_EPSILON) throw new ConflictException(`Line ${source.lineNumber} has already been fully returned.`);

          // Weights are apportioned by the returned net share so gross minus stone always
          // reproduces the returned net weight, whatever the original stone content was.
          const ratio = request.netWeightGrams / Number(source.netWeightGrams);
          const grossReturned = Number((Number(source.grossWeightGrams) * ratio).toFixed(3));
          const stoneReturned = Number((Number(source.stoneWeightGrams) * ratio).toFixed(3));
          const netReturned = Number((grossReturned - stoneReturned).toFixed(3));
          if (netReturned <= 0 || Math.abs(netReturned - request.netWeightGrams) > 0.01) throw new ConflictException(`Returned weight for line ${source.lineNumber} is inconsistent with the original line.`);

          const goldPrice = Number(source.goldPriceUsdPerGram); const workmanship = Number(source.workmanshipUsdPerGram);
          const goldValue = Number((netReturned * goldPrice).toFixed(4)); const laborValue = Number((netReturned * workmanship).toFixed(4));
          const lineGross = Number((goldValue + laborValue).toFixed(4));
          const share = originalGrossTotal > 0 ? lineGross / originalGrossTotal : 0;
          const discountAllocated = Number((originalDiscount * share).toFixed(4));
          const scrapAllocated = Number((originalScrap * share).toFixed(4));
          const lineTotal = Number(Math.max(0, lineGross - discountAllocated - scrapAllocated).toFixed(4));

          const inventoryItemId = type === 'sales_return'
            ? await this.restoreSoldStock(tx, user, source as any, header, { quantity: request.quantity, gross: grossReturned, stone: stoneReturned, net: netReturned, remainingQuantity, remainingNet })
            : await this.withdrawPurchasedStock(tx, user, source as any, header, { quantity: request.quantity, gross: grossReturned, stone: stoneReturned, net: netReturned });

          await tx.insert(returnInvoiceItems).values({
            returnInvoiceId: header.id, lineNumber: index + 1,
            sourceSalesInvoiceItemId: type === 'sales_return' ? source.id : null, sourcePurchaseInvoiceItemId: type === 'purchase_return' ? source.id : null, inventoryItemId,
            itemCodeSnapshot: (source as any).itemCodeSnapshot ?? null, itemNameSnapshot: source.itemNameSnapshot, categorySnapshot: source.categorySnapshot, karatSnapshot: source.karatSnapshot,
            quantity: request.quantity.toFixed(3), grossWeightGrams: grossReturned.toFixed(3), stoneWeightGrams: stoneReturned.toFixed(3), netWeightGrams: netReturned.toFixed(3),
            goldPriceUsdPerGram: goldPrice.toFixed(4), workmanshipUsdPerGram: workmanship.toFixed(4), goldValueUsd: goldValue.toFixed(4), workmanshipValueUsd: laborValue.toFixed(4),
            lineGrossUsd: lineGross.toFixed(4), discountAllocatedUsd: discountAllocated.toFixed(4), scrapCreditAllocatedUsd: scrapAllocated.toFixed(4), lineTotalUsd: lineTotal.toFixed(4),
          });
          goldTotal += goldValue; laborTotal += laborValue; grossTotal += lineGross; discountTotal += discountAllocated; scrapTotal += scrapAllocated;
        }

        const finalTotal = Number(Math.max(0, grossTotal - discountTotal - scrapTotal).toFixed(4));
        const alreadyReturnedValue = await this.returnedValue(type, original.id, tx);
        if (alreadyReturnedValue + finalTotal > Number(original.finalTotalUsd) + MONEY_EPSILON) throw new ConflictException('The total returned value would exceed the economic value of the original invoice.');
        const refundApplied = Number((Number(refundUsd) + Number(refundSyp) / Number(exchangeRate)).toFixed(4));
        if (refundApplied > finalTotal + MONEY_EPSILON) throw new ConflictException('The refund cannot exceed the return total.');
        const outstandingAdjustment = Number(Math.max(0, finalTotal - refundApplied).toFixed(4));
        if (refundUsd !== '0.0000') await tx.insert(returnPayments).values({ returnInvoiceId: header.id, method: 'cash_usd', amountUsd: refundUsd, appliedUsd: refundUsd });
        if (refundSyp !== '0.00') await tx.insert(returnPayments).values({ returnInvoiceId: header.id, method: 'cash_syp', amountSyp: refundSyp, exchangeRateSypPerUsd: exchangeRate, appliedUsd: (Number(refundSyp) / Number(exchangeRate)).toFixed(4) });
        if (outstandingAdjustment > 0) await tx.insert(returnPayments).values({ returnInvoiceId: header.id, method: 'credit_note', amountUsd: outstandingAdjustment.toFixed(4), appliedUsd: outstandingAdjustment.toFixed(4) });

        await tx.update(returnInvoices).set({
          goldSubtotalUsd: goldTotal.toFixed(4), workmanshipSubtotalUsd: laborTotal.toFixed(4), returnGrossUsd: grossTotal.toFixed(4), discountAllocatedUsd: discountTotal.toFixed(4), scrapCreditAllocatedUsd: scrapTotal.toFixed(4),
          finalTotalUsd: finalTotal.toFixed(4), finalTotalSyp: (finalTotal * Number(exchangeRate)).toFixed(2), refundedUsd: refundUsd, refundedSyp: refundSyp, refundedSypInUsd: (Number(refundSyp) / Number(exchangeRate)).toFixed(4), outstandingAdjustmentUsd: outstandingAdjustment.toFixed(4), updatedAt: new Date(),
        }).where(eq(returnInvoices.id, header.id));

        const postedReturnPayments = await tx.select().from(returnPayments).where(eq(returnPayments.returnInvoiceId, header.id));
        await this.finance.postReturnFinancials(tx, user, { returnId: header.id, returnNumber: header.returnNumber, type, partnerId, partnerName: partner.name, warehouseId, finalTotalUsd: finalTotal.toFixed(4), exchangeRateSypPerUsd: exchangeRate, payments: postedReturnPayments });
        await this.audit.record({ actorUserId: user.id, action: 'returns.create', module: 'returns', entityId: header.id, warehouseId, metadata: { returnNumber: header.returnNumber, type, partnerId, originalInvoiceId: original.id, originalInvoiceNumber: (original as any).invoiceNumber ?? (original as any).purchaseNumber, lineCount: requested.length, finalTotalUsd: finalTotal.toFixed(4) } }, tx);
        return { id: header.id, warehouseId };
      });
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') { const row = await this.db.select({ id: returnInvoices.id }).from(returnInvoices).where(eq(returnInvoices.idempotencyKey, idempotencyKey)).limit(1); if (row[0]) return this.get(user, row[0].id); }
      throw error;
    }
    const result = await this.get(user, created.id);
    this.realtime.emitToWarehousePermission(created.warehouseId, 'returns.view', 'return.created', { id: result.id, warehouseId: created.warehouseId, type });
    this.realtime.emitToWarehouse(created.warehouseId, 'inventory.updated', { returnInvoiceId: result.id });
    return result;
  }

  async cancel(user: AuthIdentity, returnId: string, input: Record<string, unknown>) {
    const reason = this.optional(input.reason, 1000);
    if (!reason) throw new ConflictException('Cancellation reason is required.');
    returnId = uuid(returnId, 'id');
    const warehouseId = await this.db.transaction(async tx => {
      const original = (await tx.select().from(returnInvoices).where(eq(returnInvoices.id, returnId)).limit(1).for('update'))[0];
      if (!original) throw new NotFoundException('Return not found.');
      this.scope.assertAccess(user, original.warehouseId);
      const cancelled = (await tx.update(returnInvoices).set({ status: 'cancelled', cancelledAt: new Date(), cancelledByUserId: user.id, cancellationReason: reason, updatedByUserId: user.id, updatedAt: new Date(), version: sql`${returnInvoices.version} + 1` }).where(and(eq(returnInvoices.id, returnId), eq(returnInvoices.status, 'posted'))).returning())[0];
      if (!cancelled) throw new ConflictException('Return is already cancelled.');
      const lines = await tx.select().from(returnInvoiceItems).where(eq(returnInvoiceItems.returnInvoiceId, returnId));
      for (const line of lines) {
        if (!line.inventoryItemId) continue;
        // Reversing is only safe while this return is still the newest movement on the item;
        // anything later (a resale, a transfer) must be corrected by a new document instead.
        const latest = (await tx.select().from(inventoryMovements).where(eq(inventoryMovements.inventoryItemId, line.inventoryItemId)).orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id)).limit(1))[0];
        if (!latest || latest.returnInvoiceId !== returnId || !['sales_return', 'purchase_return'].includes(latest.type)) throw new ConflictException('This return cannot be cancelled because the stock has later activity. Record a corrective transaction instead.');
        const before = latest.metadata as any;
        if (!before?.beforeQuantity || !before?.beforeNetWeightGrams || !before?.beforeStatus || !before?.beforeTotalLaborFeeUsd) throw new ConflictException('Return movement history is incomplete, so the inventory effect cannot be reversed.');
        await tx.update(inventoryItems).set({
          quantity: before.beforeQuantity, grossWeightGrams: before.beforeGrossWeightGrams, stoneWeightGrams: before.beforeStoneWeightGrams, netWeightGrams: before.beforeNetWeightGrams,
          totalLaborFeeUsd: before.beforeTotalLaborFeeUsd, status: before.beforeStatus, archivedAt: null, archivedByUserId: null,
          updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1`,
        }).where(eq(inventoryItems.id, line.inventoryItemId));
        await tx.insert(inventoryMovements).values({ inventoryItemId: line.inventoryItemId, returnInvoiceId: returnId, salesInvoiceId: original.originalSalesInvoiceId, purchaseInvoiceId: original.originalPurchaseInvoiceId, type: 'return_cancellation', fromWarehouseId: original.type === 'sales_return' ? original.warehouseId : null, toWarehouseId: original.type === 'purchase_return' ? original.warehouseId : null, actorUserId: user.id, note: `Return cancellation ${original.returnNumber}: ${reason}`, metadata: { restoredQuantity: before.beforeQuantity, restoredNetWeightGrams: before.beforeNetWeightGrams } });
      }
      await this.finance.reverseSourceDocument(tx, user, { returnInvoiceId: returnId }, reason);
      await this.audit.record({ actorUserId: user.id, action: 'returns.cancel', module: 'returns', entityId: returnId, warehouseId: original.warehouseId, metadata: { returnNumber: original.returnNumber, type: original.type, partnerId: original.partnerId, reason } }, tx);
      return original.warehouseId;
    });
    const result = await this.get(user, returnId);
    this.realtime.emitToWarehousePermission(warehouseId, 'returns.view', 'return.cancelled', { id: returnId, warehouseId });
    this.realtime.emitToWarehouse(warehouseId, 'inventory.updated', { returnInvoiceId: returnId });
    return result;
  }

  // A sales return puts back exactly what came off the shelf: the whole piece for an
  // individual item, or only the returned quantity and weight for an aggregate one.
  private async restoreSoldStock(tx: any, user: AuthIdentity, source: any, header: any, amounts: { quantity: number; gross: number; stone: number; net: number; remainingQuantity: number; remainingNet: number }) {
    if (!source.inventoryItemId) return null;
    const item = (await tx.select().from(inventoryItems).where(eq(inventoryItems.id, source.inventoryItemId)).limit(1).for('update'))[0];
    if (!item) throw new ConflictException('The inventory record for a returned line is no longer available.');
    if (item.warehouseId !== header.warehouseId) throw new ConflictException('The returned item belongs to another warehouse.');
    if (item.archivedAt) throw new ConflictException('The inventory record for a returned line has been archived and cannot receive the return.');
    const before = { beforeQuantity: item.quantity, beforeGrossWeightGrams: item.grossWeightGrams, beforeStoneWeightGrams: item.stoneWeightGrams, beforeNetWeightGrams: item.netWeightGrams, beforeTotalLaborFeeUsd: item.totalLaborFeeUsd, beforeStatus: item.status };
    const movement = async (metadata: Record<string, unknown>) => { await tx.insert(inventoryMovements).values({ inventoryItemId: item.id, returnInvoiceId: header.id, salesInvoiceId: header.originalSalesInvoiceId, type: 'sales_return', toWarehouseId: header.warehouseId, actorUserId: user.id, note: `Sales return ${header.returnNumber}`, metadata: { ...before, ...metadata } }); };

    if (item.isManualSaleEntry) {
      // Legacy-negative manual sale entries move back towards zero; the historical
      // negative evidence is archived rather than erased once fully returned.
      const closesLine = amounts.quantity >= amounts.remainingQuantity - WEIGHT_EPSILON && amounts.net >= amounts.remainingNet - WEIGHT_EPSILON;
      const nextQuantity = Number(item.quantity) + amounts.quantity; const nextNet = Number(item.netWeightGrams) + amounts.net;
      if (closesLine || nextQuantity >= -WEIGHT_EPSILON || nextNet >= -WEIGHT_EPSILON) {
        const archived = (await tx.update(inventoryItems).set({ archivedAt: new Date(), archivedByUserId: user.id, updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, item.version), isNull(inventoryItems.archivedAt))).returning())[0];
        if (!archived) throw new ConflictException('The legacy-negative entry changed while the return was being posted. Reload and retry.');
        await movement({ quantityDelta: amounts.quantity.toFixed(3), netWeightDeltaGrams: amounts.net.toFixed(3), archivedByReturn: true });
        return item.id;
      }
      const reduced = (await tx.update(inventoryItems).set({ quantity: nextQuantity.toFixed(3), grossWeightGrams: (Number(item.grossWeightGrams) + amounts.gross).toFixed(3), stoneWeightGrams: Math.min(0, Number(item.stoneWeightGrams) + amounts.stone).toFixed(3), netWeightGrams: nextNet.toFixed(3), updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, item.version), isNull(inventoryItems.archivedAt))).returning())[0];
      if (!reduced) throw new ConflictException('The legacy-negative entry changed while the return was being posted. Reload and retry.');
      await movement({ quantityDelta: amounts.quantity.toFixed(3), netWeightDeltaGrams: amounts.net.toFixed(3) });
      return item.id;
    }

    if (item.inventoryMode === 'aggregate') {
      const restored = (await tx.update(inventoryItems).set({ quantity: sql`${inventoryItems.quantity} + ${amounts.quantity.toFixed(3)}::numeric`, grossWeightGrams: sql`${inventoryItems.grossWeightGrams} + ${amounts.gross.toFixed(3)}::numeric`, stoneWeightGrams: sql`${inventoryItems.stoneWeightGrams} + ${amounts.stone.toFixed(3)}::numeric`, netWeightGrams: sql`${inventoryItems.netWeightGrams} + ${amounts.net.toFixed(3)}::numeric`, totalLaborFeeUsd: sql`(${inventoryItems.netWeightGrams} + ${amounts.net.toFixed(3)}::numeric) * ${inventoryItems.laborFeeUsdPerGram}`, status: 'in_stock', updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, item.version), isNull(inventoryItems.archivedAt))).returning())[0];
      if (!restored) throw new ConflictException('The aggregate stock changed while the return was being posted. Reload and retry.');
      await movement({ quantityDelta: amounts.quantity.toFixed(3), netWeightDeltaGrams: amounts.net.toFixed(3), afterQuantity: restored.quantity, afterNetWeightGrams: restored.netWeightGrams });
      return item.id;
    }

    if (amounts.quantity < amounts.remainingQuantity - WEIGHT_EPSILON || amounts.net < amounts.remainingNet - WEIGHT_EPSILON) throw new ConflictException('An individual stock item must be returned in full, not partially.');
    if (item.status !== 'sold') throw new ConflictException('The returned item is not marked as sold, so it cannot be restored.');
    const restored = (await tx.update(inventoryItems).set({ status: 'in_stock', updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, item.version), eq(inventoryItems.status, 'sold'), isNull(inventoryItems.archivedAt))).returning())[0];
    if (!restored) throw new ConflictException('The returned item changed while the return was being posted. Reload and retry.');
    await movement({ quantityDelta: amounts.quantity.toFixed(3), netWeightDeltaGrams: amounts.net.toFixed(3), restoredIndividualItem: true });
    return item.id;
  }

  // A purchase return may only take back stock that is still safely on hand.
  private async withdrawPurchasedStock(tx: any, user: AuthIdentity, source: any, header: any, amounts: { quantity: number; gross: number; stone: number; net: number }) {
    if (!source.receivedInventoryItemId) throw new ConflictException('This purchase line only reconciled a legacy-negative balance, so there is no received stock to return. Record a corrective transaction instead.');
    const item = (await tx.select().from(inventoryItems).where(eq(inventoryItems.id, source.receivedInventoryItemId)).limit(1).for('update'))[0];
    if (!item) throw new ConflictException('The received inventory record is no longer available.');
    if (item.archivedAt || item.status !== 'in_stock') throw new ConflictException('The purchased stock is no longer in stock, so it cannot be returned to the supplier.');
    if (item.warehouseId !== header.warehouseId) throw new ConflictException('The purchased stock belongs to another warehouse.');
    const availableQuantity = Number(item.quantity); const availableNet = Number(item.netWeightGrams);
    if (amounts.quantity > availableQuantity + WEIGHT_EPSILON || amounts.net > availableNet + WEIGHT_EPSILON) throw new ConflictException('There is not enough available quantity or weight left to return this purchase line.');
    const before = { beforeQuantity: item.quantity, beforeGrossWeightGrams: item.grossWeightGrams, beforeStoneWeightGrams: item.stoneWeightGrams, beforeNetWeightGrams: item.netWeightGrams, beforeTotalLaborFeeUsd: item.totalLaborFeeUsd, beforeStatus: item.status };
    const nextQuantity = availableQuantity - amounts.quantity; const nextNet = availableNet - amounts.net;
    const clears = nextQuantity <= WEIGHT_EPSILON || nextNet <= WEIGHT_EPSILON;
    if (clears && (nextQuantity > WEIGHT_EPSILON || nextNet > WEIGHT_EPSILON)) throw new ConflictException('The returned quantity and weight must clear the received line together.');
    const updated = clears
      ? (await tx.update(inventoryItems).set({ archivedAt: new Date(), archivedByUserId: user.id, updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, item.version), isNull(inventoryItems.archivedAt))).returning())[0]
      : (await tx.update(inventoryItems).set({ quantity: nextQuantity.toFixed(3), grossWeightGrams: (Number(item.grossWeightGrams) - amounts.gross).toFixed(3), stoneWeightGrams: Math.max(0, Number(item.stoneWeightGrams) - amounts.stone).toFixed(3), netWeightGrams: nextNet.toFixed(3), totalLaborFeeUsd: sql`${nextNet.toFixed(3)}::numeric * ${inventoryItems.laborFeeUsdPerGram}`, updatedByUserId: user.id, updatedAt: new Date(), version: sql`${inventoryItems.version} + 1` }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, item.version), isNull(inventoryItems.archivedAt), gte(inventoryItems.netWeightGrams, amounts.net.toFixed(3)))).returning())[0];
    if (!updated) throw new ConflictException('The purchased stock changed while the return was being posted. Reload and retry.');
    await tx.insert(inventoryMovements).values({ inventoryItemId: item.id, returnInvoiceId: header.id, purchaseInvoiceId: header.originalPurchaseInvoiceId, type: 'purchase_return', fromWarehouseId: header.warehouseId, actorUserId: user.id, note: `Purchase return ${header.returnNumber}`, metadata: { ...before, quantityDelta: `-${amounts.quantity.toFixed(3)}`, netWeightDeltaGrams: `-${amounts.net.toFixed(3)}`, archivedByReturn: clears } });
    return item.id;
  }

  private async returnedByLine(type: ReturnKind, lineIds: string[], db: any = this.db) {
    const map = new Map<string, { quantity: number; net: number }>();
    if (!lineIds.length) return map;
    const column = type === 'sales_return' ? returnInvoiceItems.sourceSalesInvoiceItemId : returnInvoiceItems.sourcePurchaseInvoiceItemId;
    const rows = await db.select({ sourceId: column, quantity: sql<string>`coalesce(sum(${returnInvoiceItems.quantity}), 0)`, net: sql<string>`coalesce(sum(${returnInvoiceItems.netWeightGrams}), 0)` })
      .from(returnInvoiceItems).innerJoin(returnInvoices, eq(returnInvoices.id, returnInvoiceItems.returnInvoiceId))
      .where(and(eq(returnInvoices.status, 'posted'), inArray(column, lineIds))).groupBy(column);
    for (const row of rows) if (row.sourceId) map.set(row.sourceId, { quantity: Number(row.quantity), net: Number(row.net) });
    return map;
  }

  private async returnedValue(type: ReturnKind, originalInvoiceId: string, db: any = this.db) {
    const column = type === 'sales_return' ? returnInvoices.originalSalesInvoiceId : returnInvoices.originalPurchaseInvoiceId;
    const rows = await db.select({ value: sql<string>`coalesce(sum(${returnInvoices.finalTotalUsd}), 0)` }).from(returnInvoices).where(and(eq(column, originalInvoiceId), eq(returnInvoices.status, 'posted')));
    return Number(rows[0]?.value ?? 0);
  }

  private async invoice(user: AuthIdentity, returnId: string) {
    const row = (await this.db.select({ invoice: returnInvoices, createdByName: users.fullName, saleNumber: salesInvoices.invoiceNumber, purchaseNumber: purchaseInvoices.purchaseNumber })
      .from(returnInvoices).innerJoin(users, eq(users.id, returnInvoices.createdByUserId))
      .leftJoin(salesInvoices, eq(salesInvoices.id, returnInvoices.originalSalesInvoiceId)).leftJoin(purchaseInvoices, eq(purchaseInvoices.id, returnInvoices.originalPurchaseInvoiceId))
      .where(eq(returnInvoices.id, returnId)).limit(1))[0];
    if (!row) throw new NotFoundException('Return not found.');
    this.scope.assertAccess(user, row.invoice.warehouseId);
    return { ...row.invoice, createdByName: row.createdByName, originalInvoiceNumber: row.saleNumber ?? row.purchaseNumber };
  }

  private lines(value: unknown): RequestedLine[] {
    if (!Array.isArray(value) || !value.length || value.length > 100) throw new ConflictException('At least one returned line is required.');
    const seen = new Set<string>();
    return value.map((raw: any, index) => {
      if (!raw || typeof raw !== 'object') throw new ConflictException(`items[${index}] is invalid.`);
      const sourceLineId = uuid(raw.sourceLineId ?? raw.sourceSalesInvoiceItemId ?? raw.sourcePurchaseInvoiceItemId, `items[${index}].sourceLineId`);
      if (seen.has(sourceLineId)) throw new ConflictException('The same original line cannot appear twice on one return.');
      seen.add(sourceLineId);
      return { sourceLineId, quantity: Number(number(raw.quantity, `items[${index}].quantity`, 3, 0.001)), netWeightGrams: Number(number(raw.netWeightGrams, `items[${index}].netWeightGrams`, 3, 0.001)) };
    });
  }

  private text(value: unknown, field: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} is invalid.`); return value.trim(); }
  private optional(value: unknown, max: number) { return value === undefined || value === null || value === '' ? null : this.text(value, 'notes', max); }
  private page(value: unknown) { const parsed = Number(value ?? 1); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1; }
  private limit(value: unknown) { const parsed = Number(value ?? 30); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 30; }
}
