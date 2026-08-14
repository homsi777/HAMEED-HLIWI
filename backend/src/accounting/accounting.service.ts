import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { accountMappings, accounts, cashMovements, cashboxes, journalEntries, journalEntryLines, partnerLedgerEntries, partners, users } from '../database/schema.js';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';
import { AccountingPostingService } from './accounting-posting.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLASSES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
const uuid = (value: unknown, field: string) => { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; };
const money = (value: unknown, field: string) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) throw new ConflictException(`${field} is invalid.`);
  return Number(raw);
};

@Injectable()
export class AccountingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AccountingPostingService) private readonly posting: AccountingPostingService,
  ) {}

  // ------------------------------------------------------------- chart of accounts
  async listAccounts(_user: AuthIdentity, query: Record<string, unknown>) {
    const conditions: any[] = [isNull(accounts.archivedAt)];
    if (query.accountClass && CLASSES.has(String(query.accountClass))) conditions.push(eq(accounts.accountClass, query.accountClass as any));
    if (query.postingOnly === 'true') conditions.push(eq(accounts.allowsPosting, true));
    if (typeof query.search === 'string' && query.search.trim()) conditions.push(or(ilike(accounts.code, `%${query.search.trim()}%`), ilike(accounts.nameAr, `%${query.search.trim()}%`)));
    const rows = await this.db.select().from(accounts).where(and(...conditions)).orderBy(asc(accounts.code));
    const balances = await this.db.select({ accountId: journalEntryLines.accountId, debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)` }).from(journalEntryLines).groupBy(journalEntryLines.accountId);
    return rows.map(account => {
      const totals = balances.find(row => row.accountId === account.id);
      const debit = Number(totals?.debit ?? 0); const credit = Number(totals?.credit ?? 0);
      return {
        id: account.id, code: account.code, nameAr: account.nameAr, nameEn: account.nameEn, parentAccountId: account.parentAccountId,
        accountClass: account.accountClass, normalBalance: account.normalBalance, allowsPosting: account.allowsPosting, isSystem: account.isSystem, systemKey: account.systemKey,
        isActive: account.isActive, warehouseId: account.warehouseId, currency: account.currency, notes: account.notes ?? '', version: account.version,
        totalDebitUSD: debit, totalCreditUSD: credit,
        balanceUSD: Number((account.normalBalance === 'debit' ? debit - credit : credit - debit).toFixed(4)),
      };
    });
  }

  async createAccount(user: AuthIdentity, input: Record<string, unknown>) {
    const code = this.text(input.code, 'code', 20);
    const nameAr = this.text(input.nameAr ?? input.name, 'nameAr', 160);
    const accountClass = typeof input.accountClass === 'string' && CLASSES.has(input.accountClass) ? input.accountClass as any : (() => { throw new ConflictException('accountClass is invalid.'); })();
    const normalBalance = input.normalBalance === 'credit' ? 'credit' : 'debit';
    const parentAccountId = input.parentAccountId ? uuid(input.parentAccountId, 'parentAccountId') : null;
    if (parentAccountId) { const parent = (await this.db.select().from(accounts).where(eq(accounts.id, parentAccountId)).limit(1))[0]; if (!parent) throw new ConflictException('The parent account does not exist.'); }
    const created = await this.db.transaction(async tx => {
      const row = (await tx.insert(accounts).values({ code, nameAr, nameEn: this.optional(input.nameEn, 160), parentAccountId, accountClass, normalBalance, allowsPosting: input.allowsPosting !== false, isSystem: false, notes: this.optional(input.notes, 500), createdByUserId: user.id, updatedByUserId: user.id }).returning())[0]!;
      await this.audit.record({ actorUserId: user.id, action: 'accounting.account.create', module: 'accounting', entityId: row.id, metadata: { code, nameAr, accountClass } }, tx);
      return row;
    });
    return (await this.listAccounts(user, {})).find(row => row.id === created.id)!;
  }

  async updateAccount(user: AuthIdentity, accountId: string, input: Record<string, unknown>) {
    accountId = uuid(accountId, 'id');
    const updated = await this.db.transaction(async tx => {
      const current = (await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1))[0];
      if (!current) throw new NotFoundException('Account not found.');
      // System accounts back the automatic postings; they may be renamed but never
      // deactivated, archived or turned into a non-posting heading.
      const wantsDeactivate = input.isActive === false || input.archived === true || input.allowsPosting === false;
      if (current.isSystem && wantsDeactivate) throw new ConflictException('This is a system account required by automatic posting and cannot be disabled or archived.');
      const row = (await tx.update(accounts).set({
        nameAr: input.nameAr === undefined ? current.nameAr : this.text(input.nameAr, 'nameAr', 160),
        nameEn: input.nameEn === undefined ? current.nameEn : this.optional(input.nameEn, 160),
        notes: input.notes === undefined ? current.notes : this.optional(input.notes, 500),
        isActive: input.isActive === undefined ? current.isActive : input.isActive === true,
        allowsPosting: input.allowsPosting === undefined ? current.allowsPosting : input.allowsPosting === true,
        archivedAt: input.archived === true ? new Date() : current.archivedAt,
        updatedByUserId: user.id, updatedAt: new Date(), version: sql`${accounts.version} + 1`,
      }).where(eq(accounts.id, accountId)).returning())[0]!;
      await this.audit.record({ actorUserId: user.id, action: 'accounting.account.update', module: 'accounting', entityId: accountId, metadata: { code: row.code, isActive: row.isActive, archived: input.archived === true } }, tx);
      return row;
    });
    return (await this.listAccounts(user, {})).find(row => row.id === updated.id) ?? { id: updated.id, code: updated.code };
  }

  async listMappings() {
    const rows = await this.db.select({ mapping: accountMappings, account: accounts }).from(accountMappings).innerJoin(accounts, eq(accounts.id, accountMappings.accountId)).orderBy(asc(accountMappings.mappingKey));
    return rows.map(row => ({ id: row.mapping.id, mappingKey: row.mapping.mappingKey, description: row.mapping.description ?? '', accountId: row.account.id, accountCode: row.account.code, accountName: row.account.nameAr }));
  }

  async setMapping(user: AuthIdentity, input: Record<string, unknown>) {
    const mappingKey = this.text(input.mappingKey, 'mappingKey', 200);
    const accountId = uuid(input.accountId, 'accountId');
    const account = (await this.db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.isActive, true), isNull(accounts.archivedAt))).limit(1))[0];
    if (!account) throw new ConflictException('The selected account is not available.');
    if (!account.allowsPosting) throw new ConflictException('A heading account cannot receive postings.');
    await this.db.transaction(async tx => {
      await tx.insert(accountMappings).values({ mappingKey, accountId, description: this.optional(input.description, 300), createdByUserId: user.id })
        .onConflictDoUpdate({ target: accountMappings.mappingKey, set: { accountId, description: this.optional(input.description, 300), updatedAt: new Date() } });
      await this.audit.record({ actorUserId: user.id, action: 'accounting.mapping.set', module: 'accounting', metadata: { mappingKey, accountCode: account.code } }, tx);
    });
    return this.listMappings();
  }

  // ------------------------------------------------------------- journals
  async listJournals(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit); const conditions: any[] = [];
    if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; conditions.push(ids.length ? or(inArray(journalEntries.warehouseId, ids), isNull(journalEntries.warehouseId))! : isNull(journalEntries.warehouseId)); }
    if (query.warehouseId) { const warehouseId = uuid(query.warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); conditions.push(eq(journalEntries.warehouseId, warehouseId)); }
    if (query.sourceType) conditions.push(eq(journalEntries.sourceType, String(query.sourceType) as any));
    if (query.status && ['posted', 'reversed'].includes(String(query.status))) conditions.push(eq(journalEntries.status, query.status as any));
    if (query.partnerId) conditions.push(eq(journalEntries.partnerId, uuid(query.partnerId, 'partnerId')));
    if (typeof query.search === 'string' && query.search.trim()) conditions.push(or(ilike(journalEntries.journalNumber, `%${query.search.trim()}%`), ilike(journalEntries.sourceNumber, `%${query.search.trim()}%`), ilike(journalEntries.description, `%${query.search.trim()}%`)));
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(journalEntries.entryDate, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(journalEntries.entryDate, new Date(`${query.dateTo}T23:59:59.999Z`)));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select({ entry: journalEntries, createdByName: users.fullName, lineCount: sql<number>`(select count(*)::int from journal_entry_lines where journal_entry_id = ${journalEntries.id})` }).from(journalEntries).innerJoin(users, eq(users.id, journalEntries.createdByUserId)).where(where).orderBy(desc(journalEntries.entryDate), desc(journalEntries.sequenceNumber)).limit(limit).offset((page - 1) * limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(journalEntries).where(where),
    ]);
    return { items: rows.map(row => this.journalDto(row.entry, row.createdByName, row.lineCount)), meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  private journalDto(entry: any, createdByName?: string, lineCount?: number, lines?: any[]) {
    return {
      id: entry.id, journalNumber: entry.journalNumber, date: entry.entryDate.toISOString().slice(0, 10), entryDate: entry.entryDate.toISOString(), status: entry.status,
      sourceType: entry.sourceType, sourceId: entry.sourceId, sourceNumber: entry.sourceNumber, postingEvent: entry.postingEvent, description: entry.description,
      warehouseId: entry.warehouseId, partnerId: entry.partnerId, totalDebitUSD: Number(entry.totalDebitUsd), totalCreditUSD: Number(entry.totalCreditUsd),
      reversalOfJournalId: entry.reversalOfJournalId, reversedByJournalId: entry.reversedByJournalId, createdBy: createdByName ?? '', createdAt: entry.createdAt.toISOString(),
      lineCount: lineCount ?? lines?.length ?? 0,
      ...(lines ? { lines } : {}),
    };
  }

  async getJournal(user: AuthIdentity, journalId: string) {
    journalId = uuid(journalId, 'id');
    const row = (await this.db.select({ entry: journalEntries, createdByName: users.fullName }).from(journalEntries).innerJoin(users, eq(users.id, journalEntries.createdByUserId)).where(eq(journalEntries.id, journalId)).limit(1))[0];
    if (!row) throw new NotFoundException('Journal entry not found.');
    if (row.entry.warehouseId) this.scope.assertAccess(user, row.entry.warehouseId);
    const lines = await this.db.select({ line: journalEntryLines, accountCode: accounts.code, accountName: accounts.nameAr }).from(journalEntryLines).innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId)).where(eq(journalEntryLines.journalEntryId, journalId)).orderBy(asc(journalEntryLines.lineNumber));
    return this.journalDto(row.entry, row.createdByName, lines.length, lines.map(entry => ({
      id: entry.line.id, lineNumber: entry.line.lineNumber, accountId: entry.line.accountId, accountCode: entry.accountCode, accountName: entry.accountName,
      debitUSD: Number(entry.line.debitUsd), creditUSD: Number(entry.line.creditUsd), currency: entry.line.currency, originalAmount: Number(entry.line.originalAmount), exchangeRate: Number(entry.line.exchangeRateSypPerUsd),
      partnerId: entry.line.partnerId, cashboxId: entry.line.cashboxId, warehouseId: entry.line.warehouseId, memo: entry.line.memo ?? '',
      salesInvoiceId: entry.line.salesInvoiceId, purchaseInvoiceId: entry.line.purchaseInvoiceId, returnInvoiceId: entry.line.returnInvoiceId, voucherId: entry.line.voucherId,
    })));
  }

  // A manual journal is held to exactly the same rules as an automatic one.
  async createManualJournal(user: AuthIdentity, input: Record<string, unknown>) {
    const description = this.text(input.description, 'description', 500);
    const entryDate = typeof input.date === 'string' && !Number.isNaN(Date.parse(input.date)) ? new Date(input.date) : new Date();
    const rate = money(input.exchangeRateSypPerUsd ?? '1', 'exchangeRateSypPerUsd') || 1;
    const warehouseId = input.warehouseId ? uuid(input.warehouseId, 'warehouseId') : null;
    if (warehouseId) this.scope.assertAccess(user, warehouseId);
    if (!Array.isArray(input.lines) || input.lines.length < 2) throw new ConflictException('A manual journal needs at least two lines.');
    const lines = (input.lines as any[]).map((raw, index) => {
      const debit = raw.debitUSD === undefined || raw.debitUSD === '' ? 0 : money(raw.debitUSD, `lines[${index}].debitUSD`);
      const credit = raw.creditUSD === undefined || raw.creditUSD === '' ? 0 : money(raw.creditUSD, `lines[${index}].creditUSD`);
      if (debit > 0 && credit > 0) throw new ConflictException(`lines[${index}] cannot be both debit and credit.`);
      if (debit <= 0 && credit <= 0) throw new ConflictException(`lines[${index}] must carry an amount.`);
      return { accountId: uuid(raw.accountId, `lines[${index}].accountId`), debitUsd: debit, creditUsd: credit, exchangeRateSypPerUsd: rate, partnerId: raw.partnerId ? uuid(raw.partnerId, `lines[${index}].partnerId`) : null, warehouseId, memo: raw.memo ? this.text(raw.memo, `lines[${index}].memo`, 300) : null };
    });
    const entryId = await this.db.transaction(async tx => {
      const entry = await this.posting.post(tx, user, { sourceType: 'manual', postingEvent: `manual:${Date.now()}`, description, entryDate, warehouseId, lines });
      await this.audit.record({ actorUserId: user.id, action: 'accounting.journal.create', module: 'accounting', entityId: entry.id, warehouseId: warehouseId ?? undefined, metadata: { journalNumber: entry.journalNumber, lineCount: lines.length, totalDebitUsd: entry.totalDebitUsd } }, tx);
      return entry.id;
    });
    return this.getJournal(user, entryId);
  }

  async reverseJournal(user: AuthIdentity, journalId: string, input: Record<string, unknown>) {
    const reason = this.text(input.reason, 'reason', 500);
    journalId = uuid(journalId, 'id');
    const reversalId = await this.db.transaction(async tx => {
      const original = (await tx.select().from(journalEntries).where(eq(journalEntries.id, journalId)).limit(1))[0];
      if (!original) throw new NotFoundException('Journal entry not found.');
      if (original.warehouseId) this.scope.assertAccess(user, original.warehouseId);
      if (original.status === 'reversed') throw new ConflictException('This journal entry has already been reversed.');
      if (original.sourceType !== 'manual') throw new ConflictException('Automatic journals are reversed by cancelling their source document.');
      const reversal = await this.posting.reverse(tx, user, journalId, reason);
      if (!reversal) throw new ConflictException('This journal entry has already been reversed.');
      await this.audit.record({ actorUserId: user.id, action: 'accounting.journal.reverse', module: 'accounting', entityId: journalId, warehouseId: original.warehouseId ?? undefined, metadata: { journalNumber: original.journalNumber, reversalNumber: reversal.journalNumber, reason } }, tx);
      return reversal.id;
    });
    return this.getJournal(user, reversalId);
  }

  // ------------------------------------------------------------- general ledger
  async generalLedger(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit);
    const accountId = uuid(query.accountId, 'accountId');
    const account = (await this.db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1))[0];
    if (!account) throw new NotFoundException('Account not found.');
    const conditions: any[] = [eq(journalEntryLines.accountId, accountId)];
    if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; conditions.push(ids.length ? or(inArray(journalEntryLines.warehouseId, ids), isNull(journalEntryLines.warehouseId))! : isNull(journalEntryLines.warehouseId)); }
    if (query.warehouseId) { const warehouseId = uuid(query.warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); conditions.push(eq(journalEntryLines.warehouseId, warehouseId)); }
    if (query.partnerId) conditions.push(eq(journalEntryLines.partnerId, uuid(query.partnerId, 'partnerId')));
    if (query.currency && ['USD', 'SYP'].includes(String(query.currency))) conditions.push(eq(journalEntryLines.currency, query.currency as any));
    if (query.sourceType) conditions.push(eq(journalEntries.sourceType, String(query.sourceType) as any));
    const from = typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom)) ? new Date(query.dateFrom) : null;
    const to = typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo)) ? new Date(`${query.dateTo}T23:59:59.999Z`) : null;
    if (from) conditions.push(gte(journalEntries.entryDate, from));
    if (to) conditions.push(lte(journalEntries.entryDate, to));

    const opening = from
      ? (await this.db.select({ debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)` }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId)).where(and(eq(journalEntryLines.accountId, accountId), sql`${journalEntries.entryDate} < ${from}`)))[0]!
      : { debit: '0', credit: '0' };
    const openingBalance = Number((account.normalBalance === 'debit' ? Number(opening.debit) - Number(opening.credit) : Number(opening.credit) - Number(opening.debit)).toFixed(4));

    const [rows, total] = await Promise.all([
      this.db.select({ line: journalEntryLines, entry: journalEntries }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId)).where(and(...conditions)).orderBy(asc(journalEntries.entryDate), asc(journalEntries.sequenceNumber), asc(journalEntryLines.lineNumber)).limit(limit).offset((page - 1) * limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId)).where(and(...conditions)),
    ]);

    let running = openingBalance;
    const items = rows.map(row => {
      const debit = Number(row.line.debitUsd); const credit = Number(row.line.creditUsd);
      running = Number((running + (account.normalBalance === 'debit' ? debit - credit : credit - debit)).toFixed(4));
      return {
        id: row.line.id, date: row.entry.entryDate.toISOString().slice(0, 10), journalId: row.entry.id, journalNumber: row.entry.journalNumber, status: row.entry.status,
        description: row.line.memo || row.entry.description, sourceType: row.entry.sourceType, sourceNumber: row.entry.sourceNumber,
        debitUSD: debit, creditUSD: credit, currency: row.line.currency, originalAmount: Number(row.line.originalAmount), exchangeRate: Number(row.line.exchangeRateSypPerUsd),
        partnerId: row.line.partnerId, warehouseId: row.line.warehouseId, runningBalanceUSD: running,
      };
    });
    return { account: { id: account.id, code: account.code, nameAr: account.nameAr, accountClass: account.accountClass, normalBalance: account.normalBalance }, openingBalanceUSD: openingBalance, closingBalanceUSD: running, items, meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  // ------------------------------------------------------------- trial balance
  async trialBalance(_user: AuthIdentity, query: Record<string, unknown>) {
    const from = typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom)) ? new Date(query.dateFrom) : null;
    const to = typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo)) ? new Date(`${query.dateTo}T23:59:59.999Z`) : null;
    const period: any[] = [];
    if (from) period.push(gte(journalEntries.entryDate, from));
    if (to) period.push(lte(journalEntries.entryDate, to));

    const [postingAccounts, movements, priors] = await Promise.all([
      this.db.select().from(accounts).where(and(eq(accounts.allowsPosting, true), isNull(accounts.archivedAt))).orderBy(asc(accounts.code)),
      this.db.select({ accountId: journalEntryLines.accountId, debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)` }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId)).where(period.length ? and(...period) : undefined).groupBy(journalEntryLines.accountId),
      from
        ? this.db.select({ accountId: journalEntryLines.accountId, debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)` }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId)).where(sql`${journalEntries.entryDate} < ${from}`).groupBy(journalEntryLines.accountId)
        : Promise.resolve([] as Array<{ accountId: string; debit: string; credit: string }>),
    ]);

    const rows = postingAccounts.map(account => {
      const period = movements.find(row => row.accountId === account.id);
      const prior = priors.find(row => row.accountId === account.id);
      const periodDebit = Number(period?.debit ?? 0); const periodCredit = Number(period?.credit ?? 0);
      const signed = (debit: number, credit: number) => Number((account.normalBalance === 'debit' ? debit - credit : credit - debit).toFixed(4));
      const openingBalance = signed(Number(prior?.debit ?? 0), Number(prior?.credit ?? 0));
      return {
        accountId: account.id, code: account.code, nameAr: account.nameAr, accountClass: account.accountClass, normalBalance: account.normalBalance,
        openingBalanceUSD: openingBalance, periodDebitUSD: periodDebit, periodCreditUSD: periodCredit,
        closingBalanceUSD: Number((openingBalance + signed(periodDebit, periodCredit)).toFixed(4)),
      };
    }).filter(row => row.periodDebitUSD !== 0 || row.periodCreditUSD !== 0 || row.openingBalanceUSD !== 0 || query.includeEmpty === 'true');

    const totalDebit = Number(rows.reduce((sum, row) => sum + row.periodDebitUSD, 0).toFixed(4));
    const totalCredit = Number(rows.reduce((sum, row) => sum + row.periodCreditUSD, 0).toFixed(4));
    return { rows, totalDebitUSD: totalDebit, totalCreditUSD: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.00005, dateFrom: from?.toISOString() ?? null, dateTo: to?.toISOString() ?? null };
  }

  // ------------------------------------------------------------- reconciliation
  // Accounting must agree with the operational modules it was posted from; any gap is
  // reported rather than absorbed.
  async reconciliation(_user: AuthIdentity) {
    const [boxes, cashLines, partnerRows, ledgerRows, receivable, payable] = await Promise.all([
      this.db.select().from(cashboxes).where(isNull(cashboxes.archivedAt)),
      this.db.select({ cashboxId: journalEntryLines.cashboxId, debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)`, originalDebit: sql<string>`coalesce(sum(case when ${journalEntryLines.debitUsd} > 0 then ${journalEntryLines.originalAmount} else 0 end), 0)`, originalCredit: sql<string>`coalesce(sum(case when ${journalEntryLines.creditUsd} > 0 then ${journalEntryLines.originalAmount} else 0 end), 0)` }).from(journalEntryLines).where(sql`${journalEntryLines.cashboxId} is not null`).groupBy(journalEntryLines.cashboxId),
      // Archiving a partner does not erase what they owe, so reconciliation counts every
      // partner the ledger ever touched, exactly as the accounting entries do.
      this.db.select().from(partners),
      this.db.select({ partnerId: partnerLedgerEntries.partnerId, net: sql<string>`coalesce(sum(${partnerLedgerEntries.debitUsd} - ${partnerLedgerEntries.creditUsd}), 0)` }).from(partnerLedgerEntries).groupBy(partnerLedgerEntries.partnerId),
      this.accountBalance('accounts_receivable'),
      this.accountBalance('accounts_payable'),
    ]);
    const movementTotals = await this.db.select({ cashboxId: cashMovements.cashboxId, net: sql<string>`coalesce(sum(case when ${cashMovements.direction} = 'inflow' then ${cashMovements.amount} else -${cashMovements.amount} end), 0)` }).from(cashMovements).groupBy(cashMovements.cashboxId);

    const cash = boxes.map(box => {
      const accountingLine = cashLines.find(row => row.cashboxId === box.id);
      const financeNet = Number(movementTotals.find(row => row.cashboxId === box.id)?.net ?? 0);
      const financeBalance = Number((Number(box.openingBalance) + financeNet).toFixed(4));
      // Cash accounts are compared in the cashbox's own currency, because a SYP account
      // holds USD at historical rates and would never equal a converted balance.
      const accountingBalance = Number((Number(accountingLine?.originalDebit ?? 0) - Number(accountingLine?.originalCredit ?? 0)).toFixed(4));
      return { cashboxId: box.id, name: box.name, currency: box.currency, financeBalance, accountingBalance, differenceUSD: Number((accountingBalance - financeBalance).toFixed(4)), matches: Math.abs(accountingBalance - financeBalance) < 0.005 };
    });

    // Compared signed and by partner type, exactly the way the entries were posted: a
    // customer's balance always sits in Receivables and a supplier's in Payables, so a
    // partner who happens to be in credit lowers that account rather than moving sides.
    let operationalReceivable = 0; let operationalPayable = 0;
    for (const partner of partnerRows) {
      const net = Number((Number(partner.openingBalanceUsd) + Number(ledgerRows.find(row => row.partnerId === partner.id)?.net ?? 0)).toFixed(4));
      if (partner.type === 'supplier') operationalPayable += -net; else operationalReceivable += net;
    }
    operationalReceivable = Number(operationalReceivable.toFixed(4)); operationalPayable = Number(operationalPayable.toFixed(4));

    // A manual journal may touch Receivables or Payables without any operational
    // document behind it. That is legitimate accounting, so it is measured and shown
    // rather than hidden — what must never appear is an unexplained remainder.
    const [manualReceivable, manualPayable] = await Promise.all([this.manualAdjustment('accounts_receivable'), this.manualAdjustment('accounts_payable')]);
    const receivableDifference = Number((receivable - operationalReceivable).toFixed(4));
    const payableDifference = Number((payable - operationalPayable).toFixed(4));
    const receivableUnexplained = Number((receivableDifference - manualReceivable).toFixed(4));
    const payableUnexplained = Number((payableDifference - manualPayable).toFixed(4));

    return {
      cash, cashBalanced: cash.every(row => row.matches),
      receivable: { accountingUSD: receivable, operationalUSD: operationalReceivable, differenceUSD: receivableDifference, manualAdjustmentUSD: manualReceivable, unexplainedUSD: receivableUnexplained, matches: Math.abs(receivableUnexplained) < 0.005 },
      payable: { accountingUSD: payable, operationalUSD: operationalPayable, differenceUSD: payableDifference, manualAdjustmentUSD: manualPayable, unexplainedUSD: payableUnexplained, matches: Math.abs(payableUnexplained) < 0.005 },
      notes: [
        'أرصدة الصناديق تُقارن بعملة الصندوق نفسها، لأن حساب الليرة يحمل قيماً بالدولار بأسعار صرف تاريخية.',
        'قيمة المخزون الافتتاحية غير مرحّلة محاسبياً لعدم توفر كلفة تاريخية موثوقة.',
        'تسوية الذهب والكسر خارج النقدية عمداً وتنتظر وحدة حسابات الأوزان.',
      ],
    };
  }

  // How much of a control account's balance came from manual journals rather than from
  // an operational document. Signed the same way the account's own balance is.
  private async manualAdjustment(systemKey: string) {
    const account = (await this.db.select().from(accounts).where(eq(accounts.systemKey, systemKey)).limit(1))[0];
    if (!account) return 0;
    const totals = (await this.db.select({ debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)` })
      .from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .where(and(eq(journalEntryLines.accountId, account.id), eq(journalEntries.sourceType, 'manual'))))[0]!;
    const debit = Number(totals.debit); const credit = Number(totals.credit);
    return Number((account.normalBalance === 'debit' ? debit - credit : credit - debit).toFixed(4));
  }

  private async accountBalance(systemKey: string) {
    const account = (await this.db.select().from(accounts).where(eq(accounts.systemKey, systemKey)).limit(1))[0];
    if (!account) return 0;
    const totals = (await this.db.select({ debit: sql<string>`coalesce(sum(${journalEntryLines.debitUsd}), 0)`, credit: sql<string>`coalesce(sum(${journalEntryLines.creditUsd}), 0)` }).from(journalEntryLines).where(eq(journalEntryLines.accountId, account.id)))[0]!;
    const debit = Number(totals.debit); const credit = Number(totals.credit);
    return Number((account.normalBalance === 'debit' ? debit - credit : credit - debit).toFixed(4));
  }

  // Journals attached to a business document, for the invoice and voucher screens.
  async journalsForSource(user: AuthIdentity, query: Record<string, unknown>) {
    const conditions: any[] = [];
    for (const [key, column] of [['salesInvoiceId', journalEntryLines.salesInvoiceId], ['purchaseInvoiceId', journalEntryLines.purchaseInvoiceId], ['returnInvoiceId', journalEntryLines.returnInvoiceId], ['voucherId', journalEntryLines.voucherId]] as const) {
      if (query[key]) conditions.push(eq(column, uuid(query[key], key)));
    }
    if (!conditions.length) throw new ConflictException('A source document reference is required.');
    const rows = await this.db.selectDistinctOn([journalEntries.id], { entry: journalEntries }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId)).where(or(...conditions));
    return rows.map(row => ({ id: row.entry.id, journalNumber: row.entry.journalNumber, status: row.entry.status, sourceType: row.entry.sourceType, sourceNumber: row.entry.sourceNumber, description: row.entry.description, totalDebitUSD: Number(row.entry.totalDebitUsd), totalCreditUSD: Number(row.entry.totalCreditUsd), date: row.entry.entryDate.toISOString().slice(0, 10) }));
  }

  private text(value: unknown, field: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} is invalid.`); return value.trim(); }
  private optional(value: unknown, max: number) { return value === undefined || value === null || value === '' ? null : this.text(value, 'value', max); }
  private page(value: unknown) { const parsed = Number(value ?? 1); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1; }
  private limit(value: unknown) { const parsed = Number(value ?? 50); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50; }
}
