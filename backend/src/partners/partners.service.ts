import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingDocumentsService } from '../accounting/accounting-documents.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { partnerLedgerEntries, partners, type PartnerRow } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

type PartnerKind = 'customer' | 'supplier' | 'both';
type PartnerAction = 'view' | 'create' | 'update' | 'archive';
const kinds = new Set<PartnerKind>(['customer', 'supplier', 'both']);

@Injectable()
export class PartnersService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(AuditService) private readonly audit: AuditService, @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway, @Inject(AccountingDocumentsService) private readonly accounting: AccountingDocumentsService) {}

  async list(user: AuthIdentity, query: Record<string, unknown>) {
    const type = this.queryKind(query.type);
    const visible = this.visibleKinds(user);
    if (!visible.length) throw new ForbiddenException('Partner view permission is required.');
    if (type && !this.can(user, type, 'view')) throw new ForbiddenException('Partner view permission is required.');
    const page = this.page(query.page); const limit = this.limit(query.limit); const search = this.optional(query.search);
    const active = query.includeArchived === 'true' ? undefined : true;
    const sort = query.sort === 'createdAt' || query.sort === 'updatedAt' || query.sort === 'name' ? query.sort : 'name';
    const direction = query.order === 'desc' ? desc : asc;
    const allowedKinds = type ? this.kindsForTab(type) : visible;
    const conditions = [inArray(partners.type, allowedKinds)];
    if (active === true) conditions.push(and(eq(partners.isActive, true), isNull(partners.archivedAt))!);
    if (active === undefined && query.includeArchived !== 'true') conditions.push(isNull(partners.archivedAt));
    if (search) conditions.push(or(ilike(partners.name, `%${search}%`), ilike(partners.phone, `%${search}%`), ilike(partners.address, `%${search}%`))!);
    const where = and(...conditions);
    const orderBy = sort === 'createdAt' ? direction(partners.createdAt) : sort === 'updatedAt' ? direction(partners.updatedAt) : direction(partners.name);
    const [rows, countRows] = await Promise.all([
      this.db.select().from(partners).where(where).orderBy(orderBy, asc(partners.id)).limit(limit).offset((page - 1) * limit),
      this.db.select({ total: sql<number>`count(*)::int` }).from(partners).where(where),
    ]);
    // §66: one grouped query covers the whole page. Asking per row would be a request per
    // customer, which this screen is opened often enough to feel and which stops scaling as
    // soon as the partner list grows.
    const positions = await this.ledgerPositions(rows.map(row => row.id));
    return { items: rows.map(row => partnerDto(row, positions.get(row.id))), meta: { page, limit, total: countRows[0]?.total ?? 0 } };
  }

  async get(user: AuthIdentity, id: string, includeArchived = false) {
    const partner = await this.find(id, includeArchived);
    this.assert(user, partner.type, 'view');
    return partnerDto(partner, await this.ledgerPosition(partner.id));
  }

  /** The subledger side of a single partner's balance — see `partnerDto` for why it is not stored. */
  private async ledgerPosition(partnerId: string) {
    return (await this.ledgerPositions([partnerId])).get(partnerId) ?? { ledgerNet: 0, lastActivityAt: null };
  }

  /** The same figures for a whole page of partners, grouped in one query rather than one each. */
  private async ledgerPositions(partnerIds: string[]) {
    const positions = new Map<string, { ledgerNet: number; lastActivityAt: Date | null }>();
    if (!partnerIds.length) return positions;
    const rows = await this.db.select({
      partnerId: partnerLedgerEntries.partnerId,
      net: sql<string>`coalesce(sum(${partnerLedgerEntries.debitUsd} - ${partnerLedgerEntries.creditUsd}), 0)`,
      lastActivityAt: sql<Date | null>`max(${partnerLedgerEntries.occurredAt})`,
    }).from(partnerLedgerEntries).where(inArray(partnerLedgerEntries.partnerId, partnerIds)).groupBy(partnerLedgerEntries.partnerId);
    for (const row of rows) positions.set(row.partnerId, { ledgerNet: Number(row.net), lastActivityAt: row.lastActivityAt });
    return positions;
  }

  async create(user: AuthIdentity, input: Record<string, unknown>) {
    const values = this.values(input, true); this.assert(user, values.type, 'create');
    await this.assertNoDuplicate(values);
    try {
      // An opening balance is money the books must know about immediately, so the
      // partner and its opening journal are written in one transaction.
      const created = await this.db.transaction(async tx => {
        const row = (await tx.insert(partners).values({ ...values, createdByUserId: user.id, updatedByUserId: user.id }).returning())[0]!;
        await this.accounting.postPartnerOpening(tx, user, { id: row.id, name: row.name, type: row.type, openingBalanceUsd: Number(row.openingBalanceUsd), rate: 1 });
        return row;
      });
      await this.audit.record({ actorUserId: user.id, action: 'partners.create', module: 'partners', entityId: created.id, metadata: { type: created.type } });
      this.emit(created, 'partners.created');
      return partnerDto(created);
    } catch (error: any) { if (error?.code === '23505' || error?.cause?.code === '23505') throw new ConflictException('A partner with the same phone or tax number already exists.'); throw error; }
  }

  async update(user: AuthIdentity, id: string, input: Record<string, unknown>) {
    const current = await this.find(id); this.assert(user, current.type, 'update');
    const version = this.version(input.version); if (version !== current.version) throw new ConflictException('Partner changed by another user.');
    const values = this.values({ ...current, ...input }, false); this.assert(user, values.type, 'update');
    await this.assertNoDuplicate(values, current.id);
    const updated = await this.db.update(partners).set({ ...values, version: sql`${partners.version} + 1`, updatedByUserId: user.id, updatedAt: new Date() }).where(and(eq(partners.id, current.id), eq(partners.version, version), isNull(partners.archivedAt))).returning();
    if (!updated[0]) throw new ConflictException('Partner changed by another user.');
    await this.audit.record({ actorUserId: user.id, action: 'partners.update', module: 'partners', entityId: current.id, metadata: { type: updated[0].type } });
    this.emit(updated[0], 'partners.updated');
    return partnerDto(updated[0], await this.ledgerPosition(updated[0].id));
  }

  async archive(user: AuthIdentity, id: string, version: number) {
    const current = await this.find(id); this.assert(user, current.type, 'archive'); if (version !== current.version) throw new ConflictException('Partner changed by another user.');
    const archived = await this.db.update(partners).set({ isActive: false, archivedAt: new Date(), archivedByUserId: user.id, updatedByUserId: user.id, version: sql`${partners.version} + 1`, updatedAt: new Date() }).where(and(eq(partners.id, current.id), eq(partners.version, version), isNull(partners.archivedAt))).returning();
    if (!archived[0]) throw new ConflictException('Partner changed by another user.');
    await this.audit.record({ actorUserId: user.id, action: 'partners.archive', module: 'partners', entityId: current.id, metadata: { type: current.type } }); this.emit(archived[0], 'partners.archived');
    return { success: true };
  }

  async reactivate(user: AuthIdentity, id: string, version: number) {
    const current = await this.find(id, true); this.assert(user, current.type, 'archive'); if (version !== current.version) throw new ConflictException('Partner changed by another user.');
    const restored = await this.db.update(partners).set({ isActive: true, archivedAt: null, archivedByUserId: null, updatedByUserId: user.id, version: sql`${partners.version} + 1`, updatedAt: new Date() }).where(and(eq(partners.id, current.id), eq(partners.version, version), isNotNull(partners.archivedAt))).returning();
    if (!restored[0]) throw new ConflictException('Partner changed by another user.');
    await this.audit.record({ actorUserId: user.id, action: 'partners.reactivate', module: 'partners', entityId: current.id, metadata: { type: current.type } }); this.emit(restored[0], 'partners.reactivated');
    return partnerDto(restored[0], await this.ledgerPosition(restored[0].id));
  }

  private async find(id: string, includeArchived = false) { id = this.uuid(id, 'id'); const row = (await this.db.select().from(partners).where(and(eq(partners.id, id), includeArchived ? undefined : isNull(partners.archivedAt))).limit(1))[0]; if (!row) throw new NotFoundException('Partner not found.'); return row; }
  private visibleKinds(user: AuthIdentity) { return (['customer', 'supplier', 'both'] as PartnerKind[]).filter(kind => this.can(user, kind, 'view')); }
  private kindsForTab(type: PartnerKind): PartnerKind[] { return type === 'customer' ? ['customer', 'both'] : type === 'supplier' ? ['supplier', 'both'] : ['both']; }
  private can(user: AuthIdentity, kind: PartnerKind, action: PartnerAction) { const required = kind === 'both' ? [`customers.${action}`, `suppliers.${action}`] : [`${kind === 'customer' ? 'customers' : 'suppliers'}.${action}`]; return required.every(code => user.permissions.includes(code)); }
  private assert(user: AuthIdentity, kind: PartnerKind, action: PartnerAction) { if (!this.can(user, kind, action)) throw new ForbiddenException('Partner permission denied.'); }
  private emit(partner: PartnerRow, event: string) { const permissions = partner.type === 'customer' ? ['customers.view'] : partner.type === 'supplier' ? ['suppliers.view'] : ['customers.view', 'suppliers.view']; this.realtime.emitToPermissions(permissions, event, { id: partner.id, type: partner.type, version: partner.version }); }
  private values(input: Record<string, unknown>, creating: boolean) {
    const type = this.kind(input.type); const name = this.text(input.name, 'name'); const phone = this.optional(input.phone); const taxNumber = this.optional(input.taxNumber); const address = this.optional(input.address); const notes = this.optional(input.notes);
    const result = { name, normalizedName: normalizeText(name), type, phone, normalizedPhone: phone ? normalizePhone(phone) : null, address, notes, taxNumber, normalizedTaxNumber: taxNumber ? normalizeText(taxNumber) : null };
    if (!creating) return result;
    return { ...result, openingBalanceUsd: decimal(input.openingBalanceUSD ?? input.openingBalanceUsd ?? '0', 'openingBalanceUSD', 4), openingGoldBalance21kGrams: decimal(input.openingGoldBalance21kGrams ?? input.goldBalance21kGrams ?? '0', 'openingGoldBalance21kGrams', 3) };
  }
  private async assertNoDuplicate(values: { normalizedPhone: string | null; normalizedTaxNumber: string | null }, excludeId?: string) {
    const checks = [values.normalizedPhone ? eq(partners.normalizedPhone, values.normalizedPhone) : undefined, values.normalizedTaxNumber ? eq(partners.normalizedTaxNumber, values.normalizedTaxNumber) : undefined].filter(Boolean);
    if (!checks.length) return; const matches = await this.db.select({ id: partners.id }).from(partners).where(and(or(...checks as any), isNull(partners.archivedAt))); if (matches.some(row => row.id !== excludeId)) throw new ConflictException('A partner with the same phone or tax number already exists.');
  }
  private kind(value: unknown) { if (typeof value !== 'string' || !kinds.has(value as PartnerKind)) throw new ConflictException('Partner type is invalid.'); return value as PartnerKind; }
  private queryKind(value: unknown) { if (value === undefined || value === '') return undefined; return this.kind(value); }
  private text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 180) throw new ConflictException(`${field} is invalid.`); return value.trim(); }
  private optional(value: unknown) { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || value.trim().length > 1000) throw new ConflictException('A partner field is invalid.'); return value.trim(); }
  private uuid(value: unknown, field: string) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ConflictException(`${field} is invalid.`); return value; }
  private page(value: unknown) { const parsed = Number(value ?? 1); return Number.isInteger(parsed) && parsed > 0 && parsed <= 100000 ? parsed : 1; }
  private limit(value: unknown) { const parsed = Number(value ?? 30); return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 30; }
  private version(value: unknown) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new ConflictException('version is invalid.'); return parsed; }
}

