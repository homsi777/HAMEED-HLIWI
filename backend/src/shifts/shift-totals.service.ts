import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';
import { returnInvoices, returnPayments, salesGoldExchanges, salesInvoiceItems, salesInvoices, salesPayments } from '../database/schema.js';

export interface KaratWeight { karat: string; weightGrams: number; }
export interface ShiftTotals {
  invoiceCount: number;
  salesGrossUsd: number;
  itemCount: number;
  cashReceivedUsd: number;
  cashReceivedSyp: number;
  creditInvoiceCount: number;
  creditCreatedUsd: number;
  outstandingUsd: number;
  returnCount: number;
  returnsTotalUsd: number;
  cashRefundedUsd: number;
  cashRefundedSyp: number;
  netCashUsd: number;
  netCashSyp: number;
  manualSaleLineCount: number;
  soldWeightByKarat: KaratWeight[];
  exchangeGoldByKarat: KaratWeight[];
}

const EMPTY: ShiftTotals = {
  invoiceCount: 0, salesGrossUsd: 0, itemCount: 0, cashReceivedUsd: 0, cashReceivedSyp: 0,
  creditInvoiceCount: 0, creditCreatedUsd: 0, outstandingUsd: 0, returnCount: 0, returnsTotalUsd: 0,
  cashRefundedUsd: 0, cashRefundedSyp: 0, netCashUsd: 0, netCashSyp: 0, manualSaleLineCount: 0,
  soldWeightByKarat: [], exchangeGoldByKarat: [],
};

const money = (value: unknown) => Number(Number(value ?? 0).toFixed(4));
const weight = (value: unknown) => Number(Number(value ?? 0).toFixed(3));

/**
 * Every operational number a manager reads is computed here, in grouped SQL over the whole
 * set of shifts at once. Nothing is derived in the browser and nothing is fetched row by row:
 * a screen showing twelve open shifts costs six queries, not twelve times six.
 *
 * Cancelled documents are excluded everywhere — a cancelled sale never counts toward what a
 * seller is holding.
 */
@Injectable()
export class ShiftTotalsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async forShifts(shiftIds: string[]): Promise<Map<string, ShiftTotals>> {
    const result = new Map<string, ShiftTotals>();
    if (!shiftIds.length) return result;
    for (const id of shiftIds) result.set(id, { ...EMPTY, soldWeightByKarat: [], exchangeGoldByKarat: [] });

    const postedSales = and(inArray(salesInvoices.shiftId, shiftIds), eq(salesInvoices.status, 'posted'));
    const postedReturns = and(inArray(returnInvoices.shiftId, shiftIds), eq(returnInvoices.status, 'posted'));

    const [sales, payments, items, exchanges, returns, refunds] = await Promise.all([
      // Header level: how many invoices, how much was sold, and how much of it went on credit.
      this.db.select({
        shiftId: salesInvoices.shiftId,
        invoiceCount: sql<number>`count(*)::int`,
        grossUsd: sql<string>`coalesce(sum(${salesInvoices.finalTotalUsd}), 0)`,
        creditCount: sql<number>`count(*) filter (where ${salesInvoices.remainingDebtUsd} > 0)::int`,
        outstandingUsd: sql<string>`coalesce(sum(${salesInvoices.remainingDebtUsd}), 0)`,
      }).from(salesInvoices).where(postedSales).groupBy(salesInvoices.shiftId),

      // Cash actually taken in, kept apart by currency. Currencies are never collapsed.
      this.db.select({
        shiftId: salesInvoices.shiftId,
        cashUsd: sql<string>`coalesce(sum(${salesPayments.amountUsd}) filter (where ${salesPayments.method} = 'cash_usd'), 0)`,
        cashSyp: sql<string>`coalesce(sum(${salesPayments.amountSyp}) filter (where ${salesPayments.method} = 'cash_syp'), 0)`,
      }).from(salesPayments).innerJoin(salesInvoices, eq(salesInvoices.id, salesPayments.salesInvoiceId))
        .where(postedSales).groupBy(salesInvoices.shiftId),

      // Weight sold, split by karat. 21K grams and 18K grams are different facts.
      this.db.select({
        shiftId: salesInvoices.shiftId,
        karat: salesInvoiceItems.karatSnapshot,
        netWeight: sql<string>`coalesce(sum(${salesInvoiceItems.netWeightGrams}), 0)`,
        quantity: sql<string>`coalesce(sum(${salesInvoiceItems.quantity}), 0)`,
        manualLines: sql<number>`count(*) filter (where ${salesInvoiceItems.lineType} = 'manual')::int`,
      }).from(salesInvoiceItems).innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceItems.salesInvoiceId))
        .where(postedSales).groupBy(salesInvoices.shiftId, salesInvoiceItems.karatSnapshot),

