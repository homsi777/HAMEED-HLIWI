import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { goldAccounts, goldLedgerEntries, goldTransactionSequences, goldTransactions, partners, warehouses } from '../database/schema.js';

export const KARATS = ['24', '22', '21', '18', '14'] as const;
export type Karat = (typeof KARATS)[number];
export type GoldTransactionKind = 'opening' | 'sale_exchange' | 'sales_return_obligation' | 'purchase_settlement' | 'purchase_return_adjustment' | 'receipt' | 'payment' | 'conversion' | 'reversal' | 'used_inventory_conversion' | 'purchase_scrap';

const PREFIX: Record<GoldTransactionKind, string> = {
  opening: 'GOP', sale_exchange: 'GSX', sales_return_obligation: 'GSR', purchase_settlement: 'GPS',
  purchase_return_adjustment: 'GPR', receipt: 'GRC', payment: 'GPM', conversion: 'GCV', reversal: 'GRV',
  used_inventory_conversion: 'GUI', purchase_scrap: 'GSP',
};

export type GoldDraftLine = {
  accountId?: string;
  partnerId?: string | null;
  companyWarehouseId?: string | null;
  systemCode?: string;
  karat: Karat;
  debitGrams?: number;
  creditGrams?: number;
  goldPriceUsdPerGram?: number | null;
  valuationUsd?: number | null;
  warehouseId?: string | null;
  salesInvoiceId?: string | null;
  purchaseInvoiceId?: string | null;
  returnInvoiceId?: string | null;
  salesGoldExchangeId?: string | null;
  description: string;
};

export type GoldDraft = {
  type: GoldTransactionKind;
  sourceType?: string;
  sourceId?: string | null;
  sourceLineId?: string | null;
  sourceNumber?: string | null;
  postingEvent: string;
  description: string;
  userNote?: string | null;
  partnerId?: string | null;
  warehouseId?: string | null;
  occurredAt?: Date;
  idempotencyKey?: string;
  reversalOfTransactionId?: string | null;
  lines: GoldDraftLine[];
};

const grams = (value: number) => Number(value.toFixed(3));
const GRAM_EPSILON = 0.0005;
// Pure gold is computed with PostgreSQL numeric arithmetic at write time; this mirror is
// only used to check that a transaction balances before anything is written.
export const pureGold = (weightGrams: number, karat: string) => Number(((weightGrams * Number(karat)) / 24).toFixed(4));

/**
 * The only writer of gold movements.
 *
 * Every transaction must balance in PURE GOLD, not in raw grams — that is what makes a
 * karat conversion expressible (21K out, 18K in, same fine gold) while still refusing to
 * add grams of different purities together.
 */
