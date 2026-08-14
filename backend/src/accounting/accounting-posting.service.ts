import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { accountMappings, accounts, cashboxes, journalEntries, journalEntryLines, journalSequences, partners } from '../database/schema.js';

export type CashCurrency = 'USD' | 'SYP';
export type SourceKind = 'manual' | 'opening' | 'sale' | 'purchase' | 'sales_return' | 'purchase_return' | 'voucher' | 'cashbox_transfer';

export type DraftLine = {
  accountId?: string;
  systemKey?: string;
  mappingKey?: string;
  debitUsd?: number;
  creditUsd?: number;
  currency?: CashCurrency;
  originalAmount?: number;
  exchangeRateSypPerUsd: number;
  partnerId?: string | null;
  cashboxId?: string | null;
  warehouseId?: string | null;
  salesInvoiceId?: string | null;
  purchaseInvoiceId?: string | null;
  returnInvoiceId?: string | null;
  voucherId?: string | null;
  cashboxTransferId?: string | null;
  memo?: string | null;
};

export type DraftJournal = {
  sourceType: SourceKind;
  sourceId?: string | null;
  sourceNumber?: string | null;
  postingEvent: string;
  description: string;
  entryDate?: Date;
  warehouseId?: string | null;
  partnerId?: string | null;
  lines: DraftLine[];
};

// Money is compared and stored at four decimals; nothing here uses loose float equality.
const round4 = (value: number) => Number(value.toFixed(4));
const EPSILON = 0.00005;

/**
 * The only place that writes accounting entries.
 *
 * Posting model (single, consistent — never mixed):
 *   sale               Dr Accounts Receivable      Cr Sales Revenue
 *   purchase           Dr Inventory/Purchases      Cr Accounts Payable
 *   receipt voucher    Dr Cash                     Cr Accounts Receivable
 *   payment voucher    Dr Accounts Payable         Cr Cash
 *   sales return       Dr Sales Returns            Cr Accounts Receivable
 *   refund voucher     Dr Accounts Receivable      Cr Cash
 *   purchase return    Dr Accounts Payable         Cr Inventory/Purchases
 *   supplier refund    Dr Cash                     Cr Accounts Payable
 *   expense voucher    Dr Expense account          Cr Cash
 *   cashbox transfer   Dr Destination cash         Cr Source cash
 *
 * Invoices recognise revenue and the receivable; vouchers settle it. A payment is
 * therefore accounted exactly once, whichever document the user started from.
 */