      // Scrap taken in against a sale, reported separately from what was sold.
      this.db.select({
        shiftId: salesInvoices.shiftId,
        karat: salesGoldExchanges.karat,
        weightGrams: sql<string>`coalesce(sum(${salesGoldExchanges.weightGrams}), 0)`,
      }).from(salesGoldExchanges).innerJoin(salesInvoices, eq(salesInvoices.id, salesGoldExchanges.salesInvoiceId))
        .where(postedSales).groupBy(salesInvoices.shiftId, salesGoldExchanges.karat),

      this.db.select({
        shiftId: returnInvoices.shiftId,
        returnCount: sql<number>`count(*)::int`,
        totalUsd: sql<string>`coalesce(sum(${returnInvoices.finalTotalUsd}), 0)`,
      }).from(returnInvoices).where(postedReturns).groupBy(returnInvoices.shiftId),

      this.db.select({
        shiftId: returnInvoices.shiftId,
        cashUsd: sql<string>`coalesce(sum(${returnPayments.amountUsd}) filter (where ${returnPayments.method} = 'cash_usd'), 0)`,
        cashSyp: sql<string>`coalesce(sum(${returnPayments.amountSyp}) filter (where ${returnPayments.method} = 'cash_syp'), 0)`,
      }).from(returnPayments).innerJoin(returnInvoices, eq(returnInvoices.id, returnPayments.returnInvoiceId))
        .where(postedReturns).groupBy(returnInvoices.shiftId),
    ]);

    for (const row of sales) {
      const totals = result.get(row.shiftId!); if (!totals) continue;
      totals.invoiceCount = row.invoiceCount;
      totals.salesGrossUsd = money(row.grossUsd);
      totals.creditInvoiceCount = row.creditCount;
      totals.outstandingUsd = money(row.outstandingUsd);
      totals.creditCreatedUsd = money(row.outstandingUsd);
    }
    for (const row of payments) {
      const totals = result.get(row.shiftId!); if (!totals) continue;
      totals.cashReceivedUsd = money(row.cashUsd);
      totals.cashReceivedSyp = Number(Number(row.cashSyp ?? 0).toFixed(2));
    }
    for (const row of items) {
      const totals = result.get(row.shiftId!); if (!totals) continue;
      totals.soldWeightByKarat.push({ karat: row.karat, weightGrams: weight(row.netWeight) });
      totals.itemCount += Number(row.quantity ?? 0);
      totals.manualSaleLineCount += row.manualLines;
    }
    for (const row of exchanges) {
      const totals = result.get(row.shiftId!); if (!totals) continue;
      totals.exchangeGoldByKarat.push({ karat: row.karat, weightGrams: weight(row.weightGrams) });
    }
    for (const row of returns) {
      const totals = result.get(row.shiftId!); if (!totals) continue;
      totals.returnCount = row.returnCount;
      totals.returnsTotalUsd = money(row.totalUsd);
    }
    for (const row of refunds) {
      const totals = result.get(row.shiftId!); if (!totals) continue;
      totals.cashRefundedUsd = money(row.cashUsd);
      totals.cashRefundedSyp = Number(Number(row.cashSyp ?? 0).toFixed(2));
    }

    const karatOrder = ['24', '22', '21', '18', '14'];
    const sortKarat = (rows: KaratWeight[]) => rows.sort((left, right) => karatOrder.indexOf(left.karat) - karatOrder.indexOf(right.karat));
    for (const totals of result.values()) {
      totals.itemCount = Number(totals.itemCount.toFixed(3));
      totals.netCashUsd = money(totals.cashReceivedUsd - totals.cashRefundedUsd);
      totals.netCashSyp = Number((totals.cashReceivedSyp - totals.cashRefundedSyp).toFixed(2));
      sortKarat(totals.soldWeightByKarat);
      sortKarat(totals.exchangeGoldByKarat);
    }
    return result;
  }

  async forShift(shiftId: string): Promise<ShiftTotals> {
    return (await this.forShifts([shiftId])).get(shiftId) ?? { ...EMPTY, soldWeightByKarat: [], exchangeGoldByKarat: [] };
  }

  /**
   * What the seller should be holding, per currency.
   *
   *   opening custody + cash collected − cash refunded
   *
   * Sales cash already reached the company cashbox when the invoice posted (Task 07); this is
   * a custody statement about the drawer in front of the seller, not a second posting.
   */
  expected(openingUsd: number, openingSyp: number, totals: ShiftTotals) {
    return {
      expectedUsd: money(openingUsd + totals.cashReceivedUsd - totals.cashRefundedUsd),
      expectedSyp: Number((openingSyp + totals.cashReceivedSyp - totals.cashRefundedSyp).toFixed(2)),
    };
  }
}
