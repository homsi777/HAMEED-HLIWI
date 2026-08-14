import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AccountingDocumentsService } from '../accounting/accounting-documents.service.js';
import { AccountingPostingService } from '../accounting/accounting-posting.service.js';
import { FinancePostingService } from '../finance/finance-posting.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { sql } from 'drizzle-orm';

/**
 * One-time, idempotent accounting backfill for business documents created before the
 * accounting core existed. It replays the same posting model the live code uses — the
 * posting service keys on (source type, source id, event), so nothing can post twice.
 *
 * Run without arguments for a dry run; add --apply to write.
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get<Database>(DATABASE);
  const documents = app.get(AccountingDocumentsService);
  const posting = app.get(AccountingPostingService);
  const financePosting = app.get(FinancePostingService);
  try {
    const actor = (await db.execute(sql`select id from users order by created_at, id limit 1`)) as any;
    const actorId = (actor.rows ?? actor)[0]?.id as string | undefined;
    if (!actorId) throw new Error('No user exists to attribute the backfill to.');
    const user = { id: actorId, permissions: [], warehouses: [] } as any;

    const rows = async (query: any) => { const result = await db.execute(query) as any; return (result.rows ?? result) as any[]; };
    const unposted = async (table: string, sourceType: string, event: string) =>
      rows(sql.raw(`select count(*)::int as n from ${table} t where not exists (select 1 from journal_entries j where j.source_type = '${sourceType}' and j.source_id = t.id and j.posting_event = '${event}')`));

    const sales = await rows(sql`select s.id, s.invoice_number, s.customer_partner_id, s.warehouse_id, s.final_total_usd, s.exchange_rate_syp_per_usd, s.status, s.cancellation_reason from sales_invoices s order by s.created_at`);
    const purchases = await rows(sql`select p.id, p.purchase_number, p.supplier_partner_id, p.warehouse_id, p.final_total_usd, p.exchange_rate_syp_per_usd, p.status, p.cancellation_reason from purchase_invoices p order by p.created_at`);
    const returns = await rows(sql`select r.id, r.return_number, r.type, r.partner_id, r.warehouse_id, r.final_total_usd, r.exchange_rate_syp_per_usd, r.status, r.cancellation_reason from return_invoices r order by r.created_at`);
    const voucherRows = await rows(sql`select v.id, v.voucher_number, v.type, v.source_type, v.partner_id, v.warehouse_id, v.cashbox_id, v.expense_category, v.currency, v.amount, v.amount_usd_equivalent, v.exchange_rate_syp_per_usd, v.system_note, v.status, v.cancellation_reason from vouchers v where v.source_type <> 'cashbox_transfer' order by v.created_at`);
    const transfers = await rows(sql`select t.id, t.transfer_number, t.note, t.from_cashbox_id, t.to_cashbox_id, t.amount_from, t.amount_to, t.exchange_rate_syp_per_usd, fc.currency as from_currency, fc.warehouse_id as from_warehouse, tc.currency as to_currency, tc.warehouse_id as to_warehouse from cashbox_transfers t join cashboxes fc on fc.id = t.from_cashbox_id join cashboxes tc on tc.id = t.to_cashbox_id order by t.created_at`);
    const partnerRows = await rows(sql`select id, name, type, opening_balance_usd from partners where opening_balance_usd <> 0 and archived_at is null order by created_at`);
    const cashboxRows = await rows(sql`select id, name, currency, warehouse_id, opening_balance from cashboxes where opening_balance <> 0 and archived_at is null order by created_at`);

    console.log('Eligible sources:');
    console.log(`  sales ${sales.length} · purchases ${purchases.length} · returns ${returns.length} · vouchers ${voucherRows.length} · transfers ${transfers.length}`);
    console.log(`  partner opening balances ${partnerRows.length} · cashbox opening balances ${cashboxRows.length}`);
    const alreadyPosted = await rows(sql`select source_type, count(*)::int as n from journal_entries group by source_type order by source_type`);
    console.log('Already posted journals by source:', alreadyPosted.length ? alreadyPosted.map(r => `${r.source_type}=${r.n}`).join(' · ') : 'none');

    const expected = [...sales, ...purchases, ...returns].reduce((sum, row) => sum + Number(row.final_total_usd), 0)
      + voucherRows.reduce((sum, row) => sum + Number(row.amount_usd_equivalent), 0);
    console.log(`Expected additional debit = credit ≈ $${expected.toFixed(2)} (before skipping already-posted sources)`);
    if (!apply) { console.log('\nDry run only. Re-run with --apply to post.'); return; }

    let posted = 0; let reversed = 0; let ledgerRepaired = 0;
    await db.transaction(async (tx: any) => {
      // Opening balances first so later documents build on top of them.
      for (const cashbox of cashboxRows) if (await documents.postCashboxOpening(tx, user, { id: cashbox.id, name: cashbox.name, currency: cashbox.currency, warehouseId: cashbox.warehouse_id, openingBalance: Number(cashbox.opening_balance), rate: 1 })) posted += 1;
      for (const partner of partnerRows) if (await documents.postPartnerOpening(tx, user, { id: partner.id, name: partner.name, type: partner.type, openingBalanceUsd: Number(partner.opening_balance_usd), rate: 1 })) posted += 1;

      for (const sale of sales) {
        if (await documents.postSale(tx, user, { id: sale.id, invoiceNumber: sale.invoice_number, partnerId: sale.customer_partner_id, warehouseId: sale.warehouse_id, finalTotalUsd: Number(sale.final_total_usd), rate: Number(sale.exchange_rate_syp_per_usd) })) posted += 1;
      }
      for (const purchase of purchases) {
        if (await documents.postPurchase(tx, user, { id: purchase.id, invoiceNumber: purchase.purchase_number, partnerId: purchase.supplier_partner_id, warehouseId: purchase.warehouse_id, finalTotalUsd: Number(purchase.final_total_usd), rate: Number(purchase.exchange_rate_syp_per_usd) })) posted += 1;
      }
      for (const document of returns) {
        if (await documents.postReturn(tx, user, { id: document.id, returnNumber: document.return_number, type: document.type, partnerId: document.partner_id, warehouseId: document.warehouse_id, finalTotalUsd: Number(document.final_total_usd), rate: Number(document.exchange_rate_syp_per_usd) })) posted += 1;
      }
      for (const voucher of voucherRows) {
        if (await documents.postVoucher(tx, user, {
          id: voucher.id, voucherNumber: voucher.voucher_number, type: voucher.type, sourceType: voucher.source_type,
          partnerId: voucher.partner_id, warehouseId: voucher.warehouse_id, cashboxId: voucher.cashbox_id, expenseCategory: voucher.expense_category,
          systemNote: voucher.system_note ?? voucher.voucher_number,
          money: { currency: voucher.currency, originalAmount: Number(voucher.amount), amountUsd: Number(voucher.amount_usd_equivalent), rate: Number(voucher.exchange_rate_syp_per_usd) },
        })) posted += 1;
      }
      for (const transfer of transfers) {
        if (await documents.postTransfer(tx, user, {
          id: transfer.id, transferNumber: transfer.transfer_number, note: transfer.note,
          from: { cashboxId: transfer.from_cashbox_id, currency: transfer.from_currency, amount: Number(transfer.amount_from), warehouseId: transfer.from_warehouse },
          to: { cashboxId: transfer.to_cashbox_id, currency: transfer.to_currency, amount: Number(transfer.amount_to), warehouseId: transfer.to_warehouse },
          rate: Number(transfer.exchange_rate_syp_per_usd ?? 1) || 1,
        })) posted += 1;
      }

      // Documents that were already cancelled must end up net-zero in accounting.
      // Cancelled vouchers are deliberately NOT reversed here: Task 07 already wrote a
      // compensating voucher for each one, and that document is posted above. Reversing
      // the journal as well would remove the same cash twice.
      for (const [list, kind] of [[sales, 'sale'], [purchases, 'purchase'], [returns, null]] as const) {
        for (const row of list as any[]) {
          if (row.status !== 'cancelled') continue;
          reversed += await posting.reverseSource(tx, user, (kind ?? row.type) as any, row.id, row.cancellation_reason ?? 'إلغاء سابق');
          // Repair the operational subledger too: before Task 08 a cancelled document
          // kept its own entry, which left it inside the partner balance forever.
          const reference = kind === 'sale' ? { salesInvoiceId: row.id } : kind === 'purchase' ? { purchaseInvoiceId: row.id } : { returnInvoiceId: row.id };
          ledgerRepaired += await financePosting.reverseDocumentLedger(tx, user, reference, row.cancellation_reason ?? 'إلغاء سابق');
        }
      }
    });

    const totals = await rows(sql`select coalesce(sum(total_debit_usd),0) as debit, coalesce(sum(total_credit_usd),0) as credit, count(*)::int as n from journal_entries`);
    console.log(`\nBackfill complete. Journals created: ${posted}. Reversals for cancelled documents: ${reversed}.`);
    console.log(`Journals now: ${totals[0].n} · total debit $${Number(totals[0].debit).toFixed(2)} · total credit $${Number(totals[0].credit).toFixed(2)}`);
    void unposted;
  } finally {
    await app.close();
  }
}

void main();
