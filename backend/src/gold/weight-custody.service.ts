import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { goldAccounts, goldLedgerEntries, goldTransactions, partners, users, warehouses, weightCustodyPeople } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { GoldPostingService } from './gold-posting.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EPSILON = 0.0005;

/** Trim and collapse inner whitespace. Nothing else — names are never fuzzy-matched. */
export const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ');

const weight = (value: unknown, field: string) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw new ConflictException(`${field} غير صالح.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0.001) throw new ConflictException(`${field} غير صالح.`);
  return parsed;
};

/**
 * ذمم الأوزان — physical weight the shop entrusts to a person for work, and gets back.
 *
 * This is deliberately built on the existing gold ledger rather than beside it: the metal is
 * the same metal, and a second posting model would be a second version of the truth. What
 * changes here is only *who* the counterparty may be. A polisher gets a light custody identity
 * of their own, so recording custody never forces a worker into the commercial partners table.
 *
 * Money is untouched throughout: the gold ledger has no link to vouchers, cash or journals,
 * so custody creates no financial or accounting effect of any kind.
 */
@Injectable()
export class WeightCustodyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService,
    @Inject(GoldPostingService) private readonly posting: GoldPostingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  // ---------------------------------------------------------------- people

  /** One search box over both custody people and commercial partners (§40). */
  async searchPeople(user: AuthIdentity, query: Record<string, unknown>) {
    const term = typeof query.search === 'string' ? normalizeName(query.search) : '';
    const like = `%${term}%`;
    const people = await this.db.select({ person: weightCustodyPeople, partnerName: partners.name, partnerType: partners.type })
      .from(weightCustodyPeople).leftJoin(partners, eq(partners.id, weightCustodyPeople.partnerId))
      .where(and(eq(weightCustodyPeople.isActive, true), term ? or(ilike(weightCustodyPeople.displayName, like), ilike(weightCustodyPeople.phone, like)) : undefined))
      .orderBy(asc(weightCustodyPeople.displayName)).limit(20);

    // Existing partners are offered as identities too, with no role requirement whatsoever:
    // a supplier-only partner is a perfectly valid custody recipient.
    const linked = new Set(people.map(row => row.person.partnerId).filter(Boolean) as string[]);
    const partnerRows = term
      ? await this.db.select({ id: partners.id, name: partners.name, type: partners.type, phone: partners.phone })
          .from(partners).where(and(eq(partners.isActive, true), isNull(partners.archivedAt), or(ilike(partners.name, like), ilike(partners.phone, like))))
          .orderBy(asc(partners.name)).limit(20)
      : [];

    return {
      people: people.map(row => ({
        id: row.person.id, name: row.person.displayName, phone: row.person.phone, note: row.person.note,
        partnerId: row.person.partnerId, partnerName: row.partnerName, partnerType: row.partnerType,
        kind: 'custody_person' as const,
      })),
      partners: partnerRows.filter(row => !linked.has(row.id)).map(row => ({ id: row.id, name: row.name, phone: row.phone, partnerType: row.type, kind: 'partner' as const })),
      canCreate: user.permissions.includes('gold_accounts.transaction.create'),
    };
  }

  async createPerson(user: AuthIdentity, input: Record<string, unknown>) {
    const person = await this.db.transaction(async tx => this.resolvePerson(tx, user, input));
    await this.audit.record({ actorUserId: user.id, action: 'weight_custody.person.create', module: 'gold', entityId: person.id, metadata: { name: person.displayName, partnerId: person.partnerId } });
    return this.personDto(person);
  }

  /**
   * Turns whatever the screen sent into a durable custody identity, inside the caller's
   * transaction so a failed hand-out never leaves an orphan person behind (§47).
   *
   * Accepts an existing custody person, an existing partner, or a bare typed name.
   */
  private async resolvePerson(tx: any, user: AuthIdentity, input: Record<string, unknown>) {
    if (input.custodyPersonId) {
      const row = (await tx.select().from(weightCustodyPeople).where(eq(weightCustodyPeople.id, this.id(input.custodyPersonId, 'custodyPersonId'))).limit(1))[0];
      if (!row) throw new NotFoundException('الشخص غير موجود.');
      if (!row.isActive) throw new ConflictException('هذا الشخص مؤرشف.');
      return row;
    }

    if (input.partnerId) {
      // Linking to a partner is an identity reference only: the partner's commercial role is
      // never read as a requirement and never rewritten.
      const partnerId = this.id(input.partnerId, 'partnerId');
      const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
      if (!partner) throw new ConflictException('الشريك المحدد غير موجود.');
      const existing = (await tx.select().from(weightCustodyPeople).where(eq(weightCustodyPeople.partnerId, partnerId)).limit(1))[0];
      if (existing) return existing;
      return (await tx.insert(weightCustodyPeople).values({
        displayName: partner.name, normalizedName: normalizeName(partner.name), phone: partner.phone,
        partnerId, createdByUserId: user.id,
      }).returning())[0]!;
    }

    const name = typeof input.name === 'string' ? normalizeName(input.name) : '';
    if (name.length < 2 || name.length > 180) throw new ConflictException('اسم الشخص غير صالح.');
    // An identical name is the same person being reused, which is the point of §8. Different
    // spellings stay different people — nothing is merged on similarity.
    const existing = (await tx.select().from(weightCustodyPeople).where(eq(weightCustodyPeople.normalizedName, name)).limit(1))[0];
    if (existing) {
      if (!existing.isActive) throw new ConflictException('هذا الشخص مؤرشف.');
      return existing;
    }
    return (await tx.insert(weightCustodyPeople).values({
      displayName: name, normalizedName: name,
      phone: this.optional(input.phone, 50), note: this.optional(input.note, 500),
      createdByUserId: user.id,
    }).returning())[0]!;
  }

  /** The custody gold account for a person, created on first use. */
  private async custodyAccount(tx: any, user: AuthIdentity, person: { id: string; displayName: string }) {
    const existing = (await tx.select().from(goldAccounts).where(eq(goldAccounts.custodyPersonId, person.id)).limit(1))[0];
    if (existing) return existing;
    return (await tx.insert(goldAccounts).values({
      kind: 'custody_person', name: person.displayName, custodyPersonId: person.id, createdByUserId: user.id,
    }).returning())[0]!;
  }

  // ---------------------------------------------------------------- movements

  async handOut(user: AuthIdentity, input: Record<string, unknown>) { return this.move(user, input, 'hand_out'); }
  async receive(user: AuthIdentity, input: Record<string, unknown>) { return this.move(user, input, 'receive'); }

  private async move(user: AuthIdentity, input: Record<string, unknown>, kind: 'hand_out' | 'receive') {
    const karat = this.posting.assertKarat(input.karat);
    const grams = weight(input.weightGrams, 'الوزن');
    const idempotencyKey = this.id(input.idempotencyKey, 'idempotencyKey');
    const note = this.optional(input.note, 1000);
    // The warehouse is where the metal physically changed hands, and it is stamped on the
    // movement so history never has to guess it from the person's later state (§20).
    const warehouseId = input.warehouseId ? this.id(input.warehouseId, 'warehouseId') : (this.authorization.allowedWarehouseIds(user) ?? [])[0] ?? null;
    if (!warehouseId) throw new ConflictException('اختر الفرع الذي تمّت فيه الحركة.');
    this.authorization.assertWarehouse(user, warehouseId);

    const existing = (await this.db.select({ id: goldTransactions.id }).from(goldTransactions).where(eq(goldTransactions.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (existing) return this.movementDto(user, existing.id);

    const transactionId = await this.db.transaction(async tx => {
      const person = await this.resolvePerson(tx, user, (input.person ?? input) as Record<string, unknown>);
      const account = await this.custodyAccount(tx, user, person);

      // Balance read under a row lock so two managers cannot both decide against a stale one.
      const locked = (await tx.select({ id: goldAccounts.id }).from(goldAccounts).where(eq(goldAccounts.id, account.id)).limit(1).for('update'))[0]!;
      const outstandingRow = (await tx.select({ grams: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams} - ${goldLedgerEntries.creditGrams}), 0)` })
        .from(goldLedgerEntries).innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
        .where(and(eq(goldLedgerEntries.goldAccountId, locked.id), eq(goldLedgerEntries.karat, karat), eq(goldTransactions.status, 'posted'))))[0]!;
      const outstanding = Number(Number(outstandingRow.grams).toFixed(3));

      // Preserved from the existing gold behaviour: you cannot take back more than is out,
      // unless the operator deliberately allows a reverse balance (§31).
      if (kind === 'receive' && !(input.allowReverseBalance === true) && grams > outstanding + EPSILON) {
        throw new ConflictException(`لدى ${person.displayName} ${Math.max(0, outstanding).toFixed(3)} غ فقط عيار ${karat}. لتسجيل وزن أكبر فعّل السماح برصيد معاكس.`);
      }

      const transaction = await this.posting.post(tx, user, {
        type: kind === 'hand_out' ? 'payment' : 'receipt',
        sourceType: 'weight_custody',
        postingEvent: `custody_${kind}:${idempotencyKey}`,
        idempotencyKey,
        description: kind === 'hand_out'
          ? `تسليم ${grams.toFixed(3)} غ عيار ${karat} إلى ${person.displayName}`
          : `استلام ${grams.toFixed(3)} غ عيار ${karat} من ${person.displayName}`,
        userNote: note, warehouseId,
        lines: kind === 'hand_out'
          ? [
              { accountId: account.id, karat, debitGrams: grams, description: `عهدة وزن لدى ${person.displayName}` },
              { companyWarehouseId: warehouseId, karat, creditGrams: grams, warehouseId, description: `خروج ${grams.toFixed(3)} غ عيار ${karat} من المحل` },
            ]
          : [
              { companyWarehouseId: warehouseId, karat, debitGrams: grams, warehouseId, description: `دخول ${grams.toFixed(3)} غ عيار ${karat} إلى المحل` },
              { accountId: account.id, karat, creditGrams: grams, description: `إعادة عهدة من ${person.displayName}` },
            ],
      });

      await this.audit.record({
        actorUserId: user.id, action: `weight_custody.${kind}`, module: 'gold', entityId: transaction.id, warehouseId,
        metadata: { transactionNumber: transaction.transactionNumber, custodyPersonId: person.id, personName: person.displayName, karat, weightGrams: grams.toFixed(3), outstandingBeforeGrams: outstanding.toFixed(3), note },
      }, tx);
      return transaction.id;
    });

    const result = await this.movementDto(user, transactionId);
    this.realtime.emitToPermissions(['gold_accounts.view'], 'weight_custody.updated', { transactionId, warehouseId });
    return result;
  }

  // ---------------------------------------------------------------- reads

  /**
   * The custody cards. Outstanding is derived per person **per karat** and never merged:
   * 21K grams and 18K grams are two separate physical obligations.
   */
  async balances(user: AuthIdentity, query: Record<string, unknown> = {}) {
    const scope = this.warehouseFilter(user, query);
    const rows = await this.db.select({
      personId: weightCustodyPeople.id, name: weightCustodyPeople.displayName,
      phone: weightCustodyPeople.phone, note: weightCustodyPeople.note,
      partnerId: weightCustodyPeople.partnerId,
      karat: goldLedgerEntries.karat,
      handedOut: sql<string>`coalesce(sum(${goldLedgerEntries.debitGrams}), 0)`,
      receivedBack: sql<string>`coalesce(sum(${goldLedgerEntries.creditGrams}), 0)`,
    }).from(weightCustodyPeople)
      .innerJoin(goldAccounts, eq(goldAccounts.custodyPersonId, weightCustodyPeople.id))
      .innerJoin(goldLedgerEntries, eq(goldLedgerEntries.goldAccountId, goldAccounts.id))
      .innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
      .where(and(eq(goldTransactions.status, 'posted'), scope))
      .groupBy(weightCustodyPeople.id, weightCustodyPeople.displayName, weightCustodyPeople.phone, weightCustodyPeople.note, weightCustodyPeople.partnerId, goldLedgerEntries.karat);

    const grouped = new Map<string, any>();
    for (const row of rows) {
      const handedOut = Number(Number(row.handedOut).toFixed(3));
      const receivedBack = Number(Number(row.receivedBack).toFixed(3));
      const outstanding = Number((handedOut - receivedBack).toFixed(3));
      const entry = grouped.get(row.personId) ?? { personId: row.personId, name: row.name, phone: row.phone, note: row.note, partnerId: row.partnerId, balances: [], settled: true };
      entry.balances.push({ karat: row.karat, handedOutGrams: handedOut, receivedBackGrams: receivedBack, outstandingGrams: outstanding });
      if (Math.abs(outstanding) > EPSILON) entry.settled = false;
      grouped.set(row.personId, entry);
    }
    const people = [...grouped.values()]
      .map(entry => ({ ...entry, balances: entry.balances.sort((a: any, b: any) => Number(b.karat) - Number(a.karat)) }))
      .filter(entry => query.includeSettled === 'true' || !entry.settled)
      .sort((left, right) => left.name.localeCompare(right.name, 'ar'));
    return { people, canManage: user.permissions.includes('gold_accounts.transaction.create') };
  }

  async personDetail(user: AuthIdentity, personId: string) {
    personId = this.id(personId, 'personId');
    const person = (await this.db.select({ person: weightCustodyPeople, partnerName: partners.name, partnerType: partners.type })
      .from(weightCustodyPeople).leftJoin(partners, eq(partners.id, weightCustodyPeople.partnerId))
      .where(eq(weightCustodyPeople.id, personId)).limit(1))[0];
    if (!person) throw new NotFoundException('الشخص غير موجود.');

    const scope = this.warehouseFilter(user, {});
    const movements = await this.db.select({
      entry: goldLedgerEntries, transaction: goldTransactions,
      actorName: users.fullName, warehouseName: warehouses.name,
    }).from(goldLedgerEntries)
      .innerJoin(goldAccounts, eq(goldAccounts.id, goldLedgerEntries.goldAccountId))
      .innerJoin(goldTransactions, eq(goldTransactions.id, goldLedgerEntries.goldTransactionId))
      .innerJoin(users, eq(users.id, goldTransactions.createdByUserId))
      .leftJoin(warehouses, eq(warehouses.id, goldTransactions.warehouseId))
      .where(and(eq(goldAccounts.custodyPersonId, personId), scope))
      .orderBy(desc(goldLedgerEntries.occurredAt), desc(goldLedgerEntries.createdAt)).limit(200);

    const balances = (await this.balances(user, { includeSettled: 'true' })).people.find(row => row.personId === personId);
    return {
      ...this.personDto(person.person),
      partnerName: person.partnerName, partnerType: person.partnerType,
      balances: balances?.balances ?? [], settled: balances?.settled ?? true,
      movements: movements.map(row => ({
        id: row.entry.id,
        transactionId: row.transaction.id,
        transactionNumber: row.transaction.transactionNumber,
        // A debit on the custody account is metal going out to the person.
        type: Number(row.entry.debitGrams) > 0 ? 'handed_out' : 'received_back',
        karat: row.entry.karat,
        weightGrams: Number(Number(row.entry.debitGrams) > 0 ? row.entry.debitGrams : row.entry.creditGrams),
        occurredAt: row.entry.occurredAt.toISOString(),
        status: row.transaction.status,
        warehouseId: row.transaction.warehouseId,
        warehouseName: row.warehouseName,
        actor: row.actorName,
        note: row.transaction.userNote ?? '',
        description: row.transaction.description,
      })),
    };
  }

  // ---------------------------------------------------------------- internals

  /** Movements are visible where they physically happened; the person is not warehouse-bound. */
  private warehouseFilter(user: AuthIdentity, _query: Record<string, unknown>) {
    const allowed = this.authorization.allowedWarehouseIds(user);
    if (!allowed) return sql`true`;
    if (!allowed.length) return sql`false`;
    return inArray(goldTransactions.warehouseId, allowed);
  }

  private personDto(person: typeof weightCustodyPeople.$inferSelect) {
    return {
      id: person.id, name: person.displayName, phone: person.phone, note: person.note,
      partnerId: person.partnerId, isActive: person.isActive, createdAt: person.createdAt.toISOString(),
    };
  }

  private async movementDto(user: AuthIdentity, transactionId: string) {
    const row = (await this.db.select({ transaction: goldTransactions, actorName: users.fullName })
      .from(goldTransactions).innerJoin(users, eq(users.id, goldTransactions.createdByUserId))
      .where(eq(goldTransactions.id, transactionId)).limit(1))[0];
    if (!row) throw new NotFoundException('الحركة غير موجودة.');
    const person = (await this.db.select({ person: weightCustodyPeople })
      .from(goldLedgerEntries)
      .innerJoin(goldAccounts, eq(goldAccounts.id, goldLedgerEntries.goldAccountId))
      .innerJoin(weightCustodyPeople, eq(weightCustodyPeople.id, goldAccounts.custodyPersonId))
      .where(eq(goldLedgerEntries.goldTransactionId, transactionId)).limit(1))[0];
    return {
      transactionId: row.transaction.id,
      transactionNumber: row.transaction.transactionNumber,
      description: row.transaction.description,
      status: row.transaction.status,
      warehouseId: row.transaction.warehouseId,
      occurredAt: row.transaction.occurredAt.toISOString(),
      actor: row.actorName,
      person: person ? this.personDto(person.person) : null,
    };
  }

  private id(value: unknown, field: string) { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; }
  private optional(value: unknown, max: number) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException('القيمة غير صالحة.');
    return value.trim();
  }
}