const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
const normalizePhone = (value: string) => value.trim().replace(/[\s()\-.]/g, '').replace(/^00/, '+');
const decimal = (value: unknown, field: string, scale: number) => { const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; if (!Number.isFinite(number) || Math.abs(number) >= 10 ** (16 - scale)) throw new ConflictException(`${field} is invalid.`); return number.toFixed(scale); };
// TASK 17 §21: `balanceUSD` is the partner's real position — the opening balance plus every
// posted movement in their subledger — not the static `partners.opening_balance_usd` column.
//
// Reading that column alone was why the management screen showed `0$` for everyone: production
// has it at zero for all nine partners while the subledger legitimately carried $195 and $6,735.
// A stored balance is also the thing TASK 07/08 deliberately abolished, so the ledger is the
// only honest source. Callers that already know the ledger net pass it in; the rest resolve it.
const partnerDto = (partner: PartnerRow, extras?: { ledgerNet?: number; lastActivityAt?: Date | string | null }) => ({ id: partner.id, name: partner.name, type: partner.type, phone: partner.phone ?? '', address: partner.address ?? '', notes: partner.notes ?? '', taxNumber: partner.taxNumber ?? '', balanceUSD: Number((Number(partner.openingBalanceUsd) + (extras?.ledgerNet ?? 0)).toFixed(4)), openingBalanceUSD: Number(partner.openingBalanceUsd), goldBalance21kGrams: Number(partner.openingGoldBalance21kGrams), lastActivityAt: extras?.lastActivityAt ? new Date(extras.lastActivityAt).toISOString() : null, isActive: partner.isActive, version: partner.version, archivedAt: partner.archivedAt?.toISOString() ?? null, createdAt: partner.createdAt.toISOString(), updatedAt: partner.updatedAt.toISOString() });
