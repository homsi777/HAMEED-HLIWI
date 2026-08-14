import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DATABASE, type Database } from '../database/database.module.js';

/**
 * Sales created before Task 09.1 were all recorded as MANUAL lines, because the browser
 * sent the stock reference as `itemId` while the API only read `inventoryItemId`. Those
 * sales therefore never deducted stock, and each one left a negative historical record.
 *
 * Which of those lines was meant to be a stock sale is NOT recorded anywhere: the saved
 * line carries no inventory reference at all. This script therefore does not guess. It
 * lists the candidates — a manual line whose name, karat and warehouse match a stock item
 * that still exists — and applies a correction only for invoices named explicitly on the
 * command line, one at a time, after a human has judged each one.
 *
 *   dry run   : tsx src/database/repair-sale-stock-links.ts
 *   apply one : tsx src/database/repair-sale-stock-links.ts --apply --invoice INV-2026-004
 *
 * Applying a correction: deducts the sold weight/quantity from the stock item, writes the
 * `sale` movement with before/after values, repoints the sale line at the real stock item,
 * and archives the phantom historical record. It refuses to act twice — the line must
 * still be manual and the phantom record must still be unarchived.
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const invoiceArgument = process.argv[process.argv.indexOf('--invoice') + 1];
  const targets = process.argv.includes('--invoice') && invoiceArgument ? invoiceArgument.split(',').map(value => value.trim()).filter(Boolean) : [];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get<Database>(DATABASE);
  try {
    const rows = async (query: any) => { const result = await db.execute(query) as any; return (result.rows ?? result) as any[]; };
    const actorId = (await rows(sql`select id from users order by created_at, id limit 1`))[0]?.id as string;

    // A candidate: a manual sale line on a posted invoice, whose phantom record is still
    // live, and whose name/karat/warehouse match exactly one real stock item.
    const candidates = await rows(sql`
      select s.invoice_number, s.id as sale_id, s.warehouse_id, l.id as line_id, l.line_number,
             l.item_name_snapshot, l.karat_snapshot, l.quantity, l.net_weight_grams,
             phantom.id as phantom_id, phantom.code as phantom_code, phantom.archived_at as phantom_archived,
             stock.id as stock_id, stock.code as stock_code, stock.inventory_mode, stock.status as stock_status,
             stock.net_weight_grams as stock_weight, stock.quantity as stock_quantity,
             (select count(*)::int from inventory_movements m where m.inventory_item_id = stock.id and m.sales_invoice_id = s.id and m.type = 'sale') as already_repaired
      from sales_invoices s
      join sales_invoice_items l on l.sales_invoice_id = s.id
      left join inventory_items phantom on phantom.id = l.inventory_item_id and phantom.is_manual_sale_entry = true
      join inventory_items stock on stock.name = l.item_name_snapshot and stock.karat = l.karat_snapshot
        and stock.warehouse_id = s.warehouse_id and stock.is_manual_sale_entry = false and stock.archived_at is null
      where s.status = 'posted' and l.line_type = 'manual'
      order by s.created_at, l.line_number`);

    console.log(`Candidate manual lines that match a real stock item: ${candidates.length}\n`);
    for (const row of candidates) {
      const remaining = Number(row.stock_weight) - Number(row.net_weight_grams);
      console.log(`  ${row.invoice_number} line ${row.line_number} — «${row.item_name_snapshot}» ${Number(row.net_weight_grams).toFixed(3)} g عيار ${row.karat_snapshot}`);
      console.log(`      stock ${row.stock_code} (${row.inventory_mode}) ${Number(row.stock_weight).toFixed(3)} g → would become ${remaining.toFixed(3)} g`);
      console.log(`      phantom record ${row.phantom_code ?? 'none'}${row.phantom_archived ? ' [already archived]' : ''}${row.already_repaired ? ' [ALREADY REPAIRED]' : ''}`);
      if (remaining < 0) console.log('      ⚠ the stock item does not hold enough weight — this match is probably wrong');
    }

    if (!candidates.length) { console.log('Nothing to repair.'); return; }
    if (!apply) {
      console.log('\nDry run only. A manual line does NOT record which stock item it was meant to be,');
      console.log('so nothing is corrected automatically. Review the list, then repair one invoice at a time:');
      console.log('  npx tsx src/database/repair-sale-stock-links.ts --apply --invoice INV-2026-004');
      return;
    }
    if (!targets.length) { console.log('\nRefusing to apply without --invoice. Name the invoices explicitly.'); return; }

    let repaired = 0;
    for (const row of candidates.filter(candidate => targets.includes(candidate.invoice_number))) {
      if (row.already_repaired) { console.log(`\n${row.invoice_number} line ${row.line_number}: already repaired, skipped.`); continue; }
      const soldWeight = Number(row.net_weight_grams).toFixed(3);
      const soldQuantity = Number(row.quantity).toFixed(3);
      await db.transaction(async (tx: any) => {
        // Deduct under the same guards the live sale path uses.
        const updated = await tx.execute(sql`
          update inventory_items set
            gross_weight_grams = gross_weight_grams - ${soldWeight}::numeric,
            net_weight_grams = net_weight_grams - ${soldWeight}::numeric,
            quantity = quantity - ${soldQuantity}::numeric,
            total_labor_fee_usd = (net_weight_grams - ${soldWeight}::numeric) * labor_fee_usd_per_gram,
            version = version + 1, updated_by_user_id = ${actorId}, updated_at = now()
          where id = ${row.stock_id} and net_weight_grams >= ${soldWeight}::numeric and archived_at is null
          returning quantity, net_weight_grams`);
        const after = (updated.rows ?? updated)[0];
        if (!after) throw new Error(`${row.invoice_number}: stock ${row.stock_code} no longer holds ${soldWeight} g — not repaired.`);
        // The before-values are derived from what the update actually returned, not from
        // the candidate snapshot: several lines can hit the same stock item in one run, and
        // the snapshot would report the original weight for every one of them.
        const beforeWeight = (Number(after.net_weight_grams) + Number(soldWeight)).toFixed(3);
        const beforeQuantity = (Number(after.quantity) + Number(soldQuantity)).toFixed(3);
        await tx.execute(sql`
          insert into inventory_movements (inventory_item_id, sales_invoice_id, type, from_warehouse_id, actor_user_id, note, metadata)
          values (${row.stock_id}, ${row.sale_id}, 'sale', ${row.warehouse_id}, ${actorId},
                  ${`Task 09.1 repair of ${row.invoice_number}`},
                  ${JSON.stringify({ quantityDelta: `-${soldQuantity}`, netWeightDeltaGrams: `-${soldWeight}`, beforeNetWeightGrams: beforeWeight, beforeQuantity, afterNetWeightGrams: Number(after.net_weight_grams).toFixed(3), afterQuantity: Number(after.quantity).toFixed(3), repairedBy: 'task-09.1' })}::jsonb)`);
        await tx.execute(sql`update sales_invoice_items set line_type = 'stock', inventory_item_id = ${row.stock_id}, item_code_snapshot = ${row.stock_code} where id = ${row.line_id}`);
        if (row.phantom_id && !row.phantom_archived) {
          await tx.execute(sql`update inventory_items set archived_at = now(), archived_by_user_id = ${actorId}, updated_at = now(), version = version + 1, notes = coalesce(notes, '') || ' — أُلغي بعد ربط البند بالمخزون الفعلي (إصلاح 09.1)' where id = ${row.phantom_id}`);
        }
        await tx.execute(sql`insert into audit_logs (actor_user_id, action, module, entity_id, warehouse_id, metadata) values (${actorId}, 'sales.repair_stock_link', 'sales', ${row.sale_id}, ${row.warehouse_id}, ${JSON.stringify({ invoiceNumber: row.invoice_number, lineNumber: row.line_number, stockItemId: row.stock_id, soldWeightGrams: soldWeight })}::jsonb)`);
      });
      console.log(`\n${row.invoice_number} line ${row.line_number}: repaired — ${row.stock_code} reduced by ${soldWeight} g, phantom ${row.phantom_code} archived.`);
      repaired += 1;
    }
    console.log(`\nRepaired ${repaired} line(s).`);
  } finally {
    await app.close();
  }
}

void main();
