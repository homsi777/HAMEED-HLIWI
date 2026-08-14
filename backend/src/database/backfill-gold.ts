import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { GoldDocumentsService } from '../gold/gold-documents.service.js';
import { GoldPostingService } from '../gold/gold-posting.service.js';

/**
 * One-time, idempotent gold backfill for sales that took scrap gold before the gold ledger
 * existed, plus the sales returns raised against them. It replays exactly what the live
 * code now does; the posting service keys on (source type, source id, source line, event),
 * so a second run posts nothing.
 *
 * Weights recorded in the old browser-only screen are deliberately NOT imported: they
 * carry no karat, and a weight without a karat cannot be turned into an honest obligation.
 *
 * Run without arguments for a dry run; add --apply to write.
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get<Database>(DATABASE);
  const documents = app.get(GoldDocumentsService);
  const posting = app.get(GoldPostingService);
  try {
    const rows = async (query: any) => { const result = await db.execute(query) as any; return (result.rows ?? result) as any[]; };
    const actorId = (await rows(sql`select id from users order by created_at, id limit 1`))[0]?.id as string | undefined;
    if (!actorId) throw new Error('No user exists to attribute the backfill to.');
    const user = { id: actorId, permissions: [], warehouses: [] } as any;

    const sales = await rows(sql`
      select s.id, s.invoice_number, s.customer_partner_id, s.warehouse_id, s.status, s.cancellation_reason,
             coalesce(sum(g.weight_grams), 0) as weight, count(g.id)::int as exchanges
      from sales_invoices s join sales_gold_exchanges g on g.sales_invoice_id = s.id
      group by s.id order by min(g.created_at)`);
    const returns = await rows(sql`
      select r.id, r.return_number, r.partner_id, r.warehouse_id, r.status, r.cancellation_reason,
             r.original_sales_invoice_id, r.scrap_credit_allocated_usd
      from return_invoices r
      where r.type = 'sales_return' and r.original_sales_invoice_id is not null and r.scrap_credit_allocated_usd > 0
        and exists (select 1 from sales_gold_exchanges g where g.sales_invoice_id = r.original_sales_invoice_id)
      order by r.created_at`);
    const alreadyPosted = await rows(sql`select source_type, status, count(*)::int as n from gold_transactions group by source_type, status order by source_type`);

    console.log('Eligible gold sources:');
    for (const sale of sales) console.log(`  ${sale.invoice_number} [${sale.status}] — ${sale.exchanges} exchange line(s), ${Number(sale.weight).toFixed(3)} g total`);
    for (const document of returns) console.log(`  ${document.return_number} [${document.status}] — scrap credit $${Number(document.scrap_credit_allocated_usd).toFixed(2)} on the original sale`);
    console.log(`Totals: ${sales.length} sale(s) with scrap · ${returns.length} sales return(s) against them`);
    console.log('Already posted gold transactions:', alreadyPosted.length ? alreadyPosted.map(r => `${r.source_type}/${r.status}=${r.n}`).join(' · ') : 'none');
    if (!apply) { console.log('\nDry run only. Re-run with --apply to post.'); return; }

    let posted = 0; let reversed = 0;
    await db.transaction(async (tx: any) => {
      for (const sale of sales) {
        const created = await documents.postSaleExchange(tx, user, { id: sale.id, invoiceNumber: sale.invoice_number, partnerId: sale.customer_partner_id, warehouseId: sale.warehouse_id });
        posted += created.length;
      }
      for (const document of returns) {
        const created = await documents.postSalesReturnGoldObligation(tx, user, {
          id: document.id, returnNumber: document.return_number, partnerId: document.partner_id, warehouseId: document.warehouse_id,
          originalSalesInvoiceId: document.original_sales_invoice_id, scrapCreditAllocatedUsd: Number(document.scrap_credit_allocated_usd),
        });
        posted += created.length;
      }
      // A document that was already cancelled must leave no weight behind.
      for (const sale of sales) if (sale.status === 'cancelled') reversed += await posting.reverseSource(tx, user, 'sale', sale.id, sale.cancellation_reason ?? 'إلغاء سابق');
      for (const document of returns) if (document.status === 'cancelled') reversed += await posting.reverseSource(tx, user, 'sales_return', document.id, document.cancellation_reason ?? 'إلغاء سابق');
    });

    const totals = await rows(sql`
      select e.karat, coalesce(sum(e.debit_grams),0) as debit, coalesce(sum(e.credit_grams),0) as credit,
             coalesce(sum(case when e.debit_grams > 0 then e.pure_gold_grams else -e.pure_gold_grams end),0) as net_pure
      from gold_ledger_entries e group by e.karat order by e.karat desc`);
    console.log(`\nBackfill complete. Gold transactions created: ${posted}. Reversals for cancelled documents: ${reversed}.`);
    for (const row of totals) console.log(`  ${row.karat}K — debit ${Number(row.debit).toFixed(3)} g · credit ${Number(row.credit).toFixed(3)} g · net pure ${Number(row.net_pure).toFixed(4)} g`);
  } finally {
    await app.close();
  }
}

void main();
