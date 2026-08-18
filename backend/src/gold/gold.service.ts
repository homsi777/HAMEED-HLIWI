import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { goldAccounts, goldLedgerEntries, goldTransactions, partners, salesGoldExchanges, users } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';
import { GoldPostingService, KARATS, pureGold, type Karat } from './gold-posting.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, field: string) => { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; };
const weight = (value: unknown, field: string) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw new ConflictException(`${field} is invalid.`);
  const parsed = Number(raw);
  if (!(parsed > 0)) throw new ConflictException(`${field} must be greater than zero.`);
  return Number(parsed.toFixed(3));
};

type GoldKaratBalance = { karat: string; grams: number; pureGoldGrams: number };

const TYPE_LABEL: Record<string, string> = {
  opening: 'رصيد افتتاحي', sale_exchange: 'ذهب من فاتورة بيع', sales_return_obligation: 'التزام عن مرتجع',
  purchase_settlement: 'تسوية شراء بالذهب', purchase_return_adjustment: 'تعديل مرتجع مشتريات',
  receipt: 'استلام ذهب', payment: 'تسليم ذهب', conversion: 'تحويل عيار', reversal: 'عكس حركة',
};

@Injectable()
export class GoldService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
    @Inject(GoldPostingService) private readonly posting: GoldPostingService,
  ) {}

  // ------------------------------------------------------------------ accounts
  async listAccounts(_user: AuthIdentity, query: Record<string, unknown>) {
    const conditions: any[] = [eq(goldAccounts.isActive, true)];
    if (query.kind === 'partner' || query.kind === 'company') conditions.push(eq(goldAccounts.kind, query.kind));
    if (typeof query.search === 'string' && query.search.trim()) conditions.push(ilike(goldAccounts.name, `%${query.search.trim()}%`));
    const [rows, totals] = await Promise.all([
      this.db.select({ account: goldAccounts, partnerType: partners.type }).from(goldAccounts).leftJoin(partners, eq(partners.id, goldAccounts.partnerId)).where(and(...conditions)).orderBy(asc(goldAccounts.kind), asc(goldAccounts.name)),
      this.db.select({
        accountId: goldLedgerEntries.goldAccountId, karat: goldLedgerEntries.karat,
        grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)`,
        pure: sql<string>`coalesce(sum(case when ${goldLedgerEntries.debitGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else -${goldLedgerEntries.pureGoldGrams} end), 0)`,
      }).from(goldLedgerEntries).groupBy(goldLedgerEntries.goldAccountId, goldLedgerEntries.karat),
    ]);
    return rows.map(row => {
      const balances = totals.filter(entry => entry.accountId === row.account.id)
        .map(entry => ({ karat: entry.karat, grams: Number(Number(entry.grams).toFixed(3)), pureGoldGrams: Number(Number(entry.pure).toFixed(4)) }))
        .filter(entry => Math.abs(entry.grams) > 0.0005)
        .sort((a, b) => Number(b.karat) - Number(a.karat));
      return {
        id: row.account.id, kind: row.account.kind, name: row.account.name, systemCode: row.account.systemCode,
        partnerId: row.account.partnerId, partnerType: row.partnerType, warehouseId: row.account.warehouseId, isActive: row.account.isActive,
        balances, pureGoldTotalGrams: Number(balances.reduce((sum, entry) => sum + entry.pureGoldGrams, 0).toFixed(4)),
      };
    });
  }

  // Per-karat balances are never merged; the pure-gold total is offered beside them.
  async partnerBalance(user: AuthIdentity, partnerId: string) {
    partnerId = uuid(partnerId, 'id');
    const partner = (await this.db.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
    if (!partner) throw new NotFoundException('Partner not found.');
    const account = (await this.db.select().from(goldAccounts).where(and(eq(goldAccounts.kind, 'partner'), eq(goldAccounts.partnerId, partnerId))).limit(1))[0];
    const balances: GoldKaratBalance[] = account ? await this.posting.accountBalances(account.id) : [];
    return {
      partner: { id: partner.id, name: partner.name, type: partner.type, phone: partner.phone ?? '' },
      accountId: account?.id ?? null,
      balances: balances.sort((a, b) => Number(b.karat) - Number(a.karat)),
      pureGoldTotalGrams: Number(balances.reduce((sum, entry) => sum + entry.pureGoldGrams, 0).toFixed(4)),
    };
  }

  async partnerBalances(_user: AuthIdentity, query: Record<string, unknown>) {
    const rows = await this.db.select({
      partnerId: goldAccounts.partnerId, name: goldAccounts.name, accountId: goldAccounts.id, partnerType: partners.type,
      karat: goldLedgerEntries.karat,
      grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)`,
      pure: sql<string>`coalesce(sum(case when ${goldLedgerEntries.debitGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else -${goldLedgerEntries.pureGoldGrams} end), 0)`,
    }).from(goldAccounts).innerJoin(goldLedgerEntries, eq(goldLedgerEntries.goldAccountId, goldAccounts.id)).leftJoin(partners, eq(partners.id, goldAccounts.partnerId))
      .where(eq(goldAccounts.kind, 'partner')).groupBy(goldAccounts.partnerId, goldAccounts.name, goldAccounts.id, partners.type, goldLedgerEntries.karat);
    const grouped = new Map<string, any>();
    for (const row of rows) {
      const grams = Number(Number(row.grams).toFixed(3));
      if (Math.abs(grams) <= 0.0005 && query.includeSettled !== 'true') continue;
      const entry = grouped.get(row.accountId) ?? { partnerId: row.partnerId, accountId: row.accountId, name: row.name, partnerType: row.partnerType, balances: [], pureGoldTotalGrams: 0 };
      entry.balances.push({ karat: row.karat, grams, pureGoldGrams: Number(Number(row.pure).toFixed(4)) });
      entry.pureGoldTotalGrams = Number((entry.pureGoldTotalGrams + Number(row.pure)).toFixed(4));
      grouped.set(row.accountId, entry);
    }
    return [...grouped.values()].map(entry => ({ ...entry, balances: entry.balances.sort((a: any, b: any) => Number(b.karat) - Number(a.karat)) }));
  }

  /**
   * The gold the shop physically holds, per branch and per karat, with the movements that
   * put it there. Scrap taken in on a sale is metal in the safe — this is where it becomes
   * visible as a holding rather than only as a ledger line.
   *
   * System accounts (the invoice settlement clearing account) are excluded: they are an
   * accounting device, not metal on a shelf.
   */
  async holdings(user: AuthIdentity, query: Record<string, unknown>) {
    const accountConditions: any[] = [eq(goldAccounts.kind, 'company'), isNull(goldAccounts.systemCode)];
    if (query.warehouseId) { const warehouseId = uuid(query.warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); accountConditions.push(eq(goldAccounts.warehouseId, warehouseId)); }
    else if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; accountConditions.push(ids.length ? or(inArray(goldAccounts.warehouseId, ids), isNull(goldAccounts.warehouseId))! : isNull(goldAccounts.warehouseId)); }
    const accounts = await this.db.select().from(goldAccounts).where(and(...accountConditions)).orderBy(asc(goldAccounts.name));
    if (!accounts.length) return { accounts: [], movements: [], totals: [], pureGoldTotalGrams: 0, totalsExcludingScrap: [], pureGoldTotalExcludingScrapGrams: 0 };
    const accountIds = accounts.map(account => account.id);

    const [balances, movements] = await Promise.all([
      this.db.select({
        accountId: goldLedgerEntries.goldAccountId, karat: goldLedgerEntries.karat,
        grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)`,
        pure: sql<string>`coalesce(sum(case when ${goldLedgerEntries.debitGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else -${goldLedgerEntries.pureGoldGrams} end), 0)`,
        // How much of this holding arrived as scrap taken in on an invoice.
        scrapGrams: sql<string>`coalesce(sum(case when ${goldTransactions.type} = 'sale_exchange' then ${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams} else 0 end), 0)`,
      }).from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
        .where(inArray(goldLedgerEntries.goldAccountId, accountIds)).groupBy(goldLedgerEntries.goldAccountId, goldLedgerEntries.karat),
      this.db.select({ entry: goldLedgerEntries, transaction: goldTransactions, accountName: goldAccounts.name })
        .from(goldLedgerEntries)
        .innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
        .innerJoin(goldAccounts, eq(goldAccounts.id, goldLedgerEntries.goldAccountId))
        .where(inArray(goldLedgerEntries.goldAccountId, accountIds))
        .orderBy(desc(goldLedgerEntries.occurredAt), desc(goldLedgerEntries.createdAt)).limit(this.limit(query.limit)),
    ]);

    const totals = new Map<string, { karat: string; grams: number; pureGoldGrams: number; scrapGrams: number }>();
    const accountRows = accounts.map(account => {
      const rows = balances.filter(entry => entry.accountId === account.id)
        .map(entry => ({ karat: entry.karat, grams: Number(Number(entry.grams).toFixed(3)), pureGoldGrams: Number(Number(entry.pure).toFixed(4)), scrapGrams: Number(Number(entry.scrapGrams).toFixed(3)) }))
        .filter(entry => Math.abs(entry.grams) > 0.0005)
        .sort((a, b) => Number(b.karat) - Number(a.karat));
      for (const row of rows) {
        const total = totals.get(row.karat) ?? { karat: row.karat, grams: 0, pureGoldGrams: 0, scrapGrams: 0 };
        totals.set(row.karat, { karat: row.karat, grams: Number((total.grams + row.grams).toFixed(3)), pureGoldGrams: Number((total.pureGoldGrams + row.pureGoldGrams).toFixed(4)), scrapGrams: Number((total.scrapGrams + row.scrapGrams).toFixed(3)) });
      }
      return { id: account.id, name: account.name, warehouseId: account.warehouseId, balances: rows, pureGoldTotalGrams: Number(rows.reduce((sum, row) => sum + row.pureGoldGrams, 0).toFixed(4)) };
    });

    // Barter scrap is metal the shop physically holds, so it belongs in the totals above and
    // they keep their meaning. But it is managed on its own screen and the manager reads the
    // headline as "gold the shop bought and owns", so the same figures are offered a second
    // time with the scrap share removed. Two named numbers, neither one silently redefined.
    const totalsExcludingScrap = [...totals.values()]
      .map(row => {
        const grams = Number((row.grams - row.scrapGrams).toFixed(3));
        return { karat: row.karat, grams, pureGoldGrams: Number(((grams * Number(row.karat)) / 24).toFixed(4)), scrapGrams: 0 };
      })
      .filter(row => Math.abs(row.grams) > 0.0005)
      .sort((a, b) => Number(b.karat) - Number(a.karat));

    return {
      accounts: accountRows,
      totals: [...totals.values()].sort((a, b) => Number(b.karat) - Number(a.karat)),
      pureGoldTotalGrams: Number([...totals.values()].reduce((sum, row) => sum + row.pureGoldGrams, 0).toFixed(4)),
      totalsExcludingScrap,
      pureGoldTotalExcludingScrapGrams: Number(totalsExcludingScrap.reduce((sum, row) => sum + row.pureGoldGrams, 0).toFixed(4)),
      movements: movements.map(row => ({
        id: row.entry.id, date: row.entry.occurredAt.toISOString().slice(0, 10), accountId: row.entry.goldAccountId, accountName: row.accountName,
        transactionNumber: row.transaction.transactionNumber, transactionType: row.transaction.type, status: row.transaction.status,
        // `scrap_exchange` is what the screen badges as كسر مقايضة.
        source: row.transaction.type === 'sale_exchange' ? 'scrap_exchange' : row.transaction.sourceType === 'manual' ? 'manual' : row.transaction.sourceType,
        sourceNumber: row.transaction.sourceNumber, partnerId: row.transaction.partnerId, warehouseId: row.entry.warehouseId,
        karat: row.entry.karat, inGrams: Number(row.entry.debitGrams), outGrams: Number(row.entry.creditGrams), pureGoldGrams: Number(row.entry.pureGoldGrams),
        goldPricePerGramUSD: row.entry.goldPriceUsdPerGram ? Number(row.entry.goldPriceUsdPerGram) : null, valuationUSD: row.entry.valuationUsd ? Number(row.entry.valuationUsd) : null,
        salesInvoiceId: row.entry.salesInvoiceId, salesGoldExchangeId: row.entry.salesGoldExchangeId, description: row.entry.description,
      })),
    };
  }

  // ------------------------------------------------------------------ statement
  async partnerStatement(user: AuthIdentity, partnerId: string, query: Record<string, unknown>) {
    partnerId = uuid(partnerId, 'id');
    const summary = await this.partnerBalance(user, partnerId);
    if (!summary.accountId) return { ...summary, rows: [], meta: { page: 1, limit: 0, total: 0 } };
    const page = this.page(query.page); const limit = this.limit(query.limit);
    const conditions: any[] = [eq(goldLedgerEntries.goldAccountId, summary.accountId)];
    if (query.karat) conditions.push(eq(goldLedgerEntries.karat, this.posting.assertKarat(query.karat)));
    if (query.sourceType) conditions.push(eq(goldTransactions.sourceType, String(query.sourceType)));
    if (query.warehouseId) { const warehouseId = uuid(query.warehouseId, 'warehouseId'); this.scope.assertAccess(user, warehouseId); conditions.push(eq(goldLedgerEntries.warehouseId, warehouseId)); }
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(goldLedgerEntries.occurredAt, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(goldLedgerEntries.occurredAt, new Date(`${query.dateTo}T23:59:59.999Z`)));

    const [rows, total] = await Promise.all([
      this.db.select({ entry: goldLedgerEntries, transaction: goldTransactions }).from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
        .where(and(...conditions)).orderBy(asc(goldLedgerEntries.occurredAt), asc(goldLedgerEntries.createdAt), asc(goldLedgerEntries.lineNumber)).limit(limit).offset((page - 1) * limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId)).where(and(...conditions)),
    ]);

    // A running balance only makes sense within one karat, so it is tracked per karat.
    const running = new Map<string, number>();
    const items = rows.map(row => {
      const debit = Number(row.entry.debitGrams); const credit = Number(row.entry.creditGrams);
      const next = Number(((running.get(row.entry.karat) ?? 0) + debit - credit).toFixed(3));
      running.set(row.entry.karat, next);
      return {
        id: row.entry.id, date: row.entry.occurredAt.toISOString().slice(0, 10), occurredAt: row.entry.occurredAt.toISOString(),
        transactionId: row.transaction.id, transactionNumber: row.transaction.transactionNumber, transactionType: row.transaction.type, transactionTypeLabel: TYPE_LABEL[row.transaction.type] ?? row.transaction.type,
        status: row.transaction.status, sourceType: row.transaction.sourceType, sourceNumber: row.transaction.sourceNumber,
        description: row.entry.description, karat: row.entry.karat, debitGrams: debit, creditGrams: credit,
        pureGoldGrams: Number(row.entry.pureGoldGrams), goldPricePerGramUSD: row.entry.goldPriceUsdPerGram ? Number(row.entry.goldPriceUsdPerGram) : null, valuationUSD: row.entry.valuationUsd ? Number(row.entry.valuationUsd) : null,
        runningBalanceGrams: next, warehouseId: row.entry.warehouseId,
        salesInvoiceId: row.entry.salesInvoiceId, returnInvoiceId: row.entry.returnInvoiceId, purchaseInvoiceId: row.entry.purchaseInvoiceId,
      };
    });
    return { ...summary, rows: items, meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  // ------------------------------------------------------------------ transactions
  async listTransactions(user: AuthIdentity, query: Record<string, unknown>) {
    const page = this.page(query.page); const limit = this.limit(query.limit); const conditions: any[] = [];
    if (!this.scope.canAccessAll(user)) { const ids = this.scope.allowedWarehouseIds(user) ?? []; conditions.push(ids.length ? or(inArray(goldTransactions.warehouseId, ids), isNull(goldTransactions.warehouseId))! : isNull(goldTransactions.warehouseId)); }
    if (query.partnerId) conditions.push(eq(goldTransactions.partnerId, uuid(query.partnerId, 'partnerId')));
    if (query.type) conditions.push(eq(goldTransactions.type, String(query.type) as any));
    if (query.status && ['posted', 'reversed'].includes(String(query.status))) conditions.push(eq(goldTransactions.status, query.status as any));
    if (typeof query.search === 'string' && query.search.trim()) conditions.push(or(ilike(goldTransactions.transactionNumber, `%${query.search.trim()}%`), ilike(goldTransactions.sourceNumber, `%${query.search.trim()}%`), ilike(goldTransactions.description, `%${query.search.trim()}%`)));
    // Same date handling the partner statement already uses, so a records screen can ask
    // for a period the way every other list in this system does. Read-side only.
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(goldTransactions.occurredAt, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(goldTransactions.occurredAt, new Date(`${query.dateTo}T23:59:59.999Z`)));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select({ transaction: goldTransactions, createdByName: users.fullName }).from(goldTransactions).innerJoin(users, eq(users.id, goldTransactions.createdByUserId)).where(where).orderBy(desc(goldTransactions.occurredAt), desc(goldTransactions.sequenceNumber)).limit(limit).offset((page - 1) * limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(goldTransactions).where(where),
    ]);
    return { items: rows.map(row => this.transactionDto(row.transaction, row.createdByName)), meta: { page, limit, total: total[0]?.count ?? 0 } };
  }

  private transactionDto(transaction: any, createdByName?: string, lines?: any[]) {
    return {
      id: transaction.id, transactionNumber: transaction.transactionNumber, type: transaction.type, typeLabel: TYPE_LABEL[transaction.type] ?? transaction.type, status: transaction.status,
      date: transaction.occurredAt.toISOString().slice(0, 10), occurredAt: transaction.occurredAt.toISOString(),
      partnerId: transaction.partnerId, warehouseId: transaction.warehouseId,
      sourceType: transaction.sourceType, sourceNumber: transaction.sourceNumber, postingEvent: transaction.postingEvent,
      description: transaction.description, userNote: transaction.userNote ?? '',
      reversalOfTransactionId: transaction.reversalOfTransactionId, reversedByTransactionId: transaction.reversedByTransactionId,
      createdBy: createdByName ?? '', createdAt: transaction.createdAt.toISOString(),
      ...(lines ? { lines } : {}),
    };
  }

  async getTransaction(user: AuthIdentity, transactionId: string) {
    transactionId = uuid(transactionId, 'id');
    const row = (await this.db.select({ transaction: goldTransactions, createdByName: users.fullName }).from(goldTransactions).innerJoin(users, eq(users.id, goldTransactions.createdByUserId)).where(eq(goldTransactions.id, transactionId)).limit(1))[0];
    if (!row) throw new NotFoundException('Gold transaction not found.');
    if (row.transaction.warehouseId) this.scope.assertAccess(user, row.transaction.warehouseId);
    const lines = await this.db.select({ entry: goldLedgerEntries, accountName: goldAccounts.name, accountKind: goldAccounts.kind }).from(goldLedgerEntries).innerJoin(goldAccounts, eq(goldAccounts.id, goldLedgerEntries.goldAccountId)).where(eq(goldLedgerEntries.goldTransactionId, transactionId)).orderBy(asc(goldLedgerEntries.lineNumber));
    return this.transactionDto(row.transaction, row.createdByName, lines.map(line => ({
      id: line.entry.id, lineNumber: line.entry.lineNumber, accountId: line.entry.goldAccountId, accountName: line.accountName, accountKind: line.accountKind,
      karat: line.entry.karat, debitGrams: Number(line.entry.debitGrams), creditGrams: Number(line.entry.creditGrams), pureGoldGrams: Number(line.entry.pureGoldGrams),
      goldPricePerGramUSD: line.entry.goldPriceUsdPerGram ? Number(line.entry.goldPriceUsdPerGram) : null, valuationUSD: line.entry.valuationUsd ? Number(line.entry.valuationUsd) : null,
      description: line.entry.description, warehouseId: line.entry.warehouseId,
    })));
  }

  /**
   * Gold physically received from a partner. It reduces what they owe and increases the
   * branch's holding. Over-settlement is refused unless the caller explicitly asks to
   * create a balance in the other direction.
   */
  async createReceipt(user: AuthIdentity, input: Record<string, unknown>) { return this.settle(user, input, 'receipt'); }
  async createPayment(user: AuthIdentity, input: Record<string, unknown>) { return this.settle(user, input, 'payment'); }

  private async settle(user: AuthIdentity, input: Record<string, unknown>, kind: 'receipt' | 'payment') {
    const partnerId = uuid(input.partnerId, 'partnerId');
    const karat = this.posting.assertKarat(input.karat);
    const grams = weight(input.weightGrams, 'weightGrams');
    const warehouseId = input.warehouseId ? uuid(input.warehouseId, 'warehouseId') : null;
    if (warehouseId) this.scope.assertAccess(user, warehouseId);
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const allowReverseBalance = input.allowReverseBalance === true;
    const note = this.optional(input.note, 1000);
    const price = input.goldPriceUsdPerGram === undefined || input.goldPriceUsdPerGram === null || input.goldPriceUsdPerGram === '' ? null : Number(input.goldPriceUsdPerGram);

    const existing = await this.db.select({ id: goldTransactions.id }).from(goldTransactions).where(eq(goldTransactions.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.getTransaction(user, existing[0].id);

    const transactionId = await this.db.transaction(async tx => {
      const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
      if (!partner) throw new ConflictException('The selected partner does not exist.');
      // The balance is read under a row lock so two cashiers cannot settle it twice.
      const { grams: current } = await this.posting.lockedPartnerBalance(tx, user, partnerId, karat);
      const settling = kind === 'receipt' ? current : -current;
      if (!allowReverseBalance && grams > settling + 0.0005) {
        throw new ConflictException(kind === 'receipt'
          ? `العميل مدين بـ ${Math.max(0, current).toFixed(3)} غ عيار ${karat} فقط. لتسجيل مبلغ أكبر فعّل السماح برصيد معاكس.`
          : `المحل مدين بـ ${Math.max(0, -current).toFixed(3)} غ عيار ${karat} فقط. لتسليم وزن أكبر فعّل السماح برصيد معاكس.`);
      }
      const transaction = await this.posting.post(tx, user, {
        type: kind, sourceType: 'manual', postingEvent: `${kind}:${idempotencyKey}`, idempotencyKey,
        description: kind === 'receipt' ? `استلام ${grams.toFixed(3)} غ عيار ${karat} من ${partner.name}` : `تسليم ${grams.toFixed(3)} غ عيار ${karat} إلى ${partner.name}`,
        userNote: note, partnerId, warehouseId,
        lines: kind === 'receipt'
          ? [
              { companyWarehouseId: warehouseId, karat, debitGrams: grams, goldPriceUsdPerGram: price, warehouseId, description: `دخول ${grams.toFixed(3)} غ عيار ${karat} إلى المحل` },
              { partnerId, karat, creditGrams: grams, goldPriceUsdPerGram: price, description: `استلام ذهب من ${partner.name}` },
            ]
          : [
              { partnerId, karat, debitGrams: grams, goldPriceUsdPerGram: price, description: `تسليم ذهب إلى ${partner.name}` },
              { companyWarehouseId: warehouseId, karat, creditGrams: grams, goldPriceUsdPerGram: price, warehouseId, description: `خروج ${grams.toFixed(3)} غ عيار ${karat} من المحل` },
            ],
      });
      await this.audit.record({ actorUserId: user.id, action: `gold.${kind}`, module: 'gold', entityId: transaction.id, warehouseId: warehouseId ?? undefined, metadata: { transactionNumber: transaction.transactionNumber, partnerId, karat, weightGrams: grams.toFixed(3), allowReverseBalance } }, tx);
      return transaction.id;
    });
    const result = await this.getTransaction(user, transactionId);
    this.realtime.emitToPermissions(['gold_accounts.view'], 'gold_transaction.created', { id: transactionId, partnerId });
    this.realtime.emitToPermissions(['gold_accounts.view'], 'gold_account.updated', { partnerId });
    return result;
  }

  /**
   * Converts an obligation from one karat to another. Both sides are stated explicitly
   * and must carry the same fine gold, so no purity is created or lost.
   */
  async createConversion(user: AuthIdentity, input: Record<string, unknown>) {
    const partnerId = uuid(input.partnerId, 'partnerId');
    const fromKarat = this.posting.assertKarat(input.fromKarat, 'fromKarat');
    const toKarat = this.posting.assertKarat(input.toKarat, 'toKarat');
    if (fromKarat === toKarat) throw new ConflictException('اختر عيارين مختلفين للتحويل.');
    const fromGrams = weight(input.fromWeightGrams, 'fromWeightGrams');
    const toGrams = weight(input.toWeightGrams, 'toWeightGrams');
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const note = this.optional(input.note, 1000);
    const expected = pureGold(fromGrams, fromKarat);
    if (Math.abs(expected - pureGold(toGrams, toKarat)) > 0.001) {
      throw new ConflictException(`التحويل غير متكافئ: ${fromGrams.toFixed(3)} غ عيار ${fromKarat} تعادل ${(expected * 24 / Number(toKarat)).toFixed(3)} غ عيار ${toKarat}.`);
    }
    const existing = await this.db.select({ id: goldTransactions.id }).from(goldTransactions).where(eq(goldTransactions.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.getTransaction(user, existing[0].id);

    const transactionId = await this.db.transaction(async tx => {
      const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
      if (!partner) throw new ConflictException('The selected partner does not exist.');
      // A conversion restates an obligation that already exists, so it must move in the
      // direction that closes it: an amount the partner owes is closed by a credit, an
      // amount the shop owes by a debit. Converting nothing is a mistake, not a no-op.
      const { grams: current } = await this.posting.lockedPartnerBalance(tx, user, partnerId, fromKarat);
      if (Math.abs(current) < 0.0005) throw new ConflictException(`لا يوجد رصيد عيار ${fromKarat} لهذا الطرف حتى يُحوَّل.`);
      if (fromGrams > Math.abs(current) + 0.0005) throw new ConflictException(`الرصيد المتاح للتحويل هو ${Math.abs(current).toFixed(3)} غ عيار ${fromKarat} فقط.`);
      const partnerOwes = current > 0;
      const transaction = await this.posting.post(tx, user, {
        type: 'conversion', sourceType: 'manual', postingEvent: `conversion:${idempotencyKey}`, idempotencyKey,
        description: `تحويل ${fromGrams.toFixed(3)} غ عيار ${fromKarat} إلى ${toGrams.toFixed(3)} غ عيار ${toKarat} — ${partner.name}`,
        userNote: note, partnerId,
        lines: partnerOwes
          ? [
              { partnerId, karat: fromKarat, creditGrams: fromGrams, description: `إقفال ${fromGrams.toFixed(3)} غ عيار ${fromKarat}` },
              { partnerId, karat: toKarat, debitGrams: toGrams, description: `إثبات ${toGrams.toFixed(3)} غ عيار ${toKarat}` },
            ]
          : [
              { partnerId, karat: fromKarat, debitGrams: fromGrams, description: `إقفال ${fromGrams.toFixed(3)} غ عيار ${fromKarat}` },
              { partnerId, karat: toKarat, creditGrams: toGrams, description: `إثبات ${toGrams.toFixed(3)} غ عيار ${toKarat}` },
            ],
      });
      await this.audit.record({ actorUserId: user.id, action: 'gold.conversion', module: 'gold', entityId: transaction.id, metadata: { transactionNumber: transaction.transactionNumber, partnerId, fromKarat, fromGrams: fromGrams.toFixed(3), toKarat, toGrams: toGrams.toFixed(3), pureGoldGrams: expected.toFixed(4), direction: partnerOwes ? 'partner_owes_shop' : 'shop_owes_partner' } }, tx);
      return transaction.id;
    });
    const result = await this.getTransaction(user, transactionId);
    this.realtime.emitToPermissions(['gold_accounts.view'], 'gold_account.updated', { partnerId });
    return result;
  }

  // An explicit opening obligation, recorded as a transaction like everything else.
  async createOpening(user: AuthIdentity, input: Record<string, unknown>) {
    const partnerId = uuid(input.partnerId, 'partnerId');
    const karat = this.posting.assertKarat(input.karat);
    const grams = weight(input.weightGrams, 'weightGrams');
    const direction = input.direction === 'shop_owes_partner' ? 'shop_owes_partner' : 'partner_owes_shop';
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const note = this.optional(input.note, 1000);
    const occurredAt = typeof input.date === 'string' && !Number.isNaN(Date.parse(input.date)) ? new Date(input.date) : new Date();
    const existing = await this.db.select({ id: goldTransactions.id }).from(goldTransactions).where(eq(goldTransactions.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.getTransaction(user, existing[0].id);

    const transactionId = await this.db.transaction(async tx => {
      const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
      if (!partner) throw new ConflictException('The selected partner does not exist.');
      const partnerLine = direction === 'partner_owes_shop'
        ? { partnerId, karat, debitGrams: grams, description: `رصيد افتتاحي: ${partner.name} مدين بـ ${grams.toFixed(3)} غ عيار ${karat}` }
        : { partnerId, karat, creditGrams: grams, description: `رصيد افتتاحي: المحل مدين لـ ${partner.name} بـ ${grams.toFixed(3)} غ عيار ${karat}` };
      const counterLine = direction === 'partner_owes_shop'
        ? { systemCode: 'opening_gold', karat, creditGrams: grams, description: 'مقابل الرصيد الافتتاحي للأوزان' }
        : { systemCode: 'opening_gold', karat, debitGrams: grams, description: 'مقابل الرصيد الافتتاحي للأوزان' };
      const transaction = await this.posting.post(tx, user, {
        type: 'opening', sourceType: 'manual', postingEvent: `opening:${idempotencyKey}`, idempotencyKey, occurredAt,
        description: `رصيد ذهب افتتاحي — ${partner.name}`, userNote: note, partnerId,
        lines: [partnerLine as any, counterLine as any],
      });
      await this.audit.record({ actorUserId: user.id, action: 'gold.opening', module: 'gold', entityId: transaction.id, metadata: { transactionNumber: transaction.transactionNumber, partnerId, karat, weightGrams: grams.toFixed(3), direction } }, tx);
      return transaction.id;
    });
    const result = await this.getTransaction(user, transactionId);
    this.realtime.emitToPermissions(['gold_accounts.view'], 'gold_account.updated', { partnerId });
    return result;
  }

  /**
   * A manual correction to the metal the shop itself holds — no partner on either side.
   *
   * This is the gap TASK 22 §3.3 documented and deliberately refused to fake: every other
   * write here requires a partnerId, so there was no honest way to state "the shop has this
   * much gold". The counter-entry goes to the `opening_gold` system account, which holdings()
   * excludes, so only the company side counts as metal.
   *
   * Several karats may be adjusted in one transaction, each with its own free-text note. The
   * notes are documentation and nothing else: they create no person, no custody record and no
   * obligation on anyone. Karats are never merged — one ledger line per karat, as everywhere.
   */
  async createCompanyAdjustment(user: AuthIdentity, input: Record<string, unknown>) {
    const direction = input.direction === 'decrease' ? 'decrease' : 'increase';
    const warehouseId = input.warehouseId ? uuid(input.warehouseId, 'warehouseId') : null;
    if (warehouseId) this.scope.assertAccess(user, warehouseId);
    const idempotencyKey = uuid(input.idempotencyKey, 'idempotencyKey');
    const note = this.optional(input.note, 1000);

    if (!Array.isArray(input.lines) || !input.lines.length) throw new ConflictException('أدخل وزناً واحداً على الأقل.');
    if (input.lines.length > 20) throw new ConflictException('عدد الأسطر أكبر من المسموح.');
    const lines = (input.lines as Array<Record<string, unknown>>).map((line, index) => ({
      karat: this.posting.assertKarat(line.karat, `lines[${index}].karat`),
      grams: weight(line.weightGrams, `lines[${index}].weightGrams`),
      note: this.optional(line.note, 500),
    }));
    // One line per karat: two lines of the same karat would post twice against one balance
    // and read as a single figure on the screen.
    const karats = new Set(lines.map(line => line.karat));
    if (karats.size !== lines.length) throw new ConflictException('لا تكرر العيار نفسه في أكثر من سطر.');

    const existing = await this.db.select({ id: goldTransactions.id }).from(goldTransactions).where(eq(goldTransactions.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) return this.getTransaction(user, existing[0].id);

    const total = lines.reduce((sum, line) => sum + line.grams, 0);
    const transactionId = await this.db.transaction(async tx => {
      const transaction = await this.posting.post(tx, user, {
        type: 'opening', sourceType: 'manual', postingEvent: `company_adjustment:${idempotencyKey}`, idempotencyKey,
        description: direction === 'increase'
          ? `إضافة وزن يدوية إلى ذهب المحل — ${lines.length} عيار، ${total.toFixed(3)} غ`
          : `خصم وزن يدوي من ذهب المحل — ${lines.length} عيار، ${total.toFixed(3)} غ`,
        userNote: note, warehouseId,
        lines: lines.flatMap(line => {
          const description = `${direction === 'increase' ? 'إضافة' : 'خصم'} ${line.grams.toFixed(3)} غ عيار ${line.karat}${line.note ? ` — ${line.note}` : ''}`;
          return direction === 'increase'
            ? [
                { companyWarehouseId: warehouseId, karat: line.karat, debitGrams: line.grams, warehouseId, description } as any,
                { systemCode: 'opening_gold', karat: line.karat, creditGrams: line.grams, description: `مقابل ${description}` } as any,
              ]
            : [
                { systemCode: 'opening_gold', karat: line.karat, debitGrams: line.grams, description: `مقابل ${description}` } as any,
                { companyWarehouseId: warehouseId, karat: line.karat, creditGrams: line.grams, warehouseId, description } as any,
              ];
        }),
      });
      await this.audit.record({
        actorUserId: user.id, action: 'gold.company_adjustment', module: 'gold', entityId: transaction.id, warehouseId: warehouseId ?? undefined,
        metadata: { transactionNumber: transaction.transactionNumber, direction, totalGrams: total.toFixed(3), lines: lines.map(line => ({ karat: line.karat, weightGrams: line.grams.toFixed(3), note: line.note })) },
      }, tx);
      return transaction.id;
    });
    const result = await this.getTransaction(user, transactionId);
    this.realtime.emitToPermissions(['gold_accounts.view'], 'gold_transaction.created', { id: transactionId, partnerId: null });
    return result;
  }

  async reverseTransaction(user: AuthIdentity, transactionId: string, input: Record<string, unknown>) {
    const reason = this.text(input.reason, 'reason', 500);
    transactionId = uuid(transactionId, 'id');
    await this.db.transaction(async tx => {
      const original = (await tx.select().from(goldTransactions).where(eq(goldTransactions.id, transactionId)).limit(1))[0];
      if (!original) throw new NotFoundException('Gold transaction not found.');
      if (original.warehouseId) this.scope.assertAccess(user, original.warehouseId);
      if (original.status === 'reversed') throw new ConflictException('هذه الحركة معكوسة مسبقاً.');
      if (original.sourceType !== 'manual') throw new ConflictException('حركات الذهب الآلية تُعكس بإلغاء المستند المصدر لها.');
      const reversal = await this.posting.reverse(tx, user, transactionId, reason);
      if (!reversal) throw new ConflictException('هذه الحركة معكوسة مسبقاً.');
      await this.audit.record({ actorUserId: user.id, action: 'gold.reverse', module: 'gold', entityId: transactionId, warehouseId: original.warehouseId ?? undefined, metadata: { transactionNumber: original.transactionNumber, reversalNumber: reversal.transactionNumber, reason } }, tx);
    });
    const result = await this.getTransaction(user, transactionId);
    this.realtime.emitToPermissions(['gold_accounts.view'], 'gold_transaction.reversed', { id: transactionId });
    return result;
  }

  /**
   * Every posted gold exchange must have produced exactly one gold movement, and every
   * transaction must still balance in pure gold. Anything else is reported, not hidden.
   */
  async reconciliation(_user: AuthIdentity) {
    const [exchanges, unbalanced, karatTotals] = await Promise.all([
      // A left join, not a correlated subquery: Drizzle renders the latter without the
      // outer reference, which silently reports every exchange as unposted.
      this.db.select({
        id: salesGoldExchanges.id, karat: salesGoldExchanges.karat, weightGrams: salesGoldExchanges.weightGrams,
        postedLines: sql<number>`count(${goldLedgerEntries.id})::int`,
      }).from(salesGoldExchanges).leftJoin(goldLedgerEntries, eq(goldLedgerEntries.salesGoldExchangeId, salesGoldExchanges.id))
        .groupBy(salesGoldExchanges.id, salesGoldExchanges.karat, salesGoldExchanges.weightGrams),
      this.db.select({
        transactionNumber: goldTransactions.transactionNumber,
        debit: sql<string>`coalesce(sum(case when ${goldLedgerEntries.debitGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else 0 end), 0)`,
        credit: sql<string>`coalesce(sum(case when ${goldLedgerEntries.creditGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else 0 end), 0)`,
      }).from(goldTransactions).innerJoin(goldLedgerEntries, eq(goldLedgerEntries.goldTransactionId, goldTransactions.id)).groupBy(goldTransactions.id, goldTransactions.transactionNumber),
      // Same-karat movements must cancel out within their karat. Karat conversions are the
      // only transactions that deliberately do not, so they are measured on their own.
      this.db.select({
        karat: goldLedgerEntries.karat,
        debit: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams}), 0)`,
        credit: sql<string>`coalesce(sum(${goldLedgerEntries.creditGrams}), 0)`,
        sameKaratDebit: sql<string>`coalesce(sum(case when ${goldTransactions.type} <> 'conversion' then ${goldLedgerEntries.debitGrams} else 0 end), 0)`,
        sameKaratCredit: sql<string>`coalesce(sum(case when ${goldTransactions.type} <> 'conversion' then ${goldLedgerEntries.creditGrams} else 0 end), 0)`,
        pure: sql<string>`coalesce(sum(case when ${goldLedgerEntries.debitGrams} > 0 then ${goldLedgerEntries.pureGoldGrams} else -${goldLedgerEntries.pureGoldGrams} end), 0)`,
      }).from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId)).groupBy(goldLedgerEntries.karat),
    ]);

    const unpostedExchanges = exchanges.filter(row => row.postedLines === 0);
    const brokenTransactions = unbalanced.filter(row => Math.abs(Number(row.debit) - Number(row.credit)) > 0.001);
    const karats = karatTotals.map(row => ({
      karat: row.karat,
      totalDebitGrams: Number(Number(row.debit).toFixed(3)), totalCreditGrams: Number(Number(row.credit).toFixed(3)),
      // What conversions carried into or out of this karat, stated rather than hidden.
      conversionNetGrams: Number((Number(row.debit) - Number(row.credit) - (Number(row.sameKaratDebit) - Number(row.sameKaratCredit))).toFixed(3)),
      netPureGoldGrams: Number(Number(row.pure).toFixed(4)),
      balanced: Math.abs(Number(row.sameKaratDebit) - Number(row.sameKaratCredit)) < 0.0005,
    }));
    // Every transaction balances in pure gold, so the whole ledger must net to zero fine
    // gold across all accounts — the one number that proves nothing was created or lost.
    const netPureGoldGrams = Number(karats.reduce((sum, row) => sum + row.netPureGoldGrams, 0).toFixed(3));

    return {
      salesExchanges: { total: exchanges.length, posted: exchanges.length - unpostedExchanges.length, unposted: unpostedExchanges.length, matches: unpostedExchanges.length === 0 },
      transactions: { total: unbalanced.length, unbalanced: brokenTransactions.length, unbalancedNumbers: brokenTransactions.map(row => row.transactionNumber), matches: brokenTransactions.length === 0 },
      karats,
      karatsBalanced: karats.every(row => row.balanced),
      netPureGoldGrams,
      pureGoldBalanced: Math.abs(netPureGoldGrams) < 0.005,
      notes: [
        'كل حركة ذهب متوازنة بالذهب الصافي، فتحويل العيار ممكن دون جمع أوزان عيارات مختلفة.',
        'مجاميع كل عيار متوازنة عدا ما نقله تحويل العيار، وهو معروض على حدة في conversionNetGrams.',
        'الذهب لا يمرّ على الصناديق النقدية إطلاقاً؛ القيمة النقدية للكسر محتسبة أصلاً ضمن الفاتورة.',
        'ذمم أوزان قديمة كانت مسجّلة في المتصفح بلا عيار لم تُرحّل، لأن العيار لا يمكن استنتاجه.',
      ],
    };
  }

  private text(value: unknown, field: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} is invalid.`); return value.trim(); }
  private optional(value: unknown, max: number) { return value === undefined || value === null || value === '' ? null : this.text(value, 'note', max); }
  private page(value: unknown) { const parsed = Number(value ?? 1); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1; }
  private limit(value: unknown) { const parsed = Number(value ?? 50); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50; }
  karats() { return [...KARATS]; }
}
