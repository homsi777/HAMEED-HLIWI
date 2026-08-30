import 'dotenv/config';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appConfig } from '../config/app-config.js';
import { cashboxes, partnerLedgerEntries } from './schema.js';

/**
 * One-time, idempotent financial posting for Sales, Purchases and Returns that were
 * created before Task 07 existed. It never invents money: it only replays the payment
 * facts those documents already recorded, and it skips anything already posted.
 *
 * Run with --apply to write; without it the script only reports what it would do.
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const config = appConfig();
  const client = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(client);
  try {
    const actor = (await client`select id from users order by created_at, id limit 1`)[0] as { id: string } | undefined;
    if (!actor) throw new Error('No user exists to attribute the backfill to.');

    const sales = await client`
      select s.id, s.invoice_number, s.customer_partner_id, s.warehouse_id, s.final_total_usd, s.exchange_rate_syp_per_usd, p.name as partner_name
      from sales_invoices s join partners p on p.id = s.customer_partner_id
      where s.status = 'posted' and not exists (select 1 from partner_ledger_entries l where l.sales_invoice_id = s.id and l.entry_type = 'sale')
      order by s.created_at`;
    const purchases = await client`
      select s.id, s.purchase_number, s.supplier_partner_id, s.warehouse_id, s.final_total_usd, s.exchange_rate_syp_per_usd, p.name as partner_name
      from purchase_invoices s join partners p on p.id = s.supplier_partner_id
      where s.status = 'posted' and not exists (select 1 from partner_ledger_entries l where l.purchase_invoice_id = s.id and l.entry_type = 'purchase')
      order by s.created_at`;
    const returns = await client`
      select r.id, r.return_number, r.type, r.partner_id, r.warehouse_id, r.final_total_usd, r.exchange_rate_syp_per_usd, p.name as partner_name
      from return_invoices r join partners p on p.id = r.partner_id
      where r.status = 'posted' and not exists (select 1 from partner_ledger_entries l where l.return_invoice_id = r.id and l.entry_type in ('sales_return','purchase_return'))
      order by r.created_at`;

    console.log(`Unposted documents found — sales: ${sales.length}, purchases: ${purchases.length}, returns: ${returns.length}`);
    if (!apply) { console.log('Dry run only. Re-run with --apply to post them.'); return; }

    const boxes = await db.select().from(cashboxes).where(and(eq(cashboxes.isDefault, true), eq(cashboxes.isActive, true), isNull(cashboxes.archivedAt)));
    const cashboxFor = (currency: string, warehouseId: string | null) =>
      boxes.find(box => box.currency === currency && box.warehouseId === warehouseId) ?? boxes.find(box => box.currency === currency && !box.warehouseId);

    let vouchersCreated = 0; let ledgerEntries = 0;
    const postDocument = async (kind: 'sale' | 'purchase' | 'sales_return' | 'purchase_return', document: any, paymentRows: any[]) => {
      const isSale = kind === 'sale'; const isPurchase = kind === 'purchase'; const isSalesReturn = kind === 'sales_return';
      const documentNumber = document.invoice_number ?? document.purchase_number ?? document.return_number;
      const partnerId = document.customer_partner_id ?? document.supplier_partner_id ?? document.partner_id;
      const rate = String(document.exchange_rate_syp_per_usd);
      const base = new Date().toISOString();
      const direction = isSale ? 'debit' : isPurchase ? 'credit' : isSalesReturn ? 'credit' : 'debit';
      const entryType = isSale ? 'sale' : isPurchase ? 'purchase' : kind;
      const label = isSale ? 'فاتورة بيع' : isPurchase ? 'فاتورة شراء' : isSalesReturn ? 'مرتجع مبيعات' : 'مرتجع مشتريات';
      await client`
        insert into partner_ledger_entries (partner_id, entry_type, debit_usd, credit_usd, currency, original_amount, exchange_rate_syp_per_usd,
          sales_invoice_id, purchase_invoice_id, return_invoice_id, document_number, description, warehouse_id, occurred_at, actor_user_id)
        values (${partnerId}, ${entryType}, ${direction === 'debit' ? document.final_total_usd : 0}, ${direction === 'credit' ? document.final_total_usd : 0},
          'USD', ${document.final_total_usd}, ${rate},
          ${isSale ? document.id : null}, ${isPurchase ? document.id : null}, ${isSale || isPurchase ? null : document.id},
          ${documentNumber}, ${`${label} ${documentNumber}`}, ${document.warehouse_id}, ${base}, ${actor.id})`;
      ledgerEntries += 1;

      for (const [index, payment] of paymentRows.entries()) {
        if (payment.method === 'credit_note') continue;
        const currency = payment.method === 'cash_syp' ? 'SYP' : 'USD';
        const amount = currency === 'SYP' ? Number(payment.amount_syp) : Number(payment.amount_usd);
        if (!(amount > 0)) continue;
        const box = cashboxFor(currency, document.warehouse_id);
        if (!box) { console.warn(`  ! skipped ${documentNumber}: no default ${currency} cashbox`); continue; }
        const voucherKind = isSale || kind === 'purchase_return' ? 'receipt' : 'payment';
        const prefix = voucherKind === 'receipt' ? 'RCV' : 'PAY';
        const year = new Date().getUTCFullYear();
        const sequence = (await client`
          insert into voucher_sequences (year, type, last_number) values (${year}, ${voucherKind}, 1)
          on conflict (year, type) do update set last_number = voucher_sequences.last_number + 1, updated_at = now() returning last_number`)[0]!.last_number as number;
        const usdEquivalent = currency === 'USD' ? amount : amount / Number(rate);
        const systemNote = isSale ? `دخول آلي عن فاتورة بيع ${documentNumber}` : isPurchase ? `خروج آلي عن فاتورة شراء ${documentNumber}` : isSalesReturn ? `رد مبلغ للعميل عن مرتجع ${documentNumber}` : `دخول من المورد عن مرتجع مشتريات ${documentNumber}`;
        const inserted = await client`
          insert into vouchers (voucher_number, voucher_year, sequence_number, type, source_type, source_payment_id, source_document_number,
            sales_invoice_id, purchase_invoice_id, return_invoice_id, partner_id, partner_name_snapshot, cashbox_id, warehouse_id,
            currency, amount, exchange_rate_syp_per_usd, amount_usd_equivalent, system_note, idempotency_key, created_by_user_id, updated_by_user_id)
          values (${`${prefix}-${year}-${String(sequence).padStart(3, '0')}`}, ${year}, ${sequence}, ${voucherKind}, ${isSale ? 'sale' : isPurchase ? 'purchase' : kind}, ${payment.id}, ${documentNumber},
            ${isSale ? document.id : null}, ${isPurchase ? document.id : null}, ${isSale || isPurchase ? null : document.id}, ${partnerId}, ${document.partner_name}, ${box.id}, ${document.warehouse_id},
            ${currency}, ${amount}, ${rate}, ${usdEquivalent}, ${systemNote}, ${`backfill:${kind}:${payment.id}`}, ${actor.id}, ${actor.id})
          on conflict do nothing returning id`;
        const voucherId = inserted[0]?.id as string | undefined;
        if (!voucherId) continue;
        vouchersCreated += 1;
        await client`
          insert into cash_movements (cashbox_id, voucher_id, direction, amount, currency, exchange_rate_syp_per_usd, amount_usd_equivalent,
            partner_id, warehouse_id, sales_invoice_id, purchase_invoice_id, return_invoice_id, actor_user_id, description)
          values (${box.id}, ${voucherId}, ${voucherKind === 'receipt' ? 'inflow' : 'outflow'}, ${amount}, ${currency}, ${rate}, ${usdEquivalent},
            ${partnerId}, ${document.warehouse_id}, ${isSale ? document.id : null}, ${isPurchase ? document.id : null}, ${isSale || isPurchase ? null : document.id}, ${actor.id}, ${`${prefix}-${year}-${String(sequence).padStart(3, '0')} — ${systemNote}`})`;
        const paymentDirection = isSale || kind === 'purchase_return' ? 'credit' : 'debit';
        await client`
          insert into partner_ledger_entries (partner_id, entry_type, debit_usd, credit_usd, currency, original_amount, exchange_rate_syp_per_usd,
            sales_invoice_id, purchase_invoice_id, return_invoice_id, voucher_id, document_number, description, warehouse_id, occurred_at, actor_user_id)
          values (${partnerId}, ${paymentDirection === 'credit' ? 'receipt' : 'payment'}, ${paymentDirection === 'debit' ? usdEquivalent : 0}, ${paymentDirection === 'credit' ? usdEquivalent : 0},
            ${currency}, ${amount}, ${rate}, ${isSale ? document.id : null}, ${isPurchase ? document.id : null}, ${isSale || isPurchase ? null : document.id},
            ${voucherId}, ${`${prefix}-${year}-${String(sequence).padStart(3, '0')}`}, ${systemNote}, ${document.warehouse_id}, ${new Date(new Date(base).getTime() + index + 1).toISOString()}, ${actor.id})`;
        ledgerEntries += 1;
      }
    };

    for (const sale of sales) await postDocument('sale', sale, await client`select * from sales_payments where sales_invoice_id = ${sale.id} order by created_at`);
    for (const purchase of purchases) await postDocument('purchase', purchase, await client`select * from purchase_payments where purchase_invoice_id = ${purchase.id} order by created_at`);
    for (const document of returns) await postDocument(document.type as 'sales_return' | 'purchase_return', document, await client`select * from return_payments where return_invoice_id = ${document.id} order by created_at`);

    const totals = await db.select({ entries: sql<number>`count(*)::int` }).from(partnerLedgerEntries);
    console.log(`Backfill complete. Vouchers created: ${vouchersCreated}. Ledger entries written: ${ledgerEntries}. Ledger rows now: ${totals[0]?.entries ?? 0}.`);
  } finally {
    await client.end();
  }
}

void main();
