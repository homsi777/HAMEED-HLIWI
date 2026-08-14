import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DocumentNumberService, type DocumentKind } from '../common/document-number.service.js';
import { DATABASE, type Database } from '../database/database.module.js';

/**
 * Restates existing documents in the plain-number format the owner asked for.
 *
 * A document number is copied into a lot of free text — voucher notes, journal
 * descriptions, ledger memos, the code of the historical stock row a manual sale leaves
 * behind. Rather than trusting a list written by hand, this scans every text and jsonb
 * column in the database for the old pattern and rewrites each one, so no stale reference
 * survives in a note that someone later reads.
 *
 * Run without arguments for a dry run; add --apply to write.
 */
type Target = { kind: DocumentKind; table: string; column: string; order: string };

const TARGETS: Target[] = [
  { kind: 'sale', table: 'sales_invoices', column: 'invoice_number', order: 'created_at, id' },
  { kind: 'purchase', table: 'purchase_invoices', column: 'purchase_number', order: 'created_at, id' },
  { kind: 'return', table: 'return_invoices', column: 'return_number', order: 'created_at, id' },
  { kind: 'voucher', table: 'vouchers', column: 'voucher_number', order: 'created_at, id' },
  { kind: 'transfer', table: 'cashbox_transfers', column: 'transfer_number', order: 'created_at, id' },
];

// What an un-renumbered document still looks like.
const LEGACY = '^(INV|PUR|RET|RCV|PAY|EXP|TRF)-[0-9]{4}-[0-9]+$';

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get<Database>(DATABASE);
  const numbers = app.get(DocumentNumberService);
  try {
    const rows = async (query: any) => { const result = await db.execute(query) as any; return (result.rows ?? result) as any[]; };

    // Every document of each kind is renumbered in creation order, including ones already
    // renumbered by an earlier run, so the sequence stays dense and stable.
    const plan: Array<{ kind: DocumentKind; table: string; column: string; id: string; from: string; to: string }> = [];
    for (const target of TARGETS) {
      const documents = await rows(sql.raw(`select id, ${target.column} as number from ${target.table} order by ${target.order}`));
      documents.forEach((document, index) => {
        const next = numbers.format(target.kind, index + 1);
        if (document.number !== next) plan.push({ kind: target.kind, table: target.table, column: target.column, id: document.id, from: document.number, to: next });
      });
      console.log(`${target.table.padEnd(20)} ${String(documents.length).padStart(4)} document(s) → ${documents.length ? `${numbers.format(target.kind, 1)} … ${numbers.format(target.kind, documents.length)}` : 'none'}`);
    }

    console.log(`\nDocuments to renumber: ${plan.length}`);
    for (const entry of plan.slice(0, 40)) console.log(`  ${entry.from.padEnd(16)} → ${entry.to}`);
    if (plan.length > 40) console.log(`  … and ${plan.length - 40} more`);

    // Where the old number is also stored as text, found by scanning rather than by memory.
    const columns = await rows(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')
      order by table_name, column_name`);
    const patterns = plan.map(entry => entry.from);
    const copies: Array<{ table: string; column: string; type: string; hits: number }> = [];
    for (const column of columns) {
      if (!patterns.length) break;
      const hits = await rows(sql.raw(`select count(*)::int as n from public."${column.table_name}" where "${column.column_name}"::text ~ '(${patterns.join('|')})'`));
      if (hits[0].n > 0) copies.push({ table: column.table_name, column: column.column_name, type: column.data_type, hits: hits[0].n });
    }
    console.log(`\nColumns holding a copy of an old number: ${copies.length}`);
    for (const copy of copies) console.log(`  ${copy.table}.${copy.column} (${copy.type}) — ${copy.hits} row(s)`);

    if (!plan.length) { console.log('\nEverything is already in the new format. Nothing to do.'); return; }
    if (!apply) { console.log('\nDry run only. Re-run with --apply to rewrite.'); return; }

    await db.transaction(async (tx: any) => {
      // The rename happens in one transaction: a half-renumbered database would show two
      // formats at once and break every reference between them.
      for (const entry of plan) {
        await tx.execute(sql.raw(`update ${entry.table} set ${entry.column} = '${entry.to}' where id = '${entry.id}'`));
      }
      // Longest first, so one old number can never be rewritten inside another.
      const ordered = [...plan].sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from));
      // Applied in chunks: nesting a thousand replace() calls into one statement is what
      // turns a rename into an unreadable multi-megabyte query.
      const CHUNK = 150;
      for (const copy of copies) {
        const isJson = copy.type === 'jsonb';
        for (let index = 0; index < ordered.length; index += CHUNK) {
          const batch = ordered.slice(index, index + CHUNK);
          const replacement = batch.reduce((expression, entry) => `replace(${expression}, '${entry.from}', '${entry.to}')`, `"${copy.column}"::text`);
          const match = batch.map(entry => entry.from).join('|');
          await tx.execute(sql.raw(`update public."${copy.table}" set "${copy.column}" = ${replacement}${isJson ? '::jsonb' : ''} where "${copy.column}"::text ~ '(${match})'`));
        }
      }
      // The counters continue from what was just assigned.
      for (const target of TARGETS) {
        const total = (await tx.execute(sql.raw(`select count(*)::int as n from ${target.table}`)) as any).rows?.[0] ?? (await tx.execute(sql.raw(`select count(*)::int as n from ${target.table}`)) as any)[0];
        await tx.execute(sql.raw(`insert into document_sequences (key, last_number) values ('${target.kind}', ${total.n}) on conflict (key) do update set last_number = greatest(document_sequences.last_number, ${total.n}), updated_at = now()`));
      }
    });

    const sequences = await rows(sql`select key, last_number from document_sequences order by key`);
    console.log(`\nRenumbered ${plan.length} document(s) and rewrote ${copies.length} column(s).`);
    console.log('Next numbers:', sequences.map(row => `${row.key}=${numbers.format(row.key as DocumentKind, row.last_number + 1)}`).join(' · '));
    const leftovers = await rows(sql.raw(`select count(*)::int as n from sales_invoices where invoice_number ~ '${LEGACY}'`));
    console.log(`Sales still carrying an old-format number: ${leftovers[0].n}`);
  } finally {
    await app.close();
  }
}

void main();
