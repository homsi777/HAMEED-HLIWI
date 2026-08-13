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
export const inventoryMode = pgEnum('inventory_mode', ['individual', 'aggregate']);
export const inventoryMovementType = pgEnum('inventory_movement_type', ['initial', 'transfer', 'sale', 'manual_sale', 'sale_cancellation', 'purchase', 'legacy_reconciliation', 'purchase_cancellation', 'sales_return', 'purchase_return', 'return_cancellation']);
export const stocktakeStatus = pgEnum('stocktake_status', ['completed']);
export const partnerType = pgEnum('partner_type', ['customer', 'supplier', 'both']);
export const salesInvoiceStatus = pgEnum('sales_invoice_status', ['posted', 'cancelled']);
export const salesLineType = pgEnum('sales_line_type', ['stock', 'manual']);
export const salesPaymentMethod = pgEnum('sales_payment_method', ['cash_usd', 'cash_syp', 'gold_exchange', 'debt', 'mixed']);
export const purchaseInvoiceStatus = pgEnum('purchase_invoice_status', ['posted', 'cancelled']);
export const purchasePaymentMethod = pgEnum('purchase_payment_method', ['cash_usd', 'cash_syp', 'debt', 'mixed']);
export const returnType = pgEnum('return_type', ['sales_return', 'purchase_return']);
export const returnInvoiceStatus = pgEnum('return_invoice_status', ['posted', 'cancelled']);
export const returnPaymentMethod = pgEnum('return_payment_method', ['cash_usd', 'cash_syp', 'credit_note']);

export const inventoryItems = pgTable('inventory_items', {
  id: id(), code: text('code').notNull(), name: text('name').notNull(), category: text('category').notNull(), karat: text('karat').notNull(),
  grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(),
  laborFeeUsdPerGram: numeric('labor_fee_usd_per_gram', { precision: 16, scale: 4 }).notNull().default('0'), totalLaborFeeUsd: numeric('total_labor_fee_usd', { precision: 16, scale: 4 }).notNull().default('0'),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), status: inventoryStatus('status').notNull().default('in_stock'), inventoryMode: inventoryMode('inventory_mode').notNull().default('individual'), quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'), isManualSaleEntry: boolean('is_manual_sale_entry').notNull().default(false), imagePath: text('image_path'), notes: text('notes'), version: integer('version').notNull().default(1), archivedAt: timestamp('archived_at', { withTimezone: true }), archivedByUserId: uuid('archived_by_user_id').references(() => users.id, { onDelete: 'set null' }), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('inventory_items_code_unique').on(table.code), index('inventory_items_warehouse_status_idx').on(table.warehouseId, table.status), index('inventory_items_karat_idx').on(table.karat), index('inventory_items_category_idx').on(table.category), check('inventory_items_karat_check', sql`${table.karat} in ('24','22','21','18','14')`), check('inventory_items_weights_check', sql`(${table.isManualSaleEntry} = true and ${table.grossWeightGrams} < 0 and ${table.stoneWeightGrams} <= 0 and ${table.netWeightGrams} < 0) or (${table.isManualSaleEntry} = false and ${table.grossWeightGrams} >= 0 and ${table.stoneWeightGrams} >= 0 and ${table.netWeightGrams} >= 0 and ${table.grossWeightGrams} >= ${table.stoneWeightGrams})`), check('inventory_items_quantity_check', sql`(${table.isManualSaleEntry} = true and ${table.quantity} < 0) or (${table.inventoryMode} = 'aggregate') or (${table.quantity} > 0)`), check('inventory_items_labor_check', sql`${table.laborFeeUsdPerGram} >= 0 and ${table.totalLaborFeeUsd} >= 0`)]);

export const inventoryMovements = pgTable('inventory_movements', { id: id(), inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }), salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }), type: inventoryMovementType('type').notNull(), fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }), toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }), actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), note: text('note'), metadata: jsonb('metadata').notNull().default({}), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('inventory_movements_item_created_idx').on(table.inventoryItemId, table.createdAt), index('inventory_movements_warehouse_idx').on(table.toWarehouseId), index('inventory_movements_sale_invoice_idx').on(table.salesInvoiceId), index('inventory_movements_purchase_invoice_idx').on(table.purchaseInvoiceId), index('inventory_movements_return_invoice_idx').on(table.returnInvoiceId)]);

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