@Injectable()
export class AccountingPostingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async accountBySystemKey(tx: any, systemKey: string) {
    const row = (await tx.select().from(accounts).where(and(eq(accounts.systemKey, systemKey), eq(accounts.isActive, true), isNull(accounts.archivedAt))).limit(1))[0];
    if (!row) throw new ConflictException(`Accounting is not configured: the system account "${systemKey}" is missing. Configure the chart of accounts before posting.`);
    return row;
  }

  async accountByMapping(tx: any, mappingKey: string, label: string) {
    const row = (await tx.select({ account: accounts }).from(accountMappings).innerJoin(accounts, eq(accounts.id, accountMappings.accountId)).where(eq(accountMappings.mappingKey, mappingKey)).limit(1))[0];
    if (!row) throw new ConflictException(`Accounting is not configured: ${label} has no mapped account (${mappingKey}). Map it before posting.`);
    return row.account;
  }

  // A cashbox always gets its own leaf account under the parent for its currency. The
  // code is derived, never guessed, and the operation is safe to repeat.
  async ensureCashboxAccount(tx: any, user: AuthIdentity, cashbox: { id: string; name: string; currency: CashCurrency; warehouseId: string | null }) {
    const mappingKey = `cashbox:${cashbox.id}`;
    const existing = (await tx.select({ account: accounts }).from(accountMappings).innerJoin(accounts, eq(accounts.id, accountMappings.accountId)).where(eq(accountMappings.mappingKey, mappingKey)).limit(1))[0];
    if (existing) return existing.account;
    const parent = await this.accountBySystemKey(tx, cashbox.currency === 'USD' ? 'cash_usd_parent' : 'cash_syp_parent');
    const nextCode = (await tx.select({ code: sql<string>`coalesce(max(${accounts.code}), ${parent.code + '000'})` }).from(accounts).where(sql`${accounts.code} like ${parent.code + '%'} and length(${accounts.code}) = ${parent.code.length + 3}`))[0]!.code;
    const code = `${parent.code}${String(Number(nextCode.slice(parent.code.length)) + 1).padStart(3, '0')}`;
    const account = (await tx.insert(accounts).values({
      code, nameAr: cashbox.name, accountClass: 'asset', normalBalance: 'debit', allowsPosting: true, isSystem: true,
      parentAccountId: parent.id, warehouseId: cashbox.warehouseId, currency: cashbox.currency, createdByUserId: user.id, updatedByUserId: user.id,
    }).returning())[0]!;
    await tx.insert(accountMappings).values({ mappingKey, accountId: account.id, description: `صندوق ${cashbox.name}`, createdByUserId: user.id }).onConflictDoNothing();
    return account;
  }

  // Resolves the account for a cashbox, provisioning it on first use. The code and
  // parent are derived from the cashbox's own currency, so nothing is ever guessed.
  async cashboxAccount(tx: any, user: AuthIdentity, cashboxId: string) {
    const mapped = (await tx.select({ account: accounts }).from(accountMappings).innerJoin(accounts, eq(accounts.id, accountMappings.accountId)).where(eq(accountMappings.mappingKey, `cashbox:${cashboxId}`)).limit(1))[0];
    if (mapped) return mapped.account;
    const cashbox = (await tx.select().from(cashboxes).where(eq(cashboxes.id, cashboxId)).limit(1))[0];
    if (!cashbox) throw new ConflictException('Accounting is not configured: the cashbox behind this movement no longer exists.');
    return this.ensureCashboxAccount(tx, user, { id: cashbox.id, name: cashbox.name, currency: cashbox.currency as CashCurrency, warehouseId: cashbox.warehouseId });
  }

  // A partner keeps their whole relationship on one control account, so the side is
  // decided by who they are rather than by the direction of a single payment.
  async partnerType(tx: any, partnerId: string | null | undefined) {
    if (!partnerId) return null;
    const row = (await tx.select({ type: partners.type }).from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
    return row?.type ?? null;
  }

  // Expense categories map to their own child account so the ledger stays readable.
  async ensureExpenseAccount(tx: any, user: AuthIdentity, category: string) {
    const mappingKey = `expense_category:${category}`;
    const existing = (await tx.select({ account: accounts }).from(accountMappings).innerJoin(accounts, eq(accounts.id, accountMappings.accountId)).where(eq(accountMappings.mappingKey, mappingKey)).limit(1))[0];
    if (existing) return existing.account;
    const parent = await this.accountBySystemKey(tx, 'operating_expenses');
    const nextCode = (await tx.select({ code: sql<string>`coalesce(max(${accounts.code}), ${parent.code + '000'})` }).from(accounts).where(sql`${accounts.code} like ${parent.code + '%'} and length(${accounts.code}) = ${parent.code.length + 3}`))[0]!.code;
    const code = `${parent.code}${String(Number(nextCode.slice(parent.code.length)) + 1).padStart(3, '0')}`;
    const account = (await tx.insert(accounts).values({ code, nameAr: category, accountClass: 'expense', normalBalance: 'debit', allowsPosting: true, isSystem: false, parentAccountId: parent.id, createdByUserId: user.id, updatedByUserId: user.id }).returning())[0]!;
    await tx.insert(accountMappings).values({ mappingKey, accountId: account.id, description: `مصروف ${category}`, createdByUserId: user.id }).onConflictDoNothing();
    return account;
  }

  /**
   * Validates and writes one journal. Returns the existing entry untouched when the same
   * source event was already posted, so a retry can never double-account anything.
   */
  async post(tx: any, user: AuthIdentity, draft: DraftJournal) {
    if (draft.sourceId) {
      const already = (await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, draft.sourceType), eq(journalEntries.sourceId, draft.sourceId), eq(journalEntries.postingEvent, draft.postingEvent))).limit(1))[0];
      if (already) return already;
    }

    const resolved: Array<{ line: DraftLine; accountId: string; debit: number; credit: number }> = [];
    for (const [index, line] of draft.lines.entries()) {
      const debit = round4(line.debitUsd ?? 0); const credit = round4(line.creditUsd ?? 0);
      if (debit > 0 && credit > 0) throw new ConflictException(`Journal line ${index + 1} cannot be both debit and credit.`);
      if (debit <= 0 && credit <= 0) continue;
      const account = line.accountId
        ? (await tx.select().from(accounts).where(eq(accounts.id, line.accountId)).limit(1))[0]
        : line.systemKey ? await this.accountBySystemKey(tx, line.systemKey) : await this.accountByMapping(tx, line.mappingKey!, line.memo ?? 'account');
      if (!account) throw new ConflictException(`Journal line ${index + 1} references an unknown account.`);
      if (!account.isActive || account.archivedAt) throw new ConflictException(`Account ${account.code} is not active and cannot be posted to.`);
      if (!account.allowsPosting) throw new ConflictException(`Account ${account.code} is a heading and does not allow direct posting.`);
      resolved.push({ line, accountId: account.id, debit, credit });
    }

    if (resolved.length < 2) throw new ConflictException('A journal entry needs at least two lines.');
    const totalDebit = round4(resolved.reduce((sum, row) => sum + row.debit, 0));
    const totalCredit = round4(resolved.reduce((sum, row) => sum + row.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > EPSILON) throw new ConflictException(`Journal entry is unbalanced: debit ${totalDebit.toFixed(4)} vs credit ${totalCredit.toFixed(4)}.`);
    if (totalDebit <= 0) throw new ConflictException('A journal entry must move a non-zero amount.');

    const year = (draft.entryDate ?? new Date()).getUTCFullYear();
    const sequence = (await tx.insert(journalSequences).values({ year, lastNumber: 1 }).onConflictDoUpdate({ target: journalSequences.year, set: { lastNumber: sql`${journalSequences.lastNumber} + 1`, updatedAt: new Date() } }).returning())[0]!.lastNumber;
    const entry = (await tx.insert(journalEntries).values({
      journalNumber: `JRN-${year}-${String(sequence).padStart(6, '0')}`, journalYear: year, sequenceNumber: sequence, entryDate: draft.entryDate ?? new Date(),
      sourceType: draft.sourceType, sourceId: draft.sourceId ?? null, sourceNumber: draft.sourceNumber ?? null, postingEvent: draft.postingEvent,
      description: draft.description, warehouseId: draft.warehouseId ?? null, partnerId: draft.partnerId ?? null,
      totalDebitUsd: totalDebit.toFixed(4), totalCreditUsd: totalCredit.toFixed(4), createdByUserId: user.id, postedByUserId: user.id,
    }).returning())[0]!;

    for (const [index, row] of resolved.entries()) {
      const amountUsd = row.debit > 0 ? row.debit : row.credit;
      await tx.insert(journalEntryLines).values({
        journalEntryId: entry.id, lineNumber: index + 1, accountId: row.accountId,
        debitUsd: row.debit.toFixed(4), creditUsd: row.credit.toFixed(4),
        currency: row.line.currency ?? 'USD', originalAmount: round4(row.line.originalAmount ?? amountUsd).toFixed(4), exchangeRateSypPerUsd: row.line.exchangeRateSypPerUsd.toFixed(4),
        partnerId: row.line.partnerId ?? draft.partnerId ?? null, cashboxId: row.line.cashboxId ?? null, warehouseId: row.line.warehouseId ?? draft.warehouseId ?? null,
        salesInvoiceId: row.line.salesInvoiceId ?? null, purchaseInvoiceId: row.line.purchaseInvoiceId ?? null, returnInvoiceId: row.line.returnInvoiceId ?? null, voucherId: row.line.voucherId ?? null, cashboxTransferId: row.line.cashboxTransferId ?? null,
        memo: row.line.memo ?? null,
      });
    }
    return entry;
  }

  // A correction is always a new, opposite journal; the original is never rewritten.
  async reverse(tx: any, user: AuthIdentity, journalId: string, reason: string) {
    const original = (await tx.select().from(journalEntries).where(eq(journalEntries.id, journalId)).limit(1))[0];
    if (!original) throw new ConflictException('Journal entry not found.');
    if (original.status === 'reversed') return null;
    const lines = await tx.select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, journalId));
    const reversal = await this.post(tx, user, {
      sourceType: original.sourceType, sourceId: original.sourceId, sourceNumber: original.sourceNumber, postingEvent: `${original.postingEvent}:reversal`,
      description: `عكس القيد ${original.journalNumber}: ${reason}`, warehouseId: original.warehouseId, partnerId: original.partnerId,
      lines: lines.map((line: any) => ({
        accountId: line.accountId, debitUsd: Number(line.creditUsd), creditUsd: Number(line.debitUsd),
        currency: line.currency, originalAmount: Number(line.originalAmount), exchangeRateSypPerUsd: Number(line.exchangeRateSypPerUsd),
        partnerId: line.partnerId, cashboxId: line.cashboxId, warehouseId: line.warehouseId,
        salesInvoiceId: line.salesInvoiceId, purchaseInvoiceId: line.purchaseInvoiceId, returnInvoiceId: line.returnInvoiceId, voucherId: line.voucherId, cashboxTransferId: line.cashboxTransferId,
        memo: `عكس: ${line.memo ?? ''}`.trim(),
      })),
    });
    await tx.update(journalEntries).set({ status: 'reversed', reversedByJournalId: reversal.id, updatedAt: new Date() }).where(eq(journalEntries.id, journalId));
    await tx.update(journalEntries).set({ reversalOfJournalId: journalId, updatedAt: new Date() }).where(eq(journalEntries.id, reversal.id));
    return reversal;
  }

  async reverseSource(tx: any, user: AuthIdentity, sourceType: SourceKind, sourceId: string, reason: string) {
    const posted = await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId), eq(journalEntries.status, 'posted'), isNull(journalEntries.reversalOfJournalId)));
    let count = 0;
    for (const entry of posted) { if (await this.reverse(tx, user, entry.id, reason)) count += 1; }
    return count;
  }
}
