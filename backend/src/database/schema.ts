import { check, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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

export const inventoryStatus = pgEnum('inventory_status', ['in_stock', 'reserved', 'sold']);
export const inventoryMovementType = pgEnum('inventory_movement_type', ['initial', 'transfer']);
export const stocktakeStatus = pgEnum('stocktake_status', ['completed']);
export const partnerType = pgEnum('partner_type', ['customer', 'supplier', 'both']);

export const inventoryItems = pgTable('inventory_items', {
  id: id(), code: text('code').notNull(), name: text('name').notNull(), category: text('category').notNull(), karat: text('karat').notNull(),
  grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(),
  laborFeeUsdPerGram: numeric('labor_fee_usd_per_gram', { precision: 16, scale: 4 }).notNull().default('0'), totalLaborFeeUsd: numeric('total_labor_fee_usd', { precision: 16, scale: 4 }).notNull().default('0'),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), status: inventoryStatus('status').notNull().default('in_stock'), imagePath: text('image_path'), notes: text('notes'), version: integer('version').notNull().default(1), archivedAt: timestamp('archived_at', { withTimezone: true }), archivedByUserId: uuid('archived_by_user_id').references(() => users.id, { onDelete: 'set null' }), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('inventory_items_code_unique').on(table.code), index('inventory_items_warehouse_status_idx').on(table.warehouseId, table.status), index('inventory_items_karat_idx').on(table.karat), index('inventory_items_category_idx').on(table.category), check('inventory_items_karat_check', sql`${table.karat} in ('24','22','21','18','14')`), check('inventory_items_weights_check', sql`${table.grossWeightGrams} > 0 and ${table.stoneWeightGrams} >= 0 and ${table.netWeightGrams} >= 0 and ${table.grossWeightGrams} >= ${table.stoneWeightGrams}`), check('inventory_items_labor_check', sql`${table.laborFeeUsdPerGram} >= 0 and ${table.totalLaborFeeUsd} >= 0`)]);

export const inventoryMovements = pgTable('inventory_movements', { id: id(), inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }), type: inventoryMovementType('type').notNull(), fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }), toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }), actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), note: text('note'), metadata: jsonb('metadata').notNull().default({}), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('inventory_movements_item_created_idx').on(table.inventoryItemId, table.createdAt), index('inventory_movements_warehouse_idx').on(table.toWarehouseId)]);

export const stocktakes = pgTable('stocktakes', { id: id(), warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), status: stocktakeStatus('status').notNull().default('completed'), itemCount: integer('item_count').notNull(), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(), snapshot: jsonb('snapshot').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('stocktakes_warehouse_created_idx').on(table.warehouseId, table.createdAt)]);

// Partners are company masters, intentionally not bound to a warehouse.  Their
// opening balances are immutable placeholders until the accounting ledger is migrated.
export const partners = pgTable('partners', {
  id: id(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  type: partnerType('type').notNull(),
  phone: text('phone'),
  normalizedPhone: text('normalized_phone'),
  address: text('address'),
  notes: text('notes'),
  taxNumber: text('tax_number'),
  normalizedTaxNumber: text('normalized_tax_number'),
  openingBalanceUsd: numeric('opening_balance_usd', { precision: 16, scale: 4 }).notNull().default('0'),
  openingGoldBalance21kGrams: numeric('opening_gold_balance_21k_grams', { precision: 14, scale: 3 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedByUserId: uuid('archived_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, table => [
  index('partners_name_phone_type_active_idx').on(table.normalizedName, table.normalizedPhone, table.type, table.isActive),
  index('partners_phone_active_idx').on(table.normalizedPhone, table.isActive),
  index('partners_tax_active_idx').on(table.normalizedTaxNumber, table.isActive),
  index('partners_created_idx').on(table.createdAt),
]);

export type UserRow = typeof users.$inferSelect;
export type WarehouseRow = typeof warehouses.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
