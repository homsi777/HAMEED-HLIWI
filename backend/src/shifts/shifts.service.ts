import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import { DocumentNumberService } from '../common/document-number.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { returnInvoices, salesInvoices, shiftActivities, shifts, users, warehouses } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { ShiftTotalsService, type ShiftTotals } from './shift-totals.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE = ['open', 'closing_requested'] as const;

export type ShiftRow = typeof shifts.$inferSelect;

const money = (value: unknown, scale = 4) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(raw)) throw new ConflictException('المبلغ غير صالح.');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ConflictException('المبلغ غير صالح.');
  return parsed.toFixed(scale);
};

@Injectable()
export class ShiftsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService,
    @Inject(ShiftTotalsService) private readonly totals: ShiftTotalsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
    @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService,
  ) {}

  // ---------------------------------------------------------------- used by sales & returns

  /** The caller's live shift, if any. Read inside the caller's transaction and locked. */
  async liveShiftFor(tx: any, userId: string): Promise<ShiftRow | undefined> {
    return (await tx.select().from(shifts).where(and(eq(shifts.sellerUserId, userId), inArray(shifts.status, [...LIVE]))).limit(1).for('update'))[0];
  }

  /**
   * Resolves the shift a new document belongs to.
   *
   * A seller must be inside an open shift to trade at all. Anyone else — a branch manager or
   * the General Manager acting at the counter — is not forced into a shift, but if they happen
   * to have one open the document is still attributed to it.
   */
  async resolveShiftForDocument(tx: any, user: AuthIdentity, warehouseId: string): Promise<string | null> {
    const live = await this.liveShiftFor(tx, user.id);
    const sellerBound = this.authorization.isOwnDataOnly(user);
    if (!live) {
      if (sellerBound) throw new ConflictException('يجب فتح وردية قبل إنشاء فاتورة بيع');
      return null;
    }
    if (live.status === 'closing_requested') throw new ConflictException('الوردية بانتظار موافقة المدير على الإغلاق. لا يمكن تسجيل حركات جديدة.');
    if (live.warehouseId !== warehouseId) {
      if (sellerBound) throw new ConflictException('الوردية المفتوحة تخص مستودعاً آخر.');
      return null;
    }
    return live.id;
  }

  /** Appends one operational fact to the shift timeline. Never an accounting entry. */
  async recordActivity(tx: any, input: {
    shiftId: string; type: string; actorUserId: string; description: string;
    referenceNumber?: string | null; amountUsd?: string | number | null;
    salesInvoiceId?: string | null; returnInvoiceId?: string | null; metadata?: Record<string, unknown>;
  }) {
    await tx.insert(shiftActivities).values({
      shiftId: input.shiftId, type: input.type, actorUserId: input.actorUserId, description: input.description,
      referenceNumber: input.referenceNumber ?? null,
      amountUsd: input.amountUsd === undefined || input.amountUsd === null ? null : String(input.amountUsd),
      salesInvoiceId: input.salesInvoiceId ?? null, returnInvoiceId: input.returnInvoiceId ?? null,
      metadata: input.metadata ?? {},
    });
  }

  // ---------------------------------------------------------------- lifecycle

  async open(user: AuthIdentity, input: Record<string, unknown>) {
    if (!user.permissions.includes('shifts.open')) throw new ForbiddenException('Permission denied.');
    const idempotencyKey = this.id(input.idempotencyKey, 'idempotencyKey');
    const openingUsd = money(input.openingCustodyUSD ?? '0');
    const openingSyp = money(input.openingCustodySYP ?? '0', 2);
    const note = this.optional(input.note, 1000);

    // A retried click must return the shift it already opened, never open a second one.
    const existing = (await this.db.select().from(shifts).where(eq(shifts.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (existing) return this.detail(user, existing.id);

    // The warehouse comes from the user's own scope, never from the request body.
    const warehouseId = this.warehouseForSeller(user, input.warehouseId);

    let shiftId: string;
    try {
      shiftId = await this.db.transaction(async tx => {
        const live = await this.liveShiftFor(tx, user.id);
        if (live) throw new ConflictException('لديك وردية مفتوحة بالفعل. أغلقها قبل فتح وردية جديدة.');
        const { sequence, number } = await this.numbers.next(tx, 'shift');
        const created = (await tx.insert(shifts).values({
          shiftNumber: number, shiftYear: new Date().getUTCFullYear(), sequenceNumber: sequence,
          sellerUserId: user.id, warehouseId, status: 'open', openedByUserId: user.id,
          openingCustodyUsd: openingUsd, openingCustodySyp: openingSyp, sellerNote: note, idempotencyKey,
        }).returning())[0]!;
        await this.recordActivity(tx, {
          shiftId: created.id, type: 'shift.opened', actorUserId: user.id,
          description: `فتح الوردية ${created.shiftNumber}`, referenceNumber: created.shiftNumber,
          metadata: { openingCustodyUsd: openingUsd, openingCustodySyp: openingSyp },
        });
        await this.audit.record({ actorUserId: user.id, action: 'shifts.open', module: 'shifts', entityId: created.id, warehouseId, metadata: { shiftNumber: created.shiftNumber, openingCustodyUsd: openingUsd, openingCustodySyp: openingSyp } }, tx);
        return created.id;
      });
    } catch (error: any) {
      // The partial unique index is the real guarantee; this only turns it into a clear message.
      if (error?.code === '23505' || error?.cause?.code === '23505') {
        const duplicate = (await this.db.select().from(shifts).where(eq(shifts.idempotencyKey, idempotencyKey)).limit(1))[0];
        if (duplicate) return this.detail(user, duplicate.id);
        throw new ConflictException('لديك وردية مفتوحة بالفعل. أغلقها قبل فتح وردية جديدة.');
      }
      throw error;
    }
    const result = await this.detail(user, shiftId);
    this.announce(result.warehouseId, 'shift.opened', { id: shiftId, warehouseId: result.warehouseId, sellerId: user.id });
    return result;
  }

  /** The caller's own live shift — what the seller's sales screen shows in its header. */
  async current(user: AuthIdentity) {
    const row = (await this.db.select().from(shifts).where(and(eq(shifts.sellerUserId, user.id), inArray(shifts.status, [...LIVE]))).limit(1))[0];
    if (!row) return { shift: null, canOpen: user.permissions.includes('shifts.open') };
    return { shift: await this.detail(user, row.id), canOpen: false };
  }

  async requestClose(user: AuthIdentity, shiftId: string, input: Record<string, unknown>) {
    if (!user.permissions.includes('shifts.close.request')) throw new ForbiddenException('Permission denied.');
    shiftId = this.id(shiftId, 'shiftId');
    const actualUsd = money(input.actualUSD ?? '0');
    const actualSyp = money(input.actualSYP ?? '0', 2);
    const note = this.optional(input.note, 1000);

    const warehouseId = await this.db.transaction(async tx => {
      const shift = (await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1).for('update'))[0];
      if (!shift) throw new NotFoundException('الوردية غير موجودة.');
      this.assertAccess(user, shift);
      if (shift.sellerUserId !== user.id && !user.permissions.includes('shifts.manage')) throw new ForbiddenException('لا يمكنك طلب إغلاق وردية بائع آخر.');
      if (shift.status === 'closing_requested') throw new ConflictException('طلب الإغلاق مُرسل بالفعل وبانتظار المدير.');
      if (shift.status !== 'open') throw new ConflictException('لا يمكن طلب إغلاق وردية مغلقة.');

      // Expected is computed from the documents, never from anything the browser sends.
      const totals = await this.totals.forShift(shift.id);
      const { expectedUsd, expectedSyp } = this.totals.expected(Number(shift.openingCustodyUsd), Number(shift.openingCustodySyp), totals);
      const differenceUsd = Number((Number(actualUsd) - expectedUsd).toFixed(4));
      const differenceSyp = Number((Number(actualSyp) - expectedSyp).toFixed(2));
      // A gap between the drawer and the documents must be explained by the person holding it.
      if ((differenceUsd !== 0 || differenceSyp !== 0) && !note) throw new ConflictException('يجب كتابة ملاحظة توضّح سبب الفرق قبل طلب الإغلاق.');

      const updated = (await tx.update(shifts).set({
        status: 'closing_requested', closingRequestedAt: new Date(),
        expectedUsd: expectedUsd.toFixed(4), expectedSyp: expectedSyp.toFixed(2),
        actualUsd, actualSyp, differenceUsd: differenceUsd.toFixed(4), differenceSyp: differenceSyp.toFixed(2),
        sellerNote: note ?? shift.sellerNote, updatedAt: new Date(), version: sql`${shifts.version} + 1`,
      }).where(and(eq(shifts.id, shiftId), eq(shifts.status, 'open'), eq(shifts.version, shift.version))).returning())[0];
      if (!updated) throw new ConflictException('تغيّرت حالة الوردية أثناء الحفظ. أعد المحاولة.');

      await this.recordActivity(tx, {
        shiftId, type: 'shift.closing_requested', actorUserId: user.id,
        description: `طلب إغلاق الوردية ${shift.shiftNumber}`, referenceNumber: shift.shiftNumber,
        metadata: { expectedUsd, expectedSyp, actualUsd, actualSyp, differenceUsd, differenceSyp },
      });
      await this.audit.record({ actorUserId: user.id, action: 'shifts.closing.request', module: 'shifts', entityId: shiftId, warehouseId: shift.warehouseId, metadata: { shiftNumber: shift.shiftNumber, expectedUsd, expectedSyp, actualUsd, actualSyp, differenceUsd, differenceSyp, note } }, tx);
      return shift.warehouseId;
    });
    const result = await this.detail(user, shiftId);
    // The manager's notification carries enough to judge urgency without opening the shift.
    this.announce(warehouseId, 'shift.closing_requested', {
      id: shiftId, warehouseId, sellerId: result.sellerId, sellerName: result.sellerName, shiftNumber: result.shiftNumber,
      expectedUSD: result.expectedUSD, expectedSYP: result.expectedSYP, actualUSD: result.actualUSD, actualSYP: result.actualSYP,
      differenceUSD: result.differenceUSD, differenceSYP: result.differenceSYP, requestedAt: result.closingRequestedAt,
    });
    return result;
  }

  async approveClose(user: AuthIdentity, shiftId: string, input: Record<string, unknown>) {
    if (!user.permissions.includes('shifts.approve')) throw new ForbiddenException('Permission denied.');
    shiftId = this.id(shiftId, 'shiftId');
    const managerNote = this.optional(input.managerNote, 1000);

    const warehouseId = await this.db.transaction(async tx => {
      const shift = (await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1).for('update'))[0];
      if (!shift) throw new NotFoundException('الوردية غير موجودة.');
      this.assertAccess(user, shift);
      if (shift.sellerUserId === user.id && !user.permissions.includes('shifts.manage')) throw new ForbiddenException('لا يمكنك اعتماد إغلاق ورديتك بنفسك.');
      if (shift.status === 'closed') throw new ConflictException('الوردية معتمدة ومغلقة بالفعل.');
      if (shift.status !== 'closing_requested') throw new ConflictException('لا يوجد طلب إغلاق لهذه الوردية.');

      // The snapshot freezes the shift. Later documents can never change a closed shift's numbers.
      const totals = await this.totals.forShift(shift.id);
      const snapshot = {
        closedAt: new Date().toISOString(),
        invoiceCount: totals.invoiceCount, salesTotalUsd: totals.salesGrossUsd, itemCount: totals.itemCount,
        returnCount: totals.returnCount, returnsTotalUsd: totals.returnsTotalUsd,
        cashReceivedUsd: totals.cashReceivedUsd, cashReceivedSyp: totals.cashReceivedSyp,
        cashRefundedUsd: totals.cashRefundedUsd, cashRefundedSyp: totals.cashRefundedSyp,
        creditInvoiceCount: totals.creditInvoiceCount, creditCreatedUsd: totals.creditCreatedUsd, outstandingUsd: totals.outstandingUsd,
        openingCustodyUsd: Number(shift.openingCustodyUsd), openingCustodySyp: Number(shift.openingCustodySyp),
        expectedUsd: Number(shift.expectedUsd ?? 0), expectedSyp: Number(shift.expectedSyp ?? 0),
        actualUsd: Number(shift.actualUsd ?? 0), actualSyp: Number(shift.actualSyp ?? 0),
        differenceUsd: Number(shift.differenceUsd ?? 0), differenceSyp: Number(shift.differenceSyp ?? 0),
        soldWeightByKarat: totals.soldWeightByKarat, exchangeGoldByKarat: totals.exchangeGoldByKarat,
        manualSaleLineCount: totals.manualSaleLineCount,
      };
      const now = new Date();
      const updated = (await tx.update(shifts).set({
        status: 'closed', closedAt: now, closedByUserId: shift.sellerUserId,
        approvedByUserId: user.id, approvedAt: now, managerNote, closureSnapshot: snapshot,
        updatedAt: now, version: sql`${shifts.version} + 1`,
      }).where(and(eq(shifts.id, shiftId), eq(shifts.status, 'closing_requested'), eq(shifts.version, shift.version))).returning())[0];
      if (!updated) throw new ConflictException('تمت معالجة هذه الوردية بالفعل.');

      await this.recordActivity(tx, {
        shiftId, type: 'shift.closed', actorUserId: user.id,
        description: `اعتماد إغلاق الوردية ${shift.shiftNumber}`, referenceNumber: shift.shiftNumber,
        metadata: { differenceUsd: snapshot.differenceUsd, differenceSyp: snapshot.differenceSyp, managerNote },
      });
      await this.audit.record({ actorUserId: user.id, action: 'shifts.closing.approve', module: 'shifts', entityId: shiftId, warehouseId: shift.warehouseId, metadata: { shiftNumber: shift.shiftNumber, ...snapshot, managerNote } }, tx);
      return shift.warehouseId;
    });
    const result = await this.detail(user, shiftId);
    this.announce(warehouseId, 'shift.closed', { id: shiftId, warehouseId, sellerId: result.sellerId });
    return result;
  }

  async rejectClose(user: AuthIdentity, shiftId: string, input: Record<string, unknown>) {
    if (!user.permissions.includes('shifts.approve')) throw new ForbiddenException('Permission denied.');
    shiftId = this.id(shiftId, 'shiftId');
    const managerNote = this.optional(input.managerNote, 1000);
    if (!managerNote) throw new ConflictException('يجب كتابة سبب رفض طلب الإغلاق.');

    const warehouseId = await this.db.transaction(async tx => {
      const shift = (await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1).for('update'))[0];
      if (!shift) throw new NotFoundException('الوردية غير موجودة.');
      this.assertAccess(user, shift);
      if (shift.status === 'closed') throw new ConflictException('لا يمكن إعادة فتح وردية معتمدة. أنشئ وردية جديدة أو حركة تصحيحية.');
      if (shift.status !== 'closing_requested') throw new ConflictException('لا يوجد طلب إغلاق لهذه الوردية.');

      // Back to open: the seller can trade again, and the handover figures are cleared so the
      // next request recomputes them from the documents as they stand then.
      const updated = (await tx.update(shifts).set({
        status: 'open', closingRequestedAt: null,
        expectedUsd: null, expectedSyp: null, actualUsd: null, actualSyp: null, differenceUsd: null, differenceSyp: null,
        managerNote, updatedAt: new Date(), version: sql`${shifts.version} + 1`,
      }).where(and(eq(shifts.id, shiftId), eq(shifts.status, 'closing_requested'), eq(shifts.version, shift.version))).returning())[0];
      if (!updated) throw new ConflictException('تمت معالجة هذه الوردية بالفعل.');

      await this.recordActivity(tx, { shiftId, type: 'shift.closing_rejected', actorUserId: user.id, description: `رفض طلب إغلاق الوردية ${shift.shiftNumber}`, referenceNumber: shift.shiftNumber, metadata: { managerNote } });
      await this.audit.record({ actorUserId: user.id, action: 'shifts.closing.reject', module: 'shifts', entityId: shiftId, warehouseId: shift.warehouseId, metadata: { shiftNumber: shift.shiftNumber, managerNote } }, tx);
      return shift.warehouseId;
    });
    const result = await this.detail(user, shiftId);
    this.announce(warehouseId, 'shift.updated', { id: shiftId, warehouseId, sellerId: result.sellerId });
    return result;
  }

  // ---------------------------------------------------------------- reads

  async list(user: AuthIdentity, query: Record<string, unknown>) {
    const conditions = this.scopeConditions(user);
    if (typeof query.status === 'string' && ['open', 'closing_requested', 'closed', 'cancelled'].includes(query.status)) conditions.push(eq(shifts.status, query.status as any));
    else if (query.live === 'true') conditions.push(inArray(shifts.status, [...LIVE]));
    if (query.warehouseId) { const warehouseId = this.id(query.warehouseId, 'warehouseId'); this.authorization.assertWarehouse(user, warehouseId); conditions.push(eq(shifts.warehouseId, warehouseId)); }
    if (query.sellerId) conditions.push(eq(shifts.sellerUserId, this.id(query.sellerId, 'sellerId')));
    if (typeof query.dateFrom === 'string' && !Number.isNaN(Date.parse(query.dateFrom))) conditions.push(gte(shifts.openedAt, new Date(query.dateFrom)));
    if (typeof query.dateTo === 'string' && !Number.isNaN(Date.parse(query.dateTo))) conditions.push(lte(shifts.openedAt, new Date(`${query.dateTo}T23:59:59.999Z`)));
    if (query.hasDifference === 'true') conditions.push(or(ne(shifts.differenceUsd, '0'), ne(shifts.differenceSyp, '0'))!);
    if (query.approvedBy) conditions.push(eq(shifts.approvedByUserId, this.id(query.approvedBy, 'approvedBy')));

    const limit = Math.min(Number(query.limit ?? 50) || 50, 200);
    const rows = await this.rows(and(...conditions), limit);
    // One aggregation pass for the whole page, never one per card.
    const totals = await this.totals.forShifts(rows.map(row => row.shift.id));
    return { items: rows.map(row => this.summary(row, totals.get(row.shift.id))) };
  }

  async detail(user: AuthIdentity, shiftId: string) {
    shiftId = this.id(shiftId, 'shiftId');
    const row = (await this.rows(eq(shifts.id, shiftId), 1))[0];
    if (!row) throw new NotFoundException('الوردية غير موجودة.');
    this.assertAccess(user, row.shift);
    const [totals, timeline, sales, returns] = await Promise.all([
      this.totals.forShift(shiftId),
      this.db.select({ activity: shiftActivities, actorName: users.fullName }).from(shiftActivities)
        .innerJoin(users, eq(users.id, shiftActivities.actorUserId))
        .where(eq(shiftActivities.shiftId, shiftId)).orderBy(desc(shiftActivities.occurredAt), desc(shiftActivities.id)).limit(200),
      this.db.select({ id: salesInvoices.id, invoiceNumber: salesInvoices.invoiceNumber, status: salesInvoices.status, customerName: salesInvoices.customerNameSnapshot, finalTotalUsd: salesInvoices.finalTotalUsd, remainingDebtUsd: salesInvoices.remainingDebtUsd, createdAt: salesInvoices.createdAt })
        .from(salesInvoices).where(eq(salesInvoices.shiftId, shiftId)).orderBy(desc(salesInvoices.createdAt)),
      this.db.select({ id: returnInvoices.id, returnNumber: returnInvoices.returnNumber, status: returnInvoices.status, partnerName: returnInvoices.partnerNameSnapshot, finalTotalUsd: returnInvoices.finalTotalUsd, createdAt: returnInvoices.createdAt })
        .from(returnInvoices).where(eq(returnInvoices.shiftId, shiftId)).orderBy(desc(returnInvoices.createdAt)),
    ]);
    const summary = this.summary(row, totals);
    return {
      ...summary,
      timeline: timeline.map(entry => ({
        id: entry.activity.id, type: entry.activity.type, occurredAt: entry.activity.occurredAt.toISOString(),
        actor: entry.actorName, description: entry.activity.description, referenceNumber: entry.activity.referenceNumber,
        amountUsd: entry.activity.amountUsd === null ? null : Number(entry.activity.amountUsd),
        salesInvoiceId: entry.activity.salesInvoiceId, returnInvoiceId: entry.activity.returnInvoiceId,
        metadata: entry.activity.metadata,
      })),
      sales: sales.map(sale => ({ id: sale.id, invoiceNumber: sale.invoiceNumber, status: sale.status, customerName: sale.customerName, finalTotalUSD: Number(sale.finalTotalUsd), remainingDebtUSD: Number(sale.remainingDebtUsd), createdAt: sale.createdAt.toISOString() })),
      returns: returns.map(entry => ({ id: entry.id, returnNumber: entry.returnNumber, status: entry.status, partnerName: entry.partnerName, finalTotalUSD: Number(entry.finalTotalUsd), createdAt: entry.createdAt.toISOString() })),
    };
  }

  // ---------------------------------------------------------------- internals

  private async rows(where: any, limit: number) {
    const seller = { id: users.id, fullName: users.fullName };
    return this.db.select({ shift: shifts, sellerName: seller.fullName, warehouseName: warehouses.name })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.sellerUserId))
      .innerJoin(warehouses, eq(warehouses.id, shifts.warehouseId))
      .where(where).orderBy(desc(shifts.openedAt), desc(shifts.id)).limit(limit);
  }

  private summary(row: { shift: ShiftRow; sellerName: string; warehouseName: string }, totals?: ShiftTotals) {
    const shift = row.shift;
    // A closed shift always reads from its frozen snapshot; a live one is computed now.
    const snapshot = shift.closureSnapshot as Record<string, any> | null;
    const live = totals ?? undefined;
    const expected = shift.expectedUsd !== null
      ? { expectedUsd: Number(shift.expectedUsd), expectedSyp: Number(shift.expectedSyp ?? 0) }
      : live ? this.totals.expected(Number(shift.openingCustodyUsd), Number(shift.openingCustodySyp), live) : { expectedUsd: Number(shift.openingCustodyUsd), expectedSyp: Number(shift.openingCustodySyp) };
    return {
      id: shift.id, shiftNumber: shift.shiftNumber, status: shift.status,
      sellerId: shift.sellerUserId, sellerName: row.sellerName,
      warehouseId: shift.warehouseId, warehouseName: row.warehouseName,
      openedAt: shift.openedAt.toISOString(),
      closingRequestedAt: shift.closingRequestedAt?.toISOString() ?? null,
      closedAt: shift.closedAt?.toISOString() ?? null,
      approvedAt: shift.approvedAt?.toISOString() ?? null,
      openingCustodyUSD: Number(shift.openingCustodyUsd), openingCustodySYP: Number(shift.openingCustodySyp),
      expectedUSD: expected.expectedUsd, expectedSYP: expected.expectedSyp,
      actualUSD: shift.actualUsd === null ? null : Number(shift.actualUsd),
      actualSYP: shift.actualSyp === null ? null : Number(shift.actualSyp),
      differenceUSD: shift.differenceUsd === null ? null : Number(shift.differenceUsd),
      differenceSYP: shift.differenceSyp === null ? null : Number(shift.differenceSyp),
      sellerNote: shift.sellerNote ?? '', managerNote: shift.managerNote ?? '',
      totals: snapshot ? {
        invoiceCount: snapshot.invoiceCount, salesGrossUsd: snapshot.salesTotalUsd, itemCount: snapshot.itemCount,
        cashReceivedUsd: snapshot.cashReceivedUsd, cashReceivedSyp: snapshot.cashReceivedSyp,
        creditInvoiceCount: snapshot.creditInvoiceCount, creditCreatedUsd: snapshot.creditCreatedUsd, outstandingUsd: snapshot.outstandingUsd,
        returnCount: snapshot.returnCount, returnsTotalUsd: snapshot.returnsTotalUsd,
        cashRefundedUsd: snapshot.cashRefundedUsd, cashRefundedSyp: snapshot.cashRefundedSyp,
        netCashUsd: Number((snapshot.cashReceivedUsd - snapshot.cashRefundedUsd).toFixed(4)),
        netCashSyp: Number((snapshot.cashReceivedSyp - snapshot.cashRefundedSyp).toFixed(2)),
        manualSaleLineCount: snapshot.manualSaleLineCount,
        soldWeightByKarat: snapshot.soldWeightByKarat ?? [], exchangeGoldByKarat: snapshot.exchangeGoldByKarat ?? [],
      } : live,
      isSnapshot: Boolean(snapshot),
    };
  }

  /** Warehouse scope plus the seller's own-only restriction, in one place. */
  private assertAccess(user: AuthIdentity, shift: ShiftRow) {
    this.authorization.assertWarehouse(user, shift.warehouseId);
    if (this.authorization.isOwnDataOnly(user) && shift.sellerUserId !== user.id) throw new ForbiddenException('هذه الوردية تخص بائعاً آخر.');
  }

  private scopeConditions(user: AuthIdentity) {
    const conditions: any[] = [];
    if (this.authorization.isOwnDataOnly(user)) conditions.push(eq(shifts.sellerUserId, user.id));
    const allowed = this.authorization.allowedWarehouseIds(user);
    if (allowed) conditions.push(allowed.length ? inArray(shifts.warehouseId, allowed) : sql`false`);
    return conditions;
  }

  private warehouseForSeller(user: AuthIdentity, requested: unknown) {
    if (this.authorization.isOwnDataOnly(user)) {
      const own = user.warehouses[0];
      if (!own) throw new ConflictException('لا يوجد مستودع مُسند لحسابك.');
      return own.id;
    }
    const warehouseId = requested === undefined || requested === null || requested === '' ? user.warehouses[0]?.id : this.id(requested, 'warehouseId');
    if (!warehouseId) throw new ConflictException('اختر المستودع لفتح الوردية.');
    this.authorization.assertWarehouse(user, warehouseId);
    return warehouseId;
  }

  /** Managers watching this warehouse hear about it; a seller only ever hears their own. */
  private announce(warehouseId: string, event: string, payload: Record<string, unknown>) {
    this.realtime.emitToWarehousePermission(warehouseId, 'shifts.manage', event, payload);
    this.realtime.emitToPermissions(['warehouses.scope.all'], event, payload);
  }

  private id(value: unknown, field: string) { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`); return value; }
  private optional(value: unknown, max: number) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException('الملاحظة غير صالحة.');
    return value.trim();
  }
}
