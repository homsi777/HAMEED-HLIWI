import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import { FinancePostingService } from '../finance/finance-posting.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { appSettings, employees, employeeTransactions, warehouses } from '../database/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const schedules = new Set(['daily', 'weekly', 'monthly']);
const statuses = new Set(['active', 'archived', 'terminated']);
const currencies = new Set(['USD', 'SYP']);

@Injectable()
export class EmployeesService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(AuthorizationScopeService) private readonly scope: AuthorizationScopeService, @Inject(AuditService) private readonly audit: AuditService, @Inject(FinancePostingService) private readonly finance: FinancePostingService) {}

  async list(actor: AuthIdentity, query: Record<string, unknown>) {
    const conditions: any[] = [];
    const allowed = this.scope.allowedWarehouseIds(actor);
    if (allowed !== null) conditions.push(inArray(employees.warehouseId, allowed));
    const status = typeof query.status === 'string' ? query.status : 'active';
    if (statuses.has(status)) conditions.push(eq(employees.status, status as any));
    const search = this.optional(query.search, 120);
    if (search) conditions.push(ilike(employees.fullName, `%${search}%`));
    const rows = await this.db.select({ employee: employees, warehouseName: warehouses.name }).from(employees).innerJoin(warehouses, eq(employees.warehouseId, warehouses.id)).where(conditions.length ? and(...conditions) : undefined).orderBy(asc(employees.fullName));
    const ids = rows.map(row => row.employee.id);
    const sums = ids.length ? await this.db.select({ employeeId: employeeTransactions.employeeId, currency: employeeTransactions.currency, advance: sql<string>`coalesce(sum(case when ${employeeTransactions.type} = 'advance' then ${employeeTransactions.amount} else 0 end), 0)`, paid: sql<string>`coalesce(sum(case when ${employeeTransactions.type} = 'salary_payment' then ${employeeTransactions.amount} else 0 end), 0)` }).from(employeeTransactions).where(inArray(employeeTransactions.employeeId, ids)).groupBy(employeeTransactions.employeeId, employeeTransactions.currency) : [];
    const transactions = ids.length ? await this.db.select().from(employeeTransactions).where(inArray(employeeTransactions.employeeId, ids)) : [];
    return rows.map(row => ({ ...this.present(row.employee, row.warehouseName, sums.filter(sum => sum.employeeId === row.employee.id)), payroll: this.payroll(row.employee, transactions.filter(transaction => transaction.employeeId === row.employee.id)) }));
  }

  async get(actor: AuthIdentity, employeeId: string) {
    const employee = await this.require(actor, employeeId);
    const warehouse = (await this.db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, employee.warehouseId)).limit(1))[0]!;
    const transactions = await this.db.select().from(employeeTransactions).where(eq(employeeTransactions.employeeId, employee.id)).orderBy(desc(employeeTransactions.occurredOn), desc(employeeTransactions.createdAt));
    return { ...this.present(employee, warehouse.name, this.sums(transactions)), payroll: this.payroll(employee, transactions), transactions: transactions.map(row => ({ id: row.id, type: row.type, currency: row.currency, amount: Number(row.amount), exchangeRateSypPerUsd: Number(row.exchangeRateSypPerUsd), occurredOn: row.occurredOn, note: row.note, createdAt: row.createdAt.toISOString() })) };
  }

  async create(actor: AuthIdentity, input: Record<string, unknown>) {
    const values = await this.values(actor, input);
    const created = (await this.db.insert(employees).values({ ...values, createdByUserId: actor.id }).returning())[0]!;
    await this.audit.record({ actorUserId: actor.id, action: 'employees.create', module: 'employees', entityId: created.id, warehouseId: created.warehouseId, metadata: { fullName: created.fullName } });
    return this.get(actor, created.id);
  }

  async update(actor: AuthIdentity, employeeId: string, input: Record<string, unknown>) {
    const current = await this.require(actor, employeeId);
    const values = await this.values(actor, input, current);
    const updated = (await this.db.update(employees).set({ ...values, updatedAt: new Date() }).where(eq(employees.id, current.id)).returning())[0]!;
    await this.audit.record({ actorUserId: actor.id, action: 'employees.update', module: 'employees', entityId: updated.id, warehouseId: updated.warehouseId, metadata: { fullName: updated.fullName } });
    return this.get(actor, updated.id);
  }

  async archive(actor: AuthIdentity, employeeId: string) { return this.changeStatus(actor, employeeId, 'archived'); }
  async terminate(actor: AuthIdentity, employeeId: string) { return this.changeStatus(actor, employeeId, 'terminated'); }

  async transaction(actor: AuthIdentity, employeeId: string, input: Record<string, unknown>) {
    const employee = await this.require(actor, employeeId);
    if (employee.status !== 'active') throw new ConflictException('لا يمكن تسجيل حركة لموظف غير نشط.');
    const type = input.type === 'advance' || input.type === 'salary_payment' ? input.type : null;
    if (!type) throw new ConflictException('نوع الحركة غير صالح.');
    const currency = this.currency(input.currency ?? employee.salaryCurrency);
    const amount = this.amount(input.amount);
    const occurredOn = this.date(input.occurredOn);
    const idempotencyKey = this.id(input.idempotencyKey, 'idempotencyKey');
    const existing = (await this.db.select({ id: employeeTransactions.id }).from(employeeTransactions).where(eq(employeeTransactions.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (!existing) {
      const settings = (await this.db.select({ rate: appSettings.usdToSypRate }).from(appSettings).limit(1))[0];
      if (!settings || Number(settings.rate) <= 0) throw new ConflictException('سعر الصرف غير مضبوط في الإعدادات.');
      const cashboxId = typeof input.cashboxId === 'string' && input.cashboxId ? this.id(input.cashboxId, 'cashboxId') : undefined;
      await this.db.transaction(async tx => {
        const voucher = await this.finance.postVoucher(tx, actor, { type: 'expense', sourceType: 'expense', sourceDocumentNumber: `EMP-${employee.id.slice(0, 8)}`, warehouseId: employee.warehouseId, cashboxId, currency, amount, exchangeRateSypPerUsd: String(settings.rate), expenseCategory: type === 'advance' ? 'سلف موظفين' : 'رواتب موظفين', systemNote: `${type === 'advance' ? 'سلفة' : 'تسليم راتب'} للموظف ${employee.fullName}`, userNote: this.optional(input.note, 1000), idempotencyKey: `employee-voucher:${idempotencyKey}` });
        await tx.insert(employeeTransactions).values({ employeeId: employee.id, type, currency, amount, exchangeRateSypPerUsd: settings.rate, voucherId: voucher.id, occurredOn, note: this.optional(input.note, 1000), idempotencyKey, createdByUserId: actor.id });
      });
      await this.audit.record({ actorUserId: actor.id, action: `employees.${type}`, module: 'employees', entityId: employee.id, warehouseId: employee.warehouseId, metadata: { amount, currency, occurredOn } });
    }
    return this.get(actor, employee.id);
  }

  private async changeStatus(actor: AuthIdentity, employeeId: string, status: 'archived' | 'terminated') {
    const employee = await this.require(actor, employeeId);
    const stamp = new Date();
    await this.db.update(employees).set({ status, archivedAt: status === 'archived' ? stamp : employee.archivedAt, endedAt: status === 'terminated' ? stamp : employee.endedAt, updatedAt: stamp }).where(eq(employees.id, employee.id));
    await this.audit.record({ actorUserId: actor.id, action: `employees.${status}`, module: 'employees', entityId: employee.id, warehouseId: employee.warehouseId, metadata: { fullName: employee.fullName } });
    return this.get(actor, employee.id);
  }

  private async require(actor: AuthIdentity, raw: string) {
    const employeeId = this.id(raw, 'employeeId');
    const employee = (await this.db.select().from(employees).where(eq(employees.id, employeeId)).limit(1))[0];
    if (!employee) throw new NotFoundException('الموظف غير موجود.');
    this.scope.assertWarehouse(actor, employee.warehouseId);
    return employee;
  }

  private async values(actor: AuthIdentity, input: Record<string, unknown>, current?: typeof employees.$inferSelect) {
    const warehouseId = input.warehouseId === undefined && current ? current.warehouseId : this.id(input.warehouseId, 'warehouseId');
    this.scope.assertWarehouse(actor, warehouseId);
    const warehouse = (await this.db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1))[0];
    if (!warehouse) throw new ConflictException('المستودع غير موجود.');
    const photoDataUrl = input.photoDataUrl === undefined && current ? current.photoDataUrl : this.photo(input.photoDataUrl);
    return {
      fullName: input.fullName === undefined && current ? current.fullName : this.text(input.fullName, 'fullName', 160),
      phone: input.phone === undefined && current ? current.phone : this.optional(input.phone, 50), warehouseId,
      schedule: input.schedule === undefined && current ? current.schedule : this.schedule(input.schedule),
      salaryCurrency: input.salaryCurrency === undefined && current ? current.salaryCurrency : this.currency(input.salaryCurrency),
      salaryAmount: input.salaryAmount === undefined && current ? current.salaryAmount : this.amount(input.salaryAmount), photoDataUrl,
      notes: input.notes === undefined && current ? current.notes : this.optional(input.notes, 2000),
    };
  }

  private present(employee: typeof employees.$inferSelect, warehouseName: string, sums: Array<{ currency: string; advance: string; paid: string }>) {
    const totals = Object.fromEntries(sums.map(row => [row.currency, { advances: Number(row.advance), salaryPayments: Number(row.paid) }]));
    return { id: employee.id, fullName: employee.fullName, phone: employee.phone, warehouseId: employee.warehouseId, warehouseName, schedule: employee.schedule, salaryCurrency: employee.salaryCurrency, salaryAmount: Number(employee.salaryAmount), photoDataUrl: employee.photoDataUrl, notes: employee.notes, status: employee.status, archivedAt: employee.archivedAt?.toISOString() ?? null, endedAt: employee.endedAt?.toISOString() ?? null, totals };
  }
  private payroll(employee: typeof employees.$inferSelect, rows: Array<typeof employeeTransactions.$inferSelect>) {
    const today = new Date().toISOString().slice(0, 10); const period = this.period(employee.schedule, today);
    const current = rows.filter(row => row.occurredOn >= period.from && row.occurredOn <= period.to);
    const converted = (row: typeof employeeTransactions.$inferSelect) => employee.salaryCurrency === row.currency ? Number(row.amount) : employee.salaryCurrency === 'USD' ? Number(row.amount) / Number(row.exchangeRateSypPerUsd) : Number(row.amount) * Number(row.exchangeRateSypPerUsd);
    const advances = current.filter(row => row.type === 'advance').reduce((sum, row) => sum + converted(row), 0);
    const salaryPayments = current.filter(row => row.type === 'salary_payment').reduce((sum, row) => sum + converted(row), 0);
    const salary = Number(employee.salaryAmount); const remaining = Number((salary - advances - salaryPayments).toFixed(4));
    return { from: period.from, to: period.to, salary, advances: Number(advances.toFixed(4)), salaryPayments: Number(salaryPayments.toFixed(4)), remaining, currency: employee.salaryCurrency };
  }
  private period(schedule: 'daily' | 'weekly' | 'monthly', today: string) { const date = new Date(`${today}T12:00:00Z`); if (schedule === 'daily') return { from: today, to: today }; if (schedule === 'monthly') { const prefix = today.slice(0, 7); return { from: `${prefix}-01`, to: `${prefix}-${new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate().toString().padStart(2, '0')}` }; } const day = (date.getUTCDay() + 6) % 7; const from = new Date(date); from.setUTCDate(date.getUTCDate() - day); const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; }
  private sums(rows: Array<typeof employeeTransactions.$inferSelect>) { return Object.values(rows.reduce((all: Record<string, { currency: string; advance: string; paid: string }>, row) => { const value = all[row.currency] ?? { currency: row.currency, advance: '0', paid: '0' }; value[row.type === 'advance' ? 'advance' : 'paid'] = String(Number(value[row.type === 'advance' ? 'advance' : 'paid']) + Number(row.amount)); all[row.currency] = value; return all; }, {})); }
  private id(value: unknown, field: string) { if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} غير صالح.`); return value; }
  private text(value: unknown, field: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} غير صالح.`); return value.trim(); }
  private optional(value: unknown, max: number) { if (value === undefined || value === null || value === '') return null; return this.text(value, 'value', max); }
  private schedule(value: unknown) { if (typeof value !== 'string' || !schedules.has(value)) throw new ConflictException('نوع الدوام غير صالح.'); return value as 'daily' | 'weekly' | 'monthly'; }
  private currency(value: unknown) { if (typeof value !== 'string' || !currencies.has(value)) throw new ConflictException('العملة غير صالحة.'); return value as 'USD' | 'SYP'; }
  private amount(value: unknown) { const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''; if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) < 0 || !Number.isFinite(Number(raw))) throw new ConflictException('المبلغ غير صالح.'); return Number(raw).toFixed(4); }
  private date(value: unknown) { const raw = typeof value === 'string' ? value : new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ConflictException('التاريخ غير صالح.'); return raw; }
  private photo(value: unknown) { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/i.test(value) || value.length > 1_500_000) throw new ConflictException('صورة الموظف غير صالحة أو كبيرة جداً.'); return value; }
}
