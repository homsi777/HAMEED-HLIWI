import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';

const id = () => uuid('id').defaultRandom().primaryKey();
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(1),
  ...timestamps,
}, table => [uniqueIndex('users_username_unique').on(table.username), index('users_active_idx').on(table.isActive)]);

export const authSessions = pgTable('auth_sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
}, table => [
  uniqueIndex('auth_sessions_refresh_hash_unique').on(table.refreshTokenHash),
  index('auth_sessions_user_active_idx').on(table.userId, table.expiresAt),
  index('auth_sessions_expiry_idx').on(table.expiresAt),
]);

export const roles = pgTable('roles', {
  id: id(),
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
}, table => [uniqueIndex('roles_name_unique').on(table.name)]);

export const permissions = pgTable('permissions', {
  id: id(),
  code: text('code').notNull(),
  description: text('description'),
  ...timestamps,
}, table => [uniqueIndex('permissions_code_unique').on(table.code)]);

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.roleId], name: 'user_roles_pk' }), index('user_roles_role_idx').on(table.roleId)]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.roleId, table.permissionId], name: 'role_permissions_pk' }), index('role_permissions_permission_idx').on(table.permissionId)]);

export const warehouses = pgTable('warehouses', {
  id: id(),
  name: text('name').notNull(),
  location: text('location'),
  phone: text('phone'),
  managerUserId: uuid('manager_user_id').references(() => users.id, { onDelete: 'set null' }),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
}, table => [index('warehouses_active_idx').on(table.isActive), index('warehouses_manager_idx').on(table.managerUserId)]);

export const userWarehouses = pgTable('user_warehouses', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  isManager: boolean('is_manager').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.warehouseId], name: 'user_warehouses_pk' }), index('user_warehouses_warehouse_idx').on(table.warehouseId)]);

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  module: text('module').notNull(),
  entityId: uuid('entity_id'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
  requestId: text('request_id'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('audit_logs_created_idx').on(table.createdAt), index('audit_logs_actor_idx').on(table.actorUserId), index('audit_logs_warehouse_idx').on(table.warehouseId)]);

export type UserRow = typeof users.$inferSelect;
export type WarehouseRow = typeof warehouses.$inferSelect;