// Sales are immutable posted facts. Amounts are stored as PostgreSQL numerics;
// the service calculates them in SQL and never accepts client totals as truth.
export const salesInvoiceSequences = pgTable('sales_invoice_sequences', { year: integer('year').primaryKey(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });
export const salesInvoices = pgTable('sales_invoices', {
  id: id(), invoiceNumber: text('invoice_number').notNull(), invoiceYear: integer('invoice_year').notNull(), sequenceNumber: integer('sequence_number').notNull(), status: salesInvoiceStatus('status').notNull().default('posted'), warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), customerPartnerId: uuid('customer_partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }), customerNameSnapshot: text('customer_name_snapshot').notNull(), customerPhoneSnapshot: text('customer_phone_snapshot'),
  goldSubtotalUsd: numeric('gold_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), workmanshipSubtotalUsd: numeric('workmanship_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), scrapTotalValueUsd: numeric('scrap_total_value_usd', { precision: 18, scale: 4 }).notNull().default('0'), discountUsd: numeric('discount_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalUsd: numeric('final_total_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalSyp: numeric('final_total_syp', { precision: 20, scale: 2 }).notNull().default('0'), paidUsd: numeric('paid_usd', { precision: 18, scale: 4 }).notNull().default('0'), paidSyp: numeric('paid_syp', { precision: 20, scale: 2 }).notNull().default('0'), paidSypInUsd: numeric('paid_syp_in_usd', { precision: 18, scale: 4 }).notNull().default('0'), remainingDebtUsd: numeric('remaining_debt_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  paymentMethod: salesPaymentMethod('payment_method').notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), notes: text('notes'), itemPhotoData: text('item_photo_data'), idempotencyKey: text('idempotency_key').notNull(), version: integer('version').notNull().default(1), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('sales_invoices_number_unique').on(table.invoiceNumber), uniqueIndex('sales_invoices_idempotency_key_unique').on(table.idempotencyKey), uniqueIndex('sales_invoices_year_sequence_unique').on(table.invoiceYear, table.sequenceNumber), index('sales_invoices_warehouse_date_idx').on(table.warehouseId, table.createdAt), index('sales_invoices_customer_idx').on(table.customerPartnerId), index('sales_invoices_status_created_idx').on(table.status, table.createdAt)]);
export const salesInvoiceItems = pgTable('sales_invoice_items', { id: id(), salesInvoiceId: uuid('sales_invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'restrict' }), lineNumber: integer('line_number').notNull(), lineType: salesLineType('line_type').notNull(), inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }), itemCodeSnapshot: text('item_code_snapshot'), itemNameSnapshot: text('item_name_snapshot').notNull(), categorySnapshot: text('category_snapshot').notNull(), karatSnapshot: text('karat_snapshot').notNull(), quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'), grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(), goldPriceUsdPerGram: numeric('gold_price_usd_per_gram', { precision: 18, scale: 4 }).notNull(), workmanshipUsdPerGram: numeric('workmanship_usd_per_gram', { precision: 18, scale: 4 }).notNull(), goldValueUsd: numeric('gold_value_usd', { precision: 18, scale: 4 }).notNull(), workmanshipValueUsd: numeric('workmanship_value_usd', { precision: 18, scale: 4 }).notNull(), lineTotalUsd: numeric('line_total_usd', { precision: 18, scale: 4 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [uniqueIndex('sales_invoice_items_invoice_line_unique').on(table.salesInvoiceId, table.lineNumber), index('sales_invoice_items_inventory_idx').on(table.inventoryItemId), index('sales_invoice_items_invoice_idx').on(table.salesInvoiceId)]);
export const salesGoldExchanges = pgTable('sales_gold_exchanges', { id: id(), salesInvoiceId: uuid('sales_invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'restrict' }), karat: text('karat').notNull(), weightGrams: numeric('weight_grams', { precision: 14, scale: 3 }).notNull(), evaluationPriceUsdPerGram: numeric('evaluation_price_usd_per_gram', { precision: 18, scale: 4 }).notNull(), valueUsd: numeric('value_usd', { precision: 18, scale: 4 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('sales_gold_exchanges_invoice_idx').on(table.salesInvoiceId), check('sales_gold_exchanges_karat_check', sql`${table.karat} in ('24','22','21','18','14')`)]);
export const salesPayments = pgTable('sales_payments', { id: id(), salesInvoiceId: uuid('sales_invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'restrict' }), method: salesPaymentMethod('method').notNull(), amountUsd: numeric('amount_usd', { precision: 18, scale: 4 }).notNull().default('0'), amountSyp: numeric('amount_syp', { precision: 20, scale: 2 }).notNull().default('0'), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }), appliedUsd: numeric('applied_usd', { precision: 18, scale: 4 }).notNull().default('0'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('sales_payments_invoice_idx').on(table.salesInvoiceId), check('sales_payments_amounts_check', sql`${table.amountUsd} >= 0 and ${table.amountSyp} >= 0 and ${table.appliedUsd} >= 0`)]);

// Purchases are immutable posted facts. Reconciliation is always explicit: a
// purchase line may name one legacy-negative item, but never matches by text.
export const purchaseInvoiceSequences = pgTable('purchase_invoice_sequences', { year: integer('year').primaryKey(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });
export const purchaseInvoices = pgTable('purchase_invoices', {
  id: id(), purchaseNumber: text('purchase_number').notNull(), purchaseYear: integer('purchase_year').notNull(), sequenceNumber: integer('sequence_number').notNull(), status: purchaseInvoiceStatus('status').notNull().default('posted'), warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), supplierPartnerId: uuid('supplier_partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }), supplierNameSnapshot: text('supplier_name_snapshot').notNull(), supplierPhoneSnapshot: text('supplier_phone_snapshot'),
  goldSubtotalUsd: numeric('gold_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), workmanshipSubtotalUsd: numeric('workmanship_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), discountUsd: numeric('discount_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalUsd: numeric('final_total_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalSyp: numeric('final_total_syp', { precision: 20, scale: 2 }).notNull().default('0'), paidUsd: numeric('paid_usd', { precision: 18, scale: 4 }).notNull().default('0'), paidSyp: numeric('paid_syp', { precision: 20, scale: 2 }).notNull().default('0'), paidSypInUsd: numeric('paid_syp_in_usd', { precision: 18, scale: 4 }).notNull().default('0'), remainingDebtUsd: numeric('remaining_debt_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  paymentMethod: purchasePaymentMethod('payment_method').notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), notes: text('notes'), itemPhotoData: text('item_photo_data'), idempotencyKey: text('idempotency_key').notNull(), version: integer('version').notNull().default(1), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('purchase_invoices_number_unique').on(table.purchaseNumber), uniqueIndex('purchase_invoices_idempotency_key_unique').on(table.idempotencyKey), uniqueIndex('purchase_invoices_year_sequence_unique').on(table.purchaseYear, table.sequenceNumber), index('purchase_invoices_warehouse_date_idx').on(table.warehouseId, table.createdAt), index('purchase_invoices_supplier_date_idx').on(table.supplierPartnerId, table.createdAt), index('purchase_invoices_status_created_idx').on(table.status, table.createdAt)]);
export const purchaseInvoiceItems = pgTable('purchase_invoice_items', {
  id: id(), purchaseInvoiceId: uuid('purchase_invoice_id').notNull().references(() => purchaseInvoices.id, { onDelete: 'restrict' }), lineNumber: integer('line_number').notNull(), receivedInventoryItemId: uuid('received_inventory_item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }), reconciliationTargetInventoryItemId: uuid('reconciliation_target_inventory_item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }), itemCodeSnapshot: text('item_code_snapshot').notNull(), itemNameSnapshot: text('item_name_snapshot').notNull(), categorySnapshot: text('category_snapshot').notNull(), karatSnapshot: text('karat_snapshot').notNull(), quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'), grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(), goldPriceUsdPerGram: numeric('gold_price_usd_per_gram', { precision: 18, scale: 4 }).notNull(), workmanshipUsdPerGram: numeric('workmanship_usd_per_gram', { precision: 18, scale: 4 }).notNull(), goldValueUsd: numeric('gold_value_usd', { precision: 18, scale: 4 }).notNull(), workmanshipValueUsd: numeric('workmanship_value_usd', { precision: 18, scale: 4 }).notNull(), lineTotalUsd: numeric('line_total_usd', { precision: 18, scale: 4 }).notNull(), reconciledQuantity: numeric('reconciled_quantity', { precision: 14, scale: 3 }).notNull().default('0'), reconciledNetWeightGrams: numeric('reconciled_net_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('purchase_invoice_items_invoice_line_unique').on(table.purchaseInvoiceId, table.lineNumber), index('purchase_invoice_items_received_inventory_idx').on(table.receivedInventoryItemId), index('purchase_invoice_items_reconciliation_idx').on(table.reconciliationTargetInventoryItemId), index('purchase_invoice_items_invoice_idx').on(table.purchaseInvoiceId)]);
export const purchasePayments = pgTable('purchase_payments', { id: id(), purchaseInvoiceId: uuid('purchase_invoice_id').notNull().references(() => purchaseInvoices.id, { onDelete: 'restrict' }), method: purchasePaymentMethod('method').notNull(), amountUsd: numeric('amount_usd', { precision: 18, scale: 4 }).notNull().default('0'), amountSyp: numeric('amount_syp', { precision: 20, scale: 2 }).notNull().default('0'), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }), appliedUsd: numeric('applied_usd', { precision: 18, scale: 4 }).notNull().default('0'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('purchase_payments_invoice_idx').on(table.purchaseInvoiceId), check('purchase_payments_amounts_check', sql`${table.amountUsd} >= 0 and ${table.amountSyp} >= 0 and ${table.appliedUsd} >= 0`)]);

// Returns are immutable posted facts referencing exactly one posted sale or purchase.
// Returnable quantity and weight are always derived from the original line minus the
// posted return lines that point at it, never from a client-supplied remaining number.
export const returnInvoiceSequences = pgTable('return_invoice_sequences', { year: integer('year').primaryKey(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });
export const returnInvoices = pgTable('return_invoices', {
  id: id(), returnNumber: text('return_number').notNull(), returnYear: integer('return_year').notNull(), sequenceNumber: integer('sequence_number').notNull(), type: returnType('type').notNull(), status: returnInvoiceStatus('status').notNull().default('posted'), originalSalesInvoiceId: uuid('original_sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), originalPurchaseInvoiceId: uuid('original_purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }), partnerNameSnapshot: text('partner_name_snapshot').notNull(), partnerPhoneSnapshot: text('partner_phone_snapshot'), reason: text('reason').notNull(),
  goldSubtotalUsd: numeric('gold_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), workmanshipSubtotalUsd: numeric('workmanship_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), returnGrossUsd: numeric('return_gross_usd', { precision: 18, scale: 4 }).notNull().default('0'), discountAllocatedUsd: numeric('discount_allocated_usd', { precision: 18, scale: 4 }).notNull().default('0'), scrapCreditAllocatedUsd: numeric('scrap_credit_allocated_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalUsd: numeric('final_total_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalSyp: numeric('final_total_syp', { precision: 20, scale: 2 }).notNull().default('0'), refundedUsd: numeric('refunded_usd', { precision: 18, scale: 4 }).notNull().default('0'), refundedSyp: numeric('refunded_syp', { precision: 20, scale: 2 }).notNull().default('0'), refundedSypInUsd: numeric('refunded_syp_in_usd', { precision: 18, scale: 4 }).notNull().default('0'), outstandingAdjustmentUsd: numeric('outstanding_adjustment_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), notes: text('notes'), idempotencyKey: text('idempotency_key').notNull(), version: integer('version').notNull().default(1), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('return_invoices_number_unique').on(table.returnNumber), uniqueIndex('return_invoices_idempotency_key_unique').on(table.idempotencyKey), uniqueIndex('return_invoices_year_sequence_unique').on(table.returnYear, table.sequenceNumber), index('return_invoices_warehouse_date_idx').on(table.warehouseId, table.createdAt), index('return_invoices_partner_date_idx').on(table.partnerId, table.createdAt), index('return_invoices_type_status_idx').on(table.type, table.status), index('return_invoices_original_sale_idx').on(table.originalSalesInvoiceId), index('return_invoices_original_purchase_idx').on(table.originalPurchaseInvoiceId), check('return_invoices_source_check', sql`(${table.type} = 'sales_return' and ${table.originalSalesInvoiceId} is not null and ${table.originalPurchaseInvoiceId} is null) or (${table.type} = 'purchase_return' and ${table.originalPurchaseInvoiceId} is not null and ${table.originalSalesInvoiceId} is null)`), check('return_invoices_amounts_check', sql`${table.returnGrossUsd} >= 0 and ${table.discountAllocatedUsd} >= 0 and ${table.scrapCreditAllocatedUsd} >= 0 and ${table.finalTotalUsd} >= 0 and ${table.refundedUsd} >= 0 and ${table.refundedSyp} >= 0`)]);
export const returnInvoiceItems = pgTable('return_invoice_items', {
  id: id(), returnInvoiceId: uuid('return_invoice_id').notNull().references(() => returnInvoices.id, { onDelete: 'restrict' }), lineNumber: integer('line_number').notNull(), sourceSalesInvoiceItemId: uuid('source_sales_invoice_item_id').references(() => salesInvoiceItems.id, { onDelete: 'restrict' }), sourcePurchaseInvoiceItemId: uuid('source_purchase_invoice_item_id').references(() => purchaseInvoiceItems.id, { onDelete: 'restrict' }), inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }), itemCodeSnapshot: text('item_code_snapshot'), itemNameSnapshot: text('item_name_snapshot').notNull(), categorySnapshot: text('category_snapshot').notNull(), karatSnapshot: text('karat_snapshot').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(), grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(), goldPriceUsdPerGram: numeric('gold_price_usd_per_gram', { precision: 18, scale: 4 }).notNull(), workmanshipUsdPerGram: numeric('workmanship_usd_per_gram', { precision: 18, scale: 4 }).notNull(), goldValueUsd: numeric('gold_value_usd', { precision: 18, scale: 4 }).notNull(), workmanshipValueUsd: numeric('workmanship_value_usd', { precision: 18, scale: 4 }).notNull(), lineGrossUsd: numeric('line_gross_usd', { precision: 18, scale: 4 }).notNull(), discountAllocatedUsd: numeric('discount_allocated_usd', { precision: 18, scale: 4 }).notNull().default('0'), scrapCreditAllocatedUsd: numeric('scrap_credit_allocated_usd', { precision: 18, scale: 4 }).notNull().default('0'), lineTotalUsd: numeric('line_total_usd', { precision: 18, scale: 4 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('return_invoice_items_return_line_unique').on(table.returnInvoiceId, table.lineNumber), index('return_invoice_items_return_idx').on(table.returnInvoiceId), index('return_invoice_items_source_sale_line_idx').on(table.sourceSalesInvoiceItemId), index('return_invoice_items_source_purchase_line_idx').on(table.sourcePurchaseInvoiceItemId), index('return_invoice_items_inventory_idx').on(table.inventoryItemId), check('return_invoice_items_source_check', sql`(${table.sourceSalesInvoiceItemId} is not null and ${table.sourcePurchaseInvoiceItemId} is null) or (${table.sourcePurchaseInvoiceItemId} is not null and ${table.sourceSalesInvoiceItemId} is null)`), check('return_invoice_items_amounts_check', sql`${table.quantity} > 0 and ${table.netWeightGrams} > 0 and ${table.grossWeightGrams} > 0 and ${table.lineGrossUsd} >= 0 and ${table.lineTotalUsd} >= 0`)]);
// Refund facts stay descriptive until the cashbox and ledger modules are migrated.
export const returnPayments = pgTable('return_payments', { id: id(), returnInvoiceId: uuid('return_invoice_id').notNull().references(() => returnInvoices.id, { onDelete: 'restrict' }), method: returnPaymentMethod('method').notNull(), amountUsd: numeric('amount_usd', { precision: 18, scale: 4 }).notNull().default('0'), amountSyp: numeric('amount_syp', { precision: 20, scale: 2 }).notNull().default('0'), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }), appliedUsd: numeric('applied_usd', { precision: 18, scale: 4 }).notNull().default('0'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('return_payments_return_idx').on(table.returnInvoiceId), check('return_payments_amounts_check', sql`${table.amountUsd} >= 0 and ${table.amountSyp} >= 0 and ${table.appliedUsd} >= 0`)]);

export type UserRow = typeof users.$inferSelect;
export type WarehouseRow = typeof warehouses.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