@Injectable()
export class GoldPostingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  assertKarat(value: unknown, field = 'karat'): Karat {
    const karat = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (!(KARATS as readonly string[]).includes(karat)) throw new ConflictException(`${field} must be one of ${KARATS.join(', ')}.`);
    return karat as Karat;
  }

  // Each partner has exactly one gold account, created on first use.
  async partnerAccount(tx: any, user: AuthIdentity, partnerId: string) {
    const existing = (await tx.select().from(goldAccounts).where(and(eq(goldAccounts.kind, 'partner'), eq(goldAccounts.partnerId, partnerId))).limit(1))[0];
    if (existing) return existing;
    const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
    if (!partner) throw new ConflictException('The selected partner does not exist.');
    return (await tx.insert(goldAccounts).values({ kind: 'partner', name: partner.name, partnerId, createdByUserId: user.id }).returning())[0]!;
  }

  // The shop's own metal, held per branch, kept apart from partner obligations and from
  // sellable inventory rows.
  async companyAccount(tx: any, user: AuthIdentity, warehouseId: string | null) {
    const where = warehouseId ? and(eq(goldAccounts.kind, 'company'), eq(goldAccounts.warehouseId, warehouseId)) : and(eq(goldAccounts.kind, 'company'), isNull(goldAccounts.warehouseId));
    const existing = (await tx.select().from(goldAccounts).where(where).limit(1))[0];
    if (existing) return existing;
    const warehouse = warehouseId ? (await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1))[0] : null;
    return (await tx.insert(goldAccounts).values({ kind: 'company', name: warehouse ? `ذهب المحل — ${warehouse.name}` : 'ذهب المحل', warehouseId, createdByUserId: user.id }).returning())[0]!;
  }

  // Gold whose value an invoice already consumed. It is a company-side clearing account,
  // not metal on a shelf and not something a partner owes.
  async systemAccount(tx: any, user: AuthIdentity, systemCode: string) {
    const existing = (await tx.select().from(goldAccounts).where(eq(goldAccounts.systemCode, systemCode)).limit(1))[0];
    if (existing) return existing;
    const names: Record<string, string> = { sales_settlement: 'ذهب محتسب ضمن الفواتير', opening_gold: 'أرصدة الأوزان الافتتاحية', used_inventory: 'ذهب مستعمل ضمن المخزون', purchased_scrap: 'ذهب خاشر مشترى تحت المعالجة' };
    return (await tx.insert(goldAccounts).values({ kind: 'company', name: names[systemCode] ?? systemCode, systemCode, createdByUserId: user.id }).returning())[0]!;
  }

  async resolveAccount(tx: any, user: AuthIdentity, line: GoldDraftLine) {
    if (line.accountId) {
      const row = (await tx.select().from(goldAccounts).where(eq(goldAccounts.id, line.accountId)).limit(1))[0];
      if (!row) throw new ConflictException('The selected gold account does not exist.');
      if (!row.isActive) throw new ConflictException('The selected gold account is not active.');
      return row;
    }
    if (line.systemCode) return this.systemAccount(tx, user, line.systemCode);
    if (line.partnerId) return this.partnerAccount(tx, user, line.partnerId);
    return this.companyAccount(tx, user, line.companyWarehouseId ?? null);
  }

  /**
   * Validates and writes one gold transaction. Returns the existing one untouched when
   * the same source event was already posted, so a retry can never double-post metal.
   */
  async post(tx: any, user: AuthIdentity, draft: GoldDraft) {
    if (draft.sourceId) {
      const already = (await tx.select().from(goldTransactions).where(and(
        eq(goldTransactions.sourceType, draft.sourceType ?? 'manual'),
        eq(goldTransactions.sourceId, draft.sourceId),
        draft.sourceLineId ? eq(goldTransactions.sourceLineId, draft.sourceLineId) : isNull(goldTransactions.sourceLineId),
        eq(goldTransactions.postingEvent, draft.postingEvent),
      )).limit(1))[0];
      if (already) return already;
    }
    if (draft.idempotencyKey) {
      const already = (await tx.select().from(goldTransactions).where(eq(goldTransactions.idempotencyKey, draft.idempotencyKey)).limit(1))[0];
      if (already) return already;
    }

    const resolved: Array<{ line: GoldDraftLine; accountId: string; debit: number; credit: number; karat: Karat }> = [];
    for (const [index, line] of draft.lines.entries()) {
      const debit = grams(line.debitGrams ?? 0); const credit = grams(line.creditGrams ?? 0);
      if (debit > 0 && credit > 0) throw new ConflictException(`Gold line ${index + 1} cannot be both received and delivered.`);
      if (debit <= 0 && credit <= 0) continue;
      const karat = this.assertKarat(line.karat, `lines[${index}].karat`);
      const account = await this.resolveAccount(tx, user, line);
      resolved.push({ line, accountId: account.id, debit, credit, karat });
    }
    if (resolved.length < 2) throw new ConflictException('A gold transaction needs at least two sides.');

    // Balance is checked in pure gold so a karat conversion is expressible while grams of
    // different purities are never simply added together.
    const debitPure = resolved.reduce((sum, row) => sum + pureGold(row.debit, row.karat), 0);
    const creditPure = resolved.reduce((sum, row) => sum + pureGold(row.credit, row.karat), 0);
    if (Math.abs(debitPure - creditPure) > 0.001) throw new ConflictException(`Gold transaction is unbalanced: ${debitPure.toFixed(4)} g pure in versus ${creditPure.toFixed(4)} g pure out.`);
    if (debitPure <= 0) throw new ConflictException('A gold transaction must move a non-zero weight.');

    const year = (draft.occurredAt ?? new Date()).getUTCFullYear();
    const sequence = (await tx.insert(goldTransactionSequences).values({ year, type: draft.type, lastNumber: 1 }).onConflictDoUpdate({ target: [goldTransactionSequences.year, goldTransactionSequences.type], set: { lastNumber: sql`${goldTransactionSequences.lastNumber} + 1`, updatedAt: new Date() } }).returning())[0]!.lastNumber;

    const transaction = (await tx.insert(goldTransactions).values({
      transactionNumber: `${PREFIX[draft.type]}-${year}-${String(sequence).padStart(3, '0')}`, transactionYear: year, sequenceNumber: sequence, type: draft.type,
      partnerId: draft.partnerId ?? null, warehouseId: draft.warehouseId ?? null,
      sourceType: draft.sourceType ?? 'manual', sourceId: draft.sourceId ?? null, sourceLineId: draft.sourceLineId ?? null, sourceNumber: draft.sourceNumber ?? null, postingEvent: draft.postingEvent,
      description: draft.description, userNote: draft.userNote ?? null, reversalOfTransactionId: draft.reversalOfTransactionId ?? null,
      idempotencyKey: draft.idempotencyKey ?? `${draft.type}:${draft.postingEvent}:${draft.sourceId ?? crypto.randomUUID()}`,
      occurredAt: draft.occurredAt ?? new Date(), createdByUserId: user.id,
    }).returning())[0]!;

    for (const [index, row] of resolved.entries()) {
      const weight = row.debit > 0 ? row.debit : row.credit;
      await tx.insert(goldLedgerEntries).values({
        goldTransactionId: transaction.id, lineNumber: index + 1, goldAccountId: row.accountId, karat: row.karat,
        debitGrams: row.debit.toFixed(3), creditGrams: row.credit.toFixed(3),
        // PostgreSQL numeric arithmetic is the authority for the pure-gold equivalent.
        pureGoldGrams: sql`round((${weight.toFixed(3)}::numeric * ${row.karat}::numeric / 24), 4)`,
        goldPriceUsdPerGram: row.line.goldPriceUsdPerGram != null ? row.line.goldPriceUsdPerGram.toFixed(4) : null,
        valuationUsd: row.line.valuationUsd != null ? row.line.valuationUsd.toFixed(4) : null,
        partnerId: row.line.partnerId ?? draft.partnerId ?? null, warehouseId: row.line.warehouseId ?? draft.warehouseId ?? null,
        salesInvoiceId: row.line.salesInvoiceId ?? null, purchaseInvoiceId: row.line.purchaseInvoiceId ?? null, returnInvoiceId: row.line.returnInvoiceId ?? null, salesGoldExchangeId: row.line.salesGoldExchangeId ?? null,
        description: row.line.description, occurredAt: draft.occurredAt ?? new Date(), actorUserId: user.id,
      });
    }
    return transaction;
  }

  // Balance of one account, per karat. Never a stored number.
  async accountBalances(accountId: string, db: any = this.db) {
    const rows = await db.select({
      karat: goldLedgerEntries.karat,
      grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)`,
      pure: sql<string>`coalesce(sum(case when ${goldLedgerEntries.debitGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else -${goldLedgerEntries.pureGoldGrams} end), 0)`,
    }).from(goldLedgerEntries).where(eq(goldLedgerEntries.goldAccountId, accountId)).groupBy(goldLedgerEntries.karat);
    return rows.map((row: any) => ({ karat: row.karat, grams: Number(Number(row.grams).toFixed(3)), pureGoldGrams: Number(Number(row.pure).toFixed(4)) })).filter((row: any) => Math.abs(row.grams) > GRAM_EPSILON);
  }

  // What the partner still owes at this karat, locked for update so two cashiers cannot
  // settle the same obligation twice.
  async lockedPartnerBalance(tx: any, user: AuthIdentity, partnerId: string, karat: Karat) {
    const account = await this.partnerAccount(tx, user, partnerId);
    await tx.select({ id: goldAccounts.id }).from(goldAccounts).where(eq(goldAccounts.id, account.id)).limit(1).for('update');
    const rows = await tx.select({ grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)` })
      .from(goldLedgerEntries).where(and(eq(goldLedgerEntries.goldAccountId, account.id), eq(goldLedgerEntries.karat, karat)));
    return { account, grams: Number(Number(rows[0]?.grams ?? 0).toFixed(3)) };
  }

  // A correction is a new, opposite transaction; the original is never rewritten.
  async reverse(tx: any, user: AuthIdentity, transactionId: string, reason: string) {
    const original = (await tx.select().from(goldTransactions).where(eq(goldTransactions.id, transactionId)).limit(1))[0];
    if (!original) throw new ConflictException('Gold transaction not found.');
    if (original.status === 'reversed') return null;
    const lines = await tx.select().from(goldLedgerEntries).where(eq(goldLedgerEntries.goldTransactionId, transactionId));
    const reversal = await this.post(tx, user, {
      type: 'reversal', sourceType: original.sourceType, sourceId: original.sourceId, sourceLineId: original.sourceLineId, sourceNumber: original.sourceNumber,
      postingEvent: `${original.postingEvent}:reversal`, description: `عكس حركة الذهب ${original.transactionNumber}: ${reason}`,
      partnerId: original.partnerId, warehouseId: original.warehouseId,
      lines: lines.map((line: any) => ({
        accountId: line.goldAccountId, karat: line.karat, debitGrams: Number(line.creditGrams), creditGrams: Number(line.debitGrams),
        goldPriceUsdPerGram: line.goldPriceUsdPerGram ? Number(line.goldPriceUsdPerGram) : null, valuationUsd: line.valuationUsd ? Number(line.valuationUsd) : null,
        partnerId: line.partnerId, warehouseId: line.warehouseId, salesInvoiceId: line.salesInvoiceId, purchaseInvoiceId: line.purchaseInvoiceId, returnInvoiceId: line.returnInvoiceId, salesGoldExchangeId: line.salesGoldExchangeId,
        description: `عكس: ${line.description}`,
      })),
    });
    await tx.update(goldTransactions).set({ status: 'reversed', reversedByTransactionId: reversal.id, updatedAt: new Date() }).where(eq(goldTransactions.id, transactionId));
    await tx.update(goldTransactions).set({ reversalOfTransactionId: transactionId, updatedAt: new Date() }).where(eq(goldTransactions.id, reversal.id));
    return reversal;
  }

  async reverseSource(tx: any, user: AuthIdentity, sourceType: string, sourceId: string, reason: string) {
    const posted = await tx.select().from(goldTransactions).where(and(eq(goldTransactions.sourceType, sourceType), eq(goldTransactions.sourceId, sourceId), eq(goldTransactions.status, 'posted'), isNull(goldTransactions.reversalOfTransactionId)));
    let count = 0;
    for (const transaction of posted) { if (await this.reverse(tx, user, transaction.id, reason)) count += 1; }
    return count;
  }
}
