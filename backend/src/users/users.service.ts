import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import {
  ALL_PERMISSION_CODES, GLOBAL_SCOPE_PERMISSION, OWN_SCOPE_PERMISSION, ROLE_PRESETS,
  SYSTEM_ADMIN_ROLE, visibleModules, type DataScope,
} from '../authorization/authorization.constants.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { authSessions, permissions, rolePermissions, roles, userRoles, userWarehouses, users, warehouses } from '../database/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME = /^[\p{L}\p{M}\p{N}_.-]{3,80}$/u;
const PERMISSION_SET = new Set<string>(ALL_PERMISSION_CODES);

export interface UserSummary {
  id: string; username: string; fullName: string; isActive: boolean;
  roles: Array<{ name: string; displayName: string; isSystem: boolean }>;
  permissions: string[];
  scope: DataScope;
  modules: string[];
  warehouses: Array<{ id: string; name: string; isManager: boolean }>;
  createdAt: string; updatedAt: string;
}

/**
 * Server-authoritative user administration. Every mutation re-derives the target's resulting
 * scope from the database and checks it against the actor's own scope before writing, so a
 * crafted request cannot create an account wider than the account creating it.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  // ---------------------------------------------------------------- catalogues

  async catalog(actor: AuthIdentity) {
    const actorIsGlobal = this.authorization.canAccessAll(actor);
    const allowedWarehouses = await this.warehouseChoices(actor);
    return {
      // `system_admin` stays in the database as an internal technical role but is never
      // offered as a business preset, so nobody creates a second technical account by habit.
      presets: ROLE_PRESETS.filter(preset => actorIsGlobal || preset.scope !== 'global')
        .map(preset => ({ name: preset.name, displayName: preset.displayName, description: preset.description, scope: preset.scope, warehouseSelection: preset.warehouseSelection, permissions: preset.permissions })),
      permissions: [...ALL_PERMISSION_CODES],
      warehouses: allowedWarehouses,
      actor: { id: actor.id, scope: this.authorization.scopeType(actor), canGrantGlobal: actorIsGlobal },
    };
  }

  // ---------------------------------------------------------------- reads

  async list(actor: AuthIdentity) {
    const all = await this.load();
    // A warehouse manager sees the staff of the warehouses they run, plus themselves.
    if (this.authorization.canAccessAll(actor)) return all;
    const allowed = new Set(this.authorization.allowedWarehouseIds(actor) ?? []);
    return all.filter(user => user.id === actor.id || (user.scope !== 'global' && user.warehouses.length > 0 && user.warehouses.every(warehouse => allowed.has(warehouse.id))));
  }

  async get(actor: AuthIdentity, userId: string) {
    const user = await this.require(this.id(userId, 'userId'));
    if (user.id !== actor.id) this.authorization.assertCanManageUser(actor, { isGlobal: user.scope === 'global', warehouseIds: user.warehouses.map(warehouse => warehouse.id) });
    return user;
  }

  // ---------------------------------------------------------------- writes

  async create(actor: AuthIdentity, input: Record<string, unknown>) {
    const username = this.username(input.username);
    const fullName = this.text(input.fullName, 'fullName', 160);
    const password = this.password(input.password);
    const preset = this.preset(input.roleName);
    const warehouseIds = await this.warehouseIds(actor, preset.warehouseSelection, input.warehouseIds);
    const extraPermissions = this.extraPermissions(input.permissions, preset.permissions);
    this.authorization.assertCanManageUser(actor, { isGlobal: preset.scope === 'global', warehouseIds });

    const duplicate = (await this.db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${username}`).limit(1))[0];
    if (duplicate) throw new ConflictException('اسم المستخدم مستخدم بالفعل.');

    const role = await this.roleRow(preset.name);
    const createdId = await this.db.transaction(async tx => {
      const created = (await tx.insert(users).values({ username, fullName, passwordHash: await bcrypt.hash(password, 12), isActive: input.isActive === false ? false : true }).returning())[0]!;
      await tx.insert(userRoles).values({ userId: created.id, roleId: role.id });
      if (warehouseIds.length) await tx.insert(userWarehouses).values(warehouseIds.map(warehouseId => ({ userId: created.id, warehouseId, isManager: preset.scope === 'warehouses' })));
      if (extraPermissions.length) await this.applyPermissionOverrides(tx, created.id, extraPermissions);
      await this.audit.record({ actorUserId: actor.id, action: 'users.create', module: 'users', entityId: created.id, metadata: { username, roleName: preset.name, scope: preset.scope, warehouseIds, extraPermissions } }, tx);
      return created.id;
    });
    return this.require(createdId);
  }

  async update(actor: AuthIdentity, userId: string, input: Record<string, unknown>) {
    const target = await this.get(actor, userId);
    const fullName = input.fullName === undefined ? undefined : this.text(input.fullName, 'fullName', 160);
    const preset = input.roleName === undefined ? undefined : this.preset(input.roleName);
    const nextScope = preset?.scope ?? target.scope;
    const nextWarehouseIds = input.warehouseIds === undefined && !preset
      ? target.warehouses.map(warehouse => warehouse.id)
      : await this.warehouseIds(actor, (preset ?? this.presetForScope(target.scope)).warehouseSelection, input.warehouseIds ?? target.warehouses.map(warehouse => warehouse.id));
    if (preset || input.warehouseIds !== undefined) this.authorization.assertCanManageUser(actor, { isGlobal: nextScope === 'global', warehouseIds: nextWarehouseIds });
    const extraPermissions = input.permissions === undefined ? undefined : this.extraPermissions(input.permissions, (preset ?? this.presetForScope(target.scope)).permissions);

    // Losing the last company-wide account, or demoting yourself, would lock the system.
    if (target.scope === 'global' && nextScope !== 'global') await this.assertNotLastGlobalManager(target.id);
    if (target.id === actor.id && preset && nextScope !== target.scope) throw new ConflictException('لا يمكنك تغيير دور حسابك بنفسك.');

    const securitySensitive = Boolean(preset) || input.warehouseIds !== undefined || extraPermissions !== undefined;
    await this.db.transaction(async tx => {
      if (fullName !== undefined) await tx.update(users).set({ fullName, updatedAt: new Date() }).where(eq(users.id, target.id));
      if (preset) {
        const role = await this.roleRow(preset.name);
        await tx.delete(userRoles).where(eq(userRoles.userId, target.id));
        await tx.insert(userRoles).values({ userId: target.id, roleId: role.id });
        await this.audit.record({ actorUserId: actor.id, action: 'users.role.change', module: 'users', entityId: target.id, metadata: { from: target.roles.map(role => role.name), to: preset.name, scope: preset.scope } }, tx);
      }
      if (preset || input.warehouseIds !== undefined) {
        await tx.delete(userWarehouses).where(eq(userWarehouses.userId, target.id));
        if (nextScope !== 'global' && nextWarehouseIds.length) await tx.insert(userWarehouses).values(nextWarehouseIds.map(warehouseId => ({ userId: target.id, warehouseId, isManager: nextScope === 'warehouses' })));
        await this.audit.record({ actorUserId: actor.id, action: 'users.warehouse.change', module: 'users', entityId: target.id, metadata: { from: target.warehouses.map(warehouse => warehouse.id), to: nextScope === 'global' ? [] : nextWarehouseIds } }, tx);
      }
      if (extraPermissions !== undefined) {
        await this.applyPermissionOverrides(tx, target.id, extraPermissions, true);
        await this.audit.record({ actorUserId: actor.id, action: 'users.permission.change', module: 'users', entityId: target.id, metadata: { extraPermissions } }, tx);
      }
      if (fullName !== undefined && !securitySensitive) await this.audit.record({ actorUserId: actor.id, action: 'users.update', module: 'users', entityId: target.id, metadata: { fullName } }, tx);
    });
    // Any change to what an account may reach must not wait for a token to expire.
    if (securitySensitive) await this.auth.revokeAllSessions(target.id);
    return this.require(target.id);
  }

  async setStatus(actor: AuthIdentity, userId: string, input: Record<string, unknown>) {
    const target = await this.get(actor, userId);
    if (typeof input.isActive !== 'boolean') throw new ConflictException('isActive is invalid.');
    if (target.id === actor.id) throw new ConflictException('لا يمكنك تعطيل حسابك بنفسك.');
    if (!input.isActive && target.scope === 'global') await this.assertNotLastGlobalManager(target.id);
    if (target.isActive === input.isActive) return target;
    await this.db.update(users).set({ isActive: input.isActive, updatedAt: new Date() }).where(eq(users.id, target.id));
    // History stays intact: the account is only closed, never removed.
    if (!input.isActive) await this.auth.revokeAllSessions(target.id);
    await this.audit.record({ actorUserId: actor.id, action: input.isActive ? 'users.reactivate' : 'users.disable', module: 'users', entityId: target.id, metadata: { username: target.username } });
    return this.require(target.id);
  }

  async resetPassword(actor: AuthIdentity, userId: string, input: Record<string, unknown>) {
    const target = await this.get(actor, userId);
    const password = this.password(input.password);
    await this.db.update(users).set({ passwordHash: await bcrypt.hash(password, 12), updatedAt: new Date() }).where(eq(users.id, target.id));
    await this.auth.revokeAllSessions(target.id);
    // The audit trail records that a reset happened, never the secret itself.
    await this.audit.record({ actorUserId: actor.id, action: 'users.password.reset', module: 'users', entityId: target.id, metadata: { username: target.username } });
    return { id: target.id, username: target.username, passwordReset: true };
  }

  // ---------------------------------------------------------------- internals

  private async load(userId?: string): Promise<UserSummary[]> {
    const where = userId ? eq(users.id, userId) : undefined;
    const rows = await this.db.select().from(users).where(where).orderBy(asc(users.fullName));
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const [roleRows, permissionRows, warehouseRows] = await Promise.all([
      this.db.select({ userId: userRoles.userId, name: roles.name, displayName: roles.displayName, isSystem: roles.isSystem }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(inArray(userRoles.userId, ids)),
      this.db.select({ userId: userRoles.userId, code: permissions.code }).from(userRoles).innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId)).innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id)).where(inArray(userRoles.userId, ids)),
      this.db.select({ userId: userWarehouses.userId, id: warehouses.id, name: warehouses.name, isManager: userWarehouses.isManager }).from(userWarehouses).innerJoin(warehouses, eq(userWarehouses.warehouseId, warehouses.id)).where(inArray(userWarehouses.userId, ids)),
    ]);
    return rows.map(row => {
      const held = [...new Set(permissionRows.filter(value => value.userId === row.id).map(value => value.code))];
      const identity = { permissions: held } as AuthIdentity;
      return {
        id: row.id, username: row.username, fullName: row.fullName, isActive: row.isActive,
        roles: roleRows.filter(value => value.userId === row.id).map(({ name, displayName, isSystem }) => ({ name, displayName, isSystem })),
        permissions: held,
        scope: this.authorization.scopeType(identity),
        modules: visibleModules(held),
        warehouses: warehouseRows.filter(value => value.userId === row.id).map(({ id, name, isManager }) => ({ id, name, isManager })),
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async require(userId: string) {
    const rows = await this.load(userId);
    if (!rows[0]) throw new NotFoundException('User not found.');
    return rows[0];
  }

  /**
   * Per-user permission overrides are stored as a private single-user role, so the shared
   * preset roles are never mutated for one person.
   */
  private async applyPermissionOverrides(tx: any, userId: string, codes: string[], replace = false) {
    const overrideName = `override:${userId}`;
    const existing = (await tx.select().from(roles).where(eq(roles.name, overrideName)).limit(1))[0]
      ?? (await tx.insert(roles).values({ name: overrideName, displayName: 'صلاحيات إضافية', description: 'صلاحيات إضافية خاصة بمستخدم واحد', isSystem: true }).returning())[0];
    if (replace) await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, existing.id));
    if (!codes.length) { await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, existing.id))); return; }
    const rows = await tx.select({ id: permissions.id }).from(permissions).where(inArray(permissions.code, codes));
    for (const row of rows) await tx.insert(rolePermissions).values({ roleId: existing.id, permissionId: row.id }).onConflictDoNothing();
    await tx.insert(userRoles).values({ userId, roleId: existing.id }).onConflictDoNothing();
  }

  private async assertNotLastGlobalManager(excludedUserId: string) {
    const rows = await this.db.select({ id: users.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(permissions.code, GLOBAL_SCOPE_PERMISSION), eq(users.isActive, true), ne(users.id, excludedUserId))).limit(1);
    if (!rows.length) throw new ConflictException('لا يمكن إزالة آخر حساب بصلاحية على مستوى الشركة.');
  }

  private async warehouseChoices(actor: AuthIdentity) {
    const rows = await this.db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.isActive, true)).orderBy(asc(warehouses.name));
    if (this.authorization.canAccessAll(actor)) return rows;
    const allowed = new Set(this.authorization.allowedWarehouseIds(actor) ?? []);
    return rows.filter(row => allowed.has(row.id));
  }

  private async warehouseIds(actor: AuthIdentity, selection: 'none' | 'single' | 'multiple', value: unknown) {
    // A company-wide account is never mapped to warehouses; its reach is the whole company,
    // including branches that do not exist yet.
    if (selection === 'none') return [];
    if (!Array.isArray(value)) throw new ConflictException('يجب اختيار المستودع.');
    const ids = [...new Set(value.map((entry, index) => this.id(entry, `warehouseIds[${index}]`)))];
    if (!ids.length) throw new ConflictException('يجب اختيار مستودع واحد على الأقل.');
    if (selection === 'single' && ids.length !== 1) throw new ConflictException('البائع يُربط بمستودع واحد فقط.');
    const allowed = await this.warehouseChoices(actor);
    const allowedIds = new Set(allowed.map(row => row.id));
    if (!ids.every(id => allowedIds.has(id))) throw new ForbiddenException('مستودع خارج نطاق صلاحيتك أو غير مفعّل.');
    return ids;
  }

  private preset(value: unknown) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name === SYSTEM_ADMIN_ROLE) throw new ForbiddenException('الدور التقني للنظام لا يُسند من هذه الشاشة.');
    const preset = ROLE_PRESETS.find(entry => entry.name === name);
    if (!preset) throw new ConflictException('الدور المطلوب غير معروف.');
    return preset;
  }

  private presetForScope(scope: DataScope) {
    return ROLE_PRESETS.find(entry => entry.scope === scope) ?? ROLE_PRESETS[ROLE_PRESETS.length - 1]!;
  }

  private async roleRow(name: string) {
    const row = (await this.db.select().from(roles).where(eq(roles.name, name)).limit(1))[0];
    if (!row) throw new ConflictException(`الدور ${name} غير موجود في قاعدة البيانات.`);
    return row;
  }

  private extraPermissions(value: unknown, presetPermissions: string[]) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > ALL_PERMISSION_CODES.length) throw new ConflictException('permissions is invalid.');
    const base = new Set(presetPermissions);
    const codes = [...new Set(value.map(entry => { if (typeof entry !== 'string' || !PERMISSION_SET.has(entry)) throw new ConflictException('صلاحية غير معروفة.'); return entry; }))];
    // Scope is decided by the role, never by a hand-picked checkbox.
    if (codes.includes(GLOBAL_SCOPE_PERMISSION) || codes.includes(OWN_SCOPE_PERMISSION)) throw new ConflictException('نطاق البيانات يُحدَّد بالدور وليس بصلاحية مفردة.');
    return codes.filter(code => !base.has(code));
  }

  private username(value: unknown) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!USERNAME.test(raw)) throw new ConflictException('اسم المستخدم يجب أن يكون 3-80 حرفاً عربياً أو إنكليزياً أو رقماً أو . _ - فقط.');
    return raw;
  }

  private password(value: unknown) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 200) throw new ConflictException('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
    return value;
  }

  private text(value: unknown, field: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConflictException(`${field} is invalid.`);
    return value.trim();
  }

  private id(value: unknown, field: string) {
    if (typeof value !== 'string' || !UUID.test(value)) throw new ConflictException(`${field} is invalid.`);
    return value;
  }
}
