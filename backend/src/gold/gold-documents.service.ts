import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { salesGoldExchanges } from '../database/schema.js';
import { GoldPostingService, type Karat } from './gold-posting.service.js';

/**
 * Turns a business document into gold movements.
 *
 * Three account roles keep the picture honest:
 *   · company holding      — metal the shop physically has, per branch
 *   · partner account      — gold owed between the shop and that partner
 *   · sales settlement     — gold whose value was consumed by an invoice
 *
 * Scrap taken on a sale is metal that arrived and whose value was already credited on
 * that invoice, so it lands in holding and is cleared through settlement, leaving the
 * partner at zero. Returning such a sale moves no metal at all: it reverses part of that
 * settlement and leaves the shop owing the customer gold, to be settled by an explicit
 * later decision rather than an assumed hand-back.
 */
@Injectable()
export class GoldDocumentsService {
  constructor(@Inject(GoldPostingService) private readonly posting: GoldPostingService) {}

  async postSaleExchange(tx: any, user: AuthIdentity, sale: { id: string; invoiceNumber: string; partnerId: string; warehouseId: string }) {
    const exchanges = await tx.select().from(salesGoldExchanges).where(eq(salesGoldExchanges.salesInvoiceId, sale.id));
    const posted = [];
    for (const exchange of exchanges) {
      const weight = Number(exchange.weightGrams);
      if (!(weight > 0)) continue;
      const karat = this.posting.assertKarat(exchange.karat) as Karat;
      const price = Number(exchange.evaluationPriceUsdPerGram);
      const value = Number(exchange.valueUsd);
      posted.push(await this.posting.post(tx, user, {
        type: 'sale_exchange', sourceType: 'sale', sourceId: sale.id, sourceLineId: exchange.id, sourceNumber: sale.invoiceNumber,
        postingEvent: 'sale_exchange', description: `ذهب مستلم من العميل عن فاتورة ${sale.invoiceNumber}`,
        partnerId: sale.partnerId, warehouseId: sale.warehouseId,
        lines: [
          // The metal arrives in the branch's holding.
          { companyWarehouseId: sale.warehouseId, karat, debitGrams: weight, goldPriceUsdPerGram: price, valuationUsd: value, warehouseId: sale.warehouseId, salesInvoiceId: sale.id, salesGoldExchangeId: exchange.id, description: `استلام ${weight.toFixed(3)} غ عيار ${karat} عن ${sale.invoiceNumber}` },
          // Its value was already credited on the invoice, so it is consumed rather than
          // left as something the shop owes the customer.
          { systemCode: 'sales_settlement', karat, creditGrams: weight, goldPriceUsdPerGram: price, valuationUsd: value, partnerId: sale.partnerId, salesInvoiceId: sale.id, salesGoldExchangeId: exchange.id, description: `احتُسبت قيمة الذهب ضمن فاتورة ${sale.invoiceNumber}` },
        ],
      }));
    }
    return posted;
  }

  /**
   * A sales return on an invoice that carried a scrap exchange. The share is taken from
   * the scrap value this return actually gave back, so a partial return owes a
   * proportional weight of the very same karat. No physical gold is moved.
   */
  async postSalesReturnGoldObligation(tx: any, user: AuthIdentity, document: { id: string; returnNumber: string; partnerId: string; warehouseId: string; originalSalesInvoiceId: string | null; scrapCreditAllocatedUsd: number }) {
    if (!document.originalSalesInvoiceId || !(document.scrapCreditAllocatedUsd > 0)) return [];
    const exchanges = await tx.select().from(salesGoldExchanges).where(eq(salesGoldExchanges.salesInvoiceId, document.originalSalesInvoiceId));
    const originalScrapValue = exchanges.reduce((sum: number, row: any) => sum + Number(row.valueUsd), 0);
    if (!(originalScrapValue > 0)) return [];
    const share = Math.min(1, document.scrapCreditAllocatedUsd / originalScrapValue);

    const posted = [];
    for (const exchange of exchanges) {
      const weight = Number((Number(exchange.weightGrams) * share).toFixed(3));
      if (!(weight > 0)) continue;
      const karat = this.posting.assertKarat(exchange.karat) as Karat;
      posted.push(await this.posting.post(tx, user, {
        type: 'sales_return_obligation', sourceType: 'sales_return', sourceId: document.id, sourceLineId: exchange.id, sourceNumber: document.returnNumber,
        postingEvent: 'sales_return_gold', description: `التزام ذهب تجاه العميل عن مرتجع ${document.returnNumber}`,
        partnerId: document.partnerId, warehouseId: document.warehouseId,
        lines: [
          // Part of the gold that had been consumed by the sale is no longer consumed.
          { systemCode: 'sales_settlement', karat, debitGrams: weight, goldPriceUsdPerGram: Number(exchange.evaluationPriceUsdPerGram), returnInvoiceId: document.id, salesGoldExchangeId: exchange.id, description: `عكس حصة الذهب المحتسبة عن ${document.returnNumber}` },
          // The shop now owes the customer that weight, at the original karat.
          { partnerId: document.partnerId, karat, creditGrams: weight, goldPriceUsdPerGram: Number(exchange.evaluationPriceUsdPerGram), returnInvoiceId: document.id, salesGoldExchangeId: exchange.id, description: `المحل مدين للعميل بـ ${weight.toFixed(3)} غ عيار ${karat} عن ${document.returnNumber}` },
        ],
      }));
    }
    return posted;
  }

  async reverseDocument(tx: any, user: AuthIdentity, sourceType: string, sourceId: string, reason: string) {
    return this.posting.reverseSource(tx, user, sourceType, sourceId, reason);
  }

  // The gold a sale carried, so the sale and return screens can state it plainly.
  async saleGoldSummary(db: any, salesInvoiceId: string) {
    const exchanges = await db.select().from(salesGoldExchanges).where(eq(salesGoldExchanges.salesInvoiceId, salesInvoiceId));
    return exchanges.map((row: any) => ({ id: row.id, karat: row.karat, weightGrams: Number(row.weightGrams), pricePerGramUSD: Number(row.evaluationPriceUsdPerGram), valueUSD: Number(row.valueUsd) }));
  }
}
