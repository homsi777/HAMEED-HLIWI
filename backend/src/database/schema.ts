import { bigint, check, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
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
  // Internal technical roles (`system_admin`, per-user permission overrides) are never
  // offered as business presets in the user-creation screen.
  isSystem: boolean('is_system').notNull().default(false),
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

export const shiftStatus = pgEnum('shift_status', ['open', 'closing_requested', 'closed', 'cancelled']);

// A shift is the seller's accountability window. Money is already booked to the cashbox by
// the sale itself (Task 07), so a shift never re-posts cash: it records custody — what the
// seller started with, what the documents say they should hold, and what they actually
// handed back — and preserves that as an immutable snapshot once a manager approves it.
export const shifts = pgTable('shifts', {
  id: id(),
  shiftNumber: text('shift_number').notNull(),
  shiftYear: integer('shift_year').notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  sellerUserId: uuid('seller_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
  status: shiftStatus('status').notNull().default('open'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  openedByUserId: uuid('opened_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  closingRequestedAt: timestamp('closing_requested_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedByUserId: uuid('closed_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  // Custody the seller physically started the shift holding, per currency. Never merged.
  openingCustodyUsd: numeric('opening_custody_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  openingCustodySyp: numeric('opening_custody_syp', { precision: 20, scale: 2 }).notNull().default('0'),
  expectedUsd: numeric('expected_usd', { precision: 18, scale: 4 }),
  expectedSyp: numeric('expected_syp', { precision: 20, scale: 2 }),
  actualUsd: numeric('actual_usd', { precision: 18, scale: 4 }),
  actualSyp: numeric('actual_syp', { precision: 20, scale: 2 }),
  differenceUsd: numeric('difference_usd', { precision: 18, scale: 4 }),
  differenceSyp: numeric('difference_syp', { precision: 20, scale: 2 }),
  sellerNote: text('seller_note'),
  managerNote: text('manager_note'),
  // Frozen at approval so a closed shift never changes when later documents change.
  closureSnapshot: jsonb('closure_snapshot'),
  idempotencyKey: text('idempotency_key').notNull(),
  version: integer('version').notNull().default(1),
  ...timestamps,
}, table => [
  uniqueIndex('shifts_number_unique').on(table.shiftNumber),
  uniqueIndex('shifts_idempotency_unique').on(table.idempotencyKey),
  uniqueIndex('shifts_year_sequence_unique').on(table.shiftYear, table.sequenceNumber),
  // The database itself refuses a second live shift for the same seller.
  uniqueIndex('shifts_one_live_per_seller').on(table.sellerUserId).where(sql`status in ('open', 'closing_requested')`),
  index('shifts_warehouse_status_idx').on(table.warehouseId, table.status, table.openedAt),
  index('shifts_seller_opened_idx').on(table.sellerUserId, table.openedAt),
  index('shifts_status_opened_idx').on(table.status, table.openedAt),
]);

// Operational timeline only. It never duplicates the accounting journal.
export const shiftActivities = pgTable('shift_activities', {
  id: id(),
  shiftId: uuid('shift_id').notNull().references(() => shifts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),
  referenceNumber: text('reference_number'),
  amountUsd: numeric('amount_usd', { precision: 18, scale: 4 }),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }),
  returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('shift_activities_shift_time_idx').on(table.shiftId, table.occurredAt)]);

// One manager decision to reclassify physical scrap into sellable second-hand stock.
//
// The gold ledger already moves the metal, and the inventory item already exists; what neither
// can express on its own is the link between them plus the manager's judgement — which holding
// was drawn down, how much, into which item, why, and by whom. That relationship is what this
// table records, and it is what makes a conversion reversible and auditable.
export const goldInventoryConversions = pgTable('gold_inventory_conversions', {
  id: id(),
  goldAccountId: uuid('gold_account_id').notNull().references(() => goldAccounts.id, { onDelete: 'restrict' }),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
  karat: text('karat').notNull(),
  convertedWeightGrams: numeric('converted_weight_grams', { precision: 14, scale: 3 }).notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'),
  inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  goldTransactionId: uuid('gold_transaction_id').notNull().references(() => goldTransactions.id, { onDelete: 'restrict' }),
  managerNote: text('manager_note').notNull(),
  status: text('status').notNull().default('posted'),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversedByUserId: uuid('reversed_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  reversalReason: text('reversal_reason'),
  reversalGoldTransactionId: uuid('reversal_gold_transaction_id').references(() => goldTransactions.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, table => [
  uniqueIndex('gold_inventory_conversions_idempotency_unique').on(table.idempotencyKey),
  uniqueIndex('gold_inventory_conversions_item_unique').on(table.inventoryItemId),
  index('gold_inventory_conversions_account_karat_idx').on(table.goldAccountId, table.karat, table.status),
  index('gold_inventory_conversions_warehouse_idx').on(table.warehouseId, table.createdAt),
  check('gold_inventory_conversions_weight_check', sql`${table.convertedWeightGrams} > 0 and ${table.quantity} > 0`),
  check('gold_inventory_conversions_status_check', sql`${table.status} in ('posted', 'reversed')`),
]);

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
export const inventoryMovementType = pgEnum('inventory_movement_type', ['initial', 'transfer', 'sale', 'manual_sale', 'sale_cancellation', 'purchase', 'legacy_reconciliation', 'purchase_cancellation', 'sales_return', 'purchase_return', 'return_cancellation', 'gold_used_conversion', 'gold_used_conversion_reversal']);
// Whether a stock item is new or second-hand metal reclassified from scrap taken in.
export const inventoryCondition = pgEnum('inventory_condition', ['new', 'used']);
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
export const cashCurrency = pgEnum('cash_currency', ['USD', 'SYP']);
export const voucherType = pgEnum('voucher_type', ['receipt', 'payment', 'expense']);
export const voucherStatus = pgEnum('voucher_status', ['posted', 'cancelled']);
export const voucherSourceType = pgEnum('voucher_source_type', ['manual', 'sale', 'purchase', 'sales_return', 'purchase_return', 'cashbox_transfer', 'expense']);
export const cashMovementDirection = pgEnum('cash_movement_direction', ['inflow', 'outflow']);
export const partnerLedgerEntryType = pgEnum('partner_ledger_entry_type', ['opening', 'sale', 'purchase', 'sales_return', 'purchase_return', 'receipt', 'payment', 'reversal']);
export const accountClass = pgEnum('account_class', ['asset', 'liability', 'equity', 'revenue', 'expense']);
export const accountNormalBalance = pgEnum('account_normal_balance', ['debit', 'credit']);
export const journalStatus = pgEnum('journal_status', ['posted', 'reversed']);
export const journalSourceType = pgEnum('journal_source_type', ['manual', 'opening', 'sale', 'purchase', 'sales_return', 'purchase_return', 'voucher', 'cashbox_transfer']);
export const goldAccountKind = pgEnum('gold_account_kind', ['partner', 'company', 'custody_person']);
export const goldTransactionType = pgEnum('gold_transaction_type', ['opening', 'sale_exchange', 'sales_return_obligation', 'purchase_settlement', 'purchase_return_adjustment', 'receipt', 'payment', 'conversion', 'reversal', 'used_inventory_conversion']);
export const goldTransactionStatus = pgEnum('gold_transaction_status', ['posted', 'reversed']);

export const inventoryItems = pgTable('inventory_items', {
  id: id(), code: text('code').notNull(), name: text('name').notNull(), category: text('category').notNull(), karat: text('karat').notNull(),
  grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(),
  laborFeeUsdPerGram: numeric('labor_fee_usd_per_gram', { precision: 16, scale: 4 }).notNull().default('0'), totalLaborFeeUsd: numeric('total_labor_fee_usd', { precision: 16, scale: 4 }).notNull().default('0'),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), status: inventoryStatus('status').notNull().default('in_stock'), inventoryMode: inventoryMode('inventory_mode').notNull().default('individual'), quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'), isManualSaleEntry: boolean('is_manual_sale_entry').notNull().default(false), condition: inventoryCondition('condition').notNull().default('new'), sourceType: text('source_type'), imagePath: text('image_path'), notes: text('notes'), version: integer('version').notNull().default(1), archivedAt: timestamp('archived_at', { withTimezone: true }), archivedByUserId: uuid('archived_by_user_id').references(() => users.id, { onDelete: 'set null' }), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
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

/**
 * Document numbers the owner reads on screen are plain numbers, not codes, and they run
 * continuously for the life of the business rather than restarting each year — a per-year
 * sequence would hand out the same number again next January. One row per document kind.
 */
export const documentSequences = pgTable('document_sequences', {
  key: text('key').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Sales are immutable posted facts. Amounts are stored as PostgreSQL numerics;
// the service calculates them in SQL and never accepts client totals as truth.
export const salesInvoiceSequences = pgTable('sales_invoice_sequences', { year: integer('year').primaryKey(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });
export const salesInvoices = pgTable('sales_invoices', {
  id: id(), invoiceNumber: text('invoice_number').notNull(), invoiceYear: integer('invoice_year').notNull(), sequenceNumber: integer('sequence_number').notNull(), status: salesInvoiceStatus('status').notNull().default('posted'), warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }), customerPartnerId: uuid('customer_partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }), customerNameSnapshot: text('customer_name_snapshot').notNull(), customerPhoneSnapshot: text('customer_phone_snapshot'),
  goldSubtotalUsd: numeric('gold_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), workmanshipSubtotalUsd: numeric('workmanship_subtotal_usd', { precision: 18, scale: 4 }).notNull().default('0'), scrapTotalValueUsd: numeric('scrap_total_value_usd', { precision: 18, scale: 4 }).notNull().default('0'), discountUsd: numeric('discount_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalUsd: numeric('final_total_usd', { precision: 18, scale: 4 }).notNull().default('0'), finalTotalSyp: numeric('final_total_syp', { precision: 20, scale: 2 }).notNull().default('0'), paidUsd: numeric('paid_usd', { precision: 18, scale: 4 }).notNull().default('0'), paidSyp: numeric('paid_syp', { precision: 20, scale: 2 }).notNull().default('0'), paidSypInUsd: numeric('paid_syp_in_usd', { precision: 18, scale: 4 }).notNull().default('0'), remainingDebtUsd: numeric('remaining_debt_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  paymentMethod: salesPaymentMethod('payment_method').notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), notes: text('notes'), itemPhotoData: text('item_photo_data'), idempotencyKey: text('idempotency_key').notNull(), version: integer('version').notNull().default(1), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'), shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'restrict' }), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [index('sales_invoices_shift_idx').on(table.shiftId), index('sales_invoices_seller_created_idx').on(table.createdByUserId, table.createdAt), index('sales_invoices_created_idx').on(table.createdAt), uniqueIndex('sales_invoices_number_unique').on(table.invoiceNumber), uniqueIndex('sales_invoices_idempotency_key_unique').on(table.idempotencyKey), uniqueIndex('sales_invoices_year_sequence_unique').on(table.invoiceYear, table.sequenceNumber), index('sales_invoices_warehouse_date_idx').on(table.warehouseId, table.createdAt), index('sales_invoices_customer_idx').on(table.customerPartnerId), index('sales_invoices_status_created_idx').on(table.status, table.createdAt)]);
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
  exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), notes: text('notes'), idempotencyKey: text('idempotency_key').notNull(), version: integer('version').notNull().default(1), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'), shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'restrict' }), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [index('return_invoices_shift_idx').on(table.shiftId), index('return_invoices_seller_created_idx').on(table.createdByUserId, table.createdAt), uniqueIndex('return_invoices_number_unique').on(table.returnNumber), uniqueIndex('return_invoices_idempotency_key_unique').on(table.idempotencyKey), uniqueIndex('return_invoices_year_sequence_unique').on(table.returnYear, table.sequenceNumber), index('return_invoices_warehouse_date_idx').on(table.warehouseId, table.createdAt), index('return_invoices_partner_date_idx').on(table.partnerId, table.createdAt), index('return_invoices_type_status_idx').on(table.type, table.status), index('return_invoices_original_sale_idx').on(table.originalSalesInvoiceId), index('return_invoices_original_purchase_idx').on(table.originalPurchaseInvoiceId), check('return_invoices_source_check', sql`(${table.type} = 'sales_return' and ${table.originalSalesInvoiceId} is not null and ${table.originalPurchaseInvoiceId} is null) or (${table.type} = 'purchase_return' and ${table.originalPurchaseInvoiceId} is not null and ${table.originalSalesInvoiceId} is null)`), check('return_invoices_amounts_check', sql`${table.returnGrossUsd} >= 0 and ${table.discountAllocatedUsd} >= 0 and ${table.scrapCreditAllocatedUsd} >= 0 and ${table.finalTotalUsd} >= 0 and ${table.refundedUsd} >= 0 and ${table.refundedSyp} >= 0`)]);
export const returnInvoiceItems = pgTable('return_invoice_items', {
  id: id(), returnInvoiceId: uuid('return_invoice_id').notNull().references(() => returnInvoices.id, { onDelete: 'restrict' }), lineNumber: integer('line_number').notNull(), sourceSalesInvoiceItemId: uuid('source_sales_invoice_item_id').references(() => salesInvoiceItems.id, { onDelete: 'restrict' }), sourcePurchaseInvoiceItemId: uuid('source_purchase_invoice_item_id').references(() => purchaseInvoiceItems.id, { onDelete: 'restrict' }), inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }), itemCodeSnapshot: text('item_code_snapshot'), itemNameSnapshot: text('item_name_snapshot').notNull(), categorySnapshot: text('category_snapshot').notNull(), karatSnapshot: text('karat_snapshot').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(), grossWeightGrams: numeric('gross_weight_grams', { precision: 14, scale: 3 }).notNull(), stoneWeightGrams: numeric('stone_weight_grams', { precision: 14, scale: 3 }).notNull().default('0'), netWeightGrams: numeric('net_weight_grams', { precision: 14, scale: 3 }).notNull(), goldPriceUsdPerGram: numeric('gold_price_usd_per_gram', { precision: 18, scale: 4 }).notNull(), workmanshipUsdPerGram: numeric('workmanship_usd_per_gram', { precision: 18, scale: 4 }).notNull(), goldValueUsd: numeric('gold_value_usd', { precision: 18, scale: 4 }).notNull(), workmanshipValueUsd: numeric('workmanship_value_usd', { precision: 18, scale: 4 }).notNull(), lineGrossUsd: numeric('line_gross_usd', { precision: 18, scale: 4 }).notNull(), discountAllocatedUsd: numeric('discount_allocated_usd', { precision: 18, scale: 4 }).notNull().default('0'), scrapCreditAllocatedUsd: numeric('scrap_credit_allocated_usd', { precision: 18, scale: 4 }).notNull().default('0'), lineTotalUsd: numeric('line_total_usd', { precision: 18, scale: 4 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('return_invoice_items_return_line_unique').on(table.returnInvoiceId, table.lineNumber), index('return_invoice_items_return_idx').on(table.returnInvoiceId), index('return_invoice_items_source_sale_line_idx').on(table.sourceSalesInvoiceItemId), index('return_invoice_items_source_purchase_line_idx').on(table.sourcePurchaseInvoiceItemId), index('return_invoice_items_inventory_idx').on(table.inventoryItemId), check('return_invoice_items_source_check', sql`(${table.sourceSalesInvoiceItemId} is not null and ${table.sourcePurchaseInvoiceItemId} is null) or (${table.sourcePurchaseInvoiceItemId} is not null and ${table.sourceSalesInvoiceItemId} is null)`), check('return_invoice_items_amounts_check', sql`${table.quantity} > 0 and ${table.netWeightGrams} > 0 and ${table.grossWeightGrams} > 0 and ${table.lineGrossUsd} >= 0 and ${table.lineTotalUsd} >= 0`)]);
// Refund facts stay descriptive until the cashbox and ledger modules are migrated.
export const returnPayments = pgTable('return_payments', { id: id(), returnInvoiceId: uuid('return_invoice_id').notNull().references(() => returnInvoices.id, { onDelete: 'restrict' }), method: returnPaymentMethod('method').notNull(), amountUsd: numeric('amount_usd', { precision: 18, scale: 4 }).notNull().default('0'), amountSyp: numeric('amount_syp', { precision: 20, scale: 2 }).notNull().default('0'), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }), appliedUsd: numeric('applied_usd', { precision: 18, scale: 4 }).notNull().default('0'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, table => [index('return_payments_return_idx').on(table.returnInvoiceId), check('return_payments_amounts_check', sql`${table.amountUsd} >= 0 and ${table.amountSyp} >= 0 and ${table.appliedUsd} >= 0`)]);

// Finance is an operational subledger, not a general ledger. Cash balances are always
// derived from immutable movements, and partner balances from immutable ledger entries,
// so no stored number can silently drift away from the documents that justify it.
export const cashboxes = pgTable('cashboxes', {
  id: id(), name: text('name').notNull(), currency: cashCurrency('currency').notNull(), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  openingBalance: numeric('opening_balance', { precision: 20, scale: 4 }).notNull().default('0'), isDefault: boolean('is_default').notNull().default(false), isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'), version: integer('version').notNull().default(1), archivedAt: timestamp('archived_at', { withTimezone: true }), archivedByUserId: uuid('archived_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [
  uniqueIndex('cashboxes_warehouse_name_unique').on(table.warehouseId, table.name),
  uniqueIndex('cashboxes_default_per_warehouse_currency').on(table.warehouseId, table.currency).where(sql`${table.isDefault} = true and ${table.archivedAt} is null`),
  index('cashboxes_warehouse_currency_idx').on(table.warehouseId, table.currency, table.isActive),
  check('cashboxes_opening_balance_check', sql`${table.openingBalance} >= 0`),
]);

export const voucherSequences = pgTable('voucher_sequences', { year: integer('year').notNull(), type: voucherType('type').notNull(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() }, table => [primaryKey({ columns: [table.year, table.type], name: 'voucher_sequences_pk' })]);
export const cashboxTransferSequences = pgTable('cashbox_transfer_sequences', { year: integer('year').primaryKey(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });

export const cashboxTransfers = pgTable('cashbox_transfers', {
  id: id(), transferNumber: text('transfer_number').notNull(), transferYear: integer('transfer_year').notNull(), sequenceNumber: integer('sequence_number').notNull(), status: voucherStatus('status').notNull().default('posted'),
  fromCashboxId: uuid('from_cashbox_id').notNull().references(() => cashboxes.id, { onDelete: 'restrict' }), toCashboxId: uuid('to_cashbox_id').notNull().references(() => cashboxes.id, { onDelete: 'restrict' }),
  amountFrom: numeric('amount_from', { precision: 20, scale: 4 }).notNull(), amountTo: numeric('amount_to', { precision: 20, scale: 4 }).notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }),
  note: text('note'), idempotencyKey: text('idempotency_key').notNull(), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('cashbox_transfers_number_unique').on(table.transferNumber), uniqueIndex('cashbox_transfers_idempotency_unique').on(table.idempotencyKey), uniqueIndex('cashbox_transfers_year_sequence_unique').on(table.transferYear, table.sequenceNumber), index('cashbox_transfers_created_idx').on(table.createdAt), check('cashbox_transfers_amounts_check', sql`${table.amountFrom} > 0 and ${table.amountTo} > 0`), check('cashbox_transfers_distinct_check', sql`${table.fromCashboxId} <> ${table.toCashboxId}`)]);

// A voucher is the document; the cash movement is the fact. Automatic vouchers carry the
// payment row they were generated from so one payment can never produce two vouchers.
export const vouchers = pgTable('vouchers', {
  id: id(), voucherNumber: text('voucher_number').notNull(), voucherYear: integer('voucher_year').notNull(), sequenceNumber: integer('sequence_number').notNull(), type: voucherType('type').notNull(), status: voucherStatus('status').notNull().default('posted'),
  sourceType: voucherSourceType('source_type').notNull().default('manual'), sourceDocumentNumber: text('source_document_number'), sourcePaymentId: uuid('source_payment_id'),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }), cashboxTransferId: uuid('cashbox_transfer_id').references(() => cashboxTransfers.id, { onDelete: 'restrict' }),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }), partnerNameSnapshot: text('partner_name_snapshot'), cashboxId: uuid('cashbox_id').notNull().references(() => cashboxes.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  currency: cashCurrency('currency').notNull(), amount: numeric('amount', { precision: 20, scale: 4 }).notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), amountUsdEquivalent: numeric('amount_usd_equivalent', { precision: 18, scale: 4 }).notNull(),
  expenseCategory: text('expense_category'), systemNote: text('system_note'), userNote: text('user_note'),
  reversalOfVoucherId: uuid('reversal_of_voucher_id'), idempotencyKey: text('idempotency_key').notNull(), version: integer('version').notNull().default(1),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }), cancellationReason: text('cancellation_reason'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [
  uniqueIndex('vouchers_number_unique').on(table.voucherNumber), uniqueIndex('vouchers_idempotency_unique').on(table.idempotencyKey), uniqueIndex('vouchers_year_type_sequence_unique').on(table.voucherYear, table.type, table.sequenceNumber),
  uniqueIndex('vouchers_source_payment_unique').on(table.sourceType, table.sourcePaymentId).where(sql`${table.sourcePaymentId} is not null`),
  index('vouchers_cashbox_created_idx').on(table.cashboxId, table.createdAt), index('vouchers_partner_created_idx').on(table.partnerId, table.createdAt), index('vouchers_type_status_created_idx').on(table.type, table.status, table.createdAt),
  index('vouchers_sales_invoice_idx').on(table.salesInvoiceId), index('vouchers_purchase_invoice_idx').on(table.purchaseInvoiceId), index('vouchers_return_invoice_idx').on(table.returnInvoiceId),
  check('vouchers_amount_check', sql`${table.amount} > 0 and ${table.amountUsdEquivalent} >= 0 and ${table.exchangeRateSypPerUsd} > 0`),
  check('vouchers_expense_partner_check', sql`${table.type} <> 'expense' or ${table.partnerId} is null`),
]);

export const cashMovements = pgTable('cash_movements', {
  id: id(), cashboxId: uuid('cashbox_id').notNull().references(() => cashboxes.id, { onDelete: 'restrict' }), voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'restrict' }), cashboxTransferId: uuid('cashbox_transfer_id').references(() => cashboxTransfers.id, { onDelete: 'restrict' }),
  direction: cashMovementDirection('direction').notNull(), amount: numeric('amount', { precision: 20, scale: 4 }).notNull(), currency: cashCurrency('currency').notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(), amountUsdEquivalent: numeric('amount_usd_equivalent', { precision: 18, scale: 4 }).notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), description: text('description').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('cash_movements_cashbox_created_idx').on(table.cashboxId, table.createdAt), index('cash_movements_voucher_idx').on(table.voucherId), index('cash_movements_partner_idx').on(table.partnerId), index('cash_movements_transfer_idx').on(table.cashboxTransferId), check('cash_movements_amount_check', sql`${table.amount} > 0`)]);

// The operational subledger every receivable and payable is derived from.
export const partnerLedgerEntries = pgTable('partner_ledger_entries', {
  id: id(), partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }), entryType: partnerLedgerEntryType('entry_type').notNull(),
  debitUsd: numeric('debit_usd', { precision: 18, scale: 4 }).notNull().default('0'), creditUsd: numeric('credit_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  currency: cashCurrency('currency').notNull().default('USD'), originalAmount: numeric('original_amount', { precision: 20, scale: 4 }).notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }), voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'restrict' }),
  documentNumber: text('document_number'), description: text('description').notNull(), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  reversalOfEntryId: uuid('reversal_of_entry_id'), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(), actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('partner_ledger_partner_occurred_idx').on(table.partnerId, table.occurredAt), index('partner_ledger_voucher_idx').on(table.voucherId), index('partner_ledger_sales_invoice_idx').on(table.salesInvoiceId), index('partner_ledger_purchase_invoice_idx').on(table.purchaseInvoiceId), index('partner_ledger_return_invoice_idx').on(table.returnInvoiceId), check('partner_ledger_amounts_check', sql`${table.debitUsd} >= 0 and ${table.creditUsd} >= 0`)]);

// Allocation of a receipt or payment against specific invoices, kept as records rather
// than as free text so a future accounting module can consume it directly.
export const voucherAllocations = pgTable('voucher_allocations', {
  id: id(), voucherId: uuid('voucher_id').notNull().references(() => vouchers.id, { onDelete: 'restrict' }),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }),
  amountUsd: numeric('amount_usd', { precision: 18, scale: 4 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('voucher_allocations_voucher_idx').on(table.voucherId), index('voucher_allocations_sales_invoice_idx').on(table.salesInvoiceId), index('voucher_allocations_purchase_invoice_idx').on(table.purchaseInvoiceId), check('voucher_allocations_amount_check', sql`${table.amountUsd} > 0`), check('voucher_allocations_target_check', sql`(${table.salesInvoiceId} is not null)::int + (${table.purchaseInvoiceId} is not null)::int + (${table.returnInvoiceId} is not null)::int = 1`)]);

export const expenseCategories = pgTable('expense_categories', { id: id(), name: text('name').notNull(), isActive: boolean('is_active').notNull().default(true), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps }, table => [uniqueIndex('expense_categories_name_unique').on(table.name)]);

// The accounting core. Journals are immutable once posted; a correction is always a new
// reversing journal. USD is the reporting currency, and every line that converted from
// another currency keeps its original amount and the rate used at the time.
export const accounts = pgTable('accounts', {
  id: id(), code: text('code').notNull(), nameAr: text('name_ar').notNull(), nameEn: text('name_en'), parentAccountId: uuid('parent_account_id'),
  accountClass: accountClass('account_class').notNull(), normalBalance: accountNormalBalance('normal_balance').notNull(),
  allowsPosting: boolean('allows_posting').notNull().default(true), isSystem: boolean('is_system').notNull().default(false), systemKey: text('system_key'),
  isActive: boolean('is_active').notNull().default(true), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }), currency: cashCurrency('currency'),
  notes: text('notes'), version: integer('version').notNull().default(1), archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('accounts_code_unique').on(table.code), uniqueIndex('accounts_system_key_unique').on(table.systemKey).where(sql`${table.systemKey} is not null`), index('accounts_parent_idx').on(table.parentAccountId), index('accounts_class_active_idx').on(table.accountClass, table.isActive)]);

// Maps an operational object (a cashbox, an expense category) to the account it posts to.
// Nothing in application source may hardcode an account id.
export const accountMappings = pgTable('account_mappings', {
  id: id(), mappingKey: text('mapping_key').notNull(), accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  description: text('description'), createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [uniqueIndex('account_mappings_key_unique').on(table.mappingKey), index('account_mappings_account_idx').on(table.accountId)]);

export const journalSequences = pgTable('journal_sequences', { year: integer('year').primaryKey(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });

export const journalEntries = pgTable('journal_entries', {
  id: id(), journalNumber: text('journal_number').notNull(), journalYear: integer('journal_year').notNull(), sequenceNumber: integer('sequence_number').notNull(),
  entryDate: timestamp('entry_date', { withTimezone: true }).notNull().defaultNow(), status: journalStatus('status').notNull().default('posted'),
  sourceType: journalSourceType('source_type').notNull(), sourceId: uuid('source_id'), sourceNumber: text('source_number'), postingEvent: text('posting_event').notNull(),
  description: text('description').notNull(), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }), partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  totalDebitUsd: numeric('total_debit_usd', { precision: 20, scale: 4 }).notNull(), totalCreditUsd: numeric('total_credit_usd', { precision: 20, scale: 4 }).notNull(),
  reversalOfJournalId: uuid('reversal_of_journal_id'), reversedByJournalId: uuid('reversed_by_journal_id'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), postedByUserId: uuid('posted_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(), ...timestamps,
}, table => [
  uniqueIndex('journal_entries_number_unique').on(table.journalNumber), uniqueIndex('journal_entries_year_sequence_unique').on(table.journalYear, table.sequenceNumber),
  uniqueIndex('journal_entries_source_event_unique').on(table.sourceType, table.sourceId, table.postingEvent).where(sql`${table.sourceId} is not null`),
  index('journal_entries_date_idx').on(table.entryDate), index('journal_entries_source_idx').on(table.sourceType, table.sourceId), index('journal_entries_warehouse_idx').on(table.warehouseId), index('journal_entries_partner_idx').on(table.partnerId),
  check('journal_entries_balanced_check', sql`${table.totalDebitUsd} = ${table.totalCreditUsd} and ${table.totalDebitUsd} > 0`),
]);

export const journalEntryLines = pgTable('journal_entry_lines', {
  id: id(), journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'restrict' }), lineNumber: integer('line_number').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  debitUsd: numeric('debit_usd', { precision: 20, scale: 4 }).notNull().default('0'), creditUsd: numeric('credit_usd', { precision: 20, scale: 4 }).notNull().default('0'),
  currency: cashCurrency('currency').notNull().default('USD'), originalAmount: numeric('original_amount', { precision: 20, scale: 4 }).notNull(), exchangeRateSypPerUsd: numeric('exchange_rate_syp_per_usd', { precision: 18, scale: 4 }).notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }), cashboxId: uuid('cashbox_id').references(() => cashboxes.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }), voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'restrict' }), cashboxTransferId: uuid('cashbox_transfer_id').references(() => cashboxTransfers.id, { onDelete: 'restrict' }),
  memo: text('memo'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('journal_entry_lines_entry_line_unique').on(table.journalEntryId, table.lineNumber),
  index('journal_entry_lines_entry_idx').on(table.journalEntryId), index('journal_entry_lines_account_idx').on(table.accountId), index('journal_entry_lines_partner_idx').on(table.partnerId), index('journal_entry_lines_cashbox_idx').on(table.cashboxId),
  check('journal_entry_lines_single_side_check', sql`(${table.debitUsd} > 0 and ${table.creditUsd} = 0) or (${table.creditUsd} > 0 and ${table.debitUsd} = 0)`),
  check('journal_entry_lines_amounts_check', sql`${table.debitUsd} >= 0 and ${table.creditUsd} >= 0 and ${table.originalAmount} > 0 and ${table.exchangeRateSypPerUsd} > 0`),
]);

// Gold is an obligation measured in grams at a stated karat, never in cash. A partner
// account holds what is owed between the shop and that partner; a company account holds
// the metal the shop physically has. Balances are always derived from the ledger.
//
// Sign convention, used everywhere: a positive net on a partner account means the
// partner owes the shop gold; a negative net means the shop owes the partner. On a
// company account a positive net is gold physically held.
// ذمم الأوزان: someone the shop hands gold to for work and expects back. A polisher or a
// craftsman is not a customer, so custody deliberately has its own light identity rather than
// pushing every worker into the commercial partners table.
export const weightCustodyPeople = pgTable('weight_custody_people', {
  id: id(),
  displayName: text('display_name').notNull(),
  // Trimmed and space-collapsed, so "أبو محمد" typed twice reuses one person instead of
  // creating a second. Genuinely different names stay different: nothing is fuzzy-merged.
  normalizedName: text('normalized_name').notNull(),
  phone: text('phone'),
  note: text('note'),
  // Optional identity reference only. Linking never changes the partner's commercial role.
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  isActive: boolean('is_active').notNull().default(true),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, table => [
  uniqueIndex('weight_custody_people_name_unique').on(table.normalizedName),
  uniqueIndex('weight_custody_people_partner_unique').on(table.partnerId).where(sql`${table.partnerId} is not null`),
  index('weight_custody_people_active_idx').on(table.isActive),
]);

export const goldAccounts = pgTable('gold_accounts', {
  id: id(), kind: goldAccountKind('kind').notNull(), name: text('name').notNull(), systemCode: text('system_code'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }), custodyPersonId: uuid('custody_person_id').references(() => weightCustodyPeople.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  isActive: boolean('is_active').notNull().default(true), notes: text('notes'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [
  uniqueIndex('gold_accounts_partner_unique').on(table.partnerId).where(sql`${table.partnerId} is not null`),
  uniqueIndex('gold_accounts_company_warehouse_unique').on(table.warehouseId).where(sql`${table.kind} = 'company' and ${table.warehouseId} is not null`),
  uniqueIndex('gold_accounts_system_code_unique').on(table.systemCode).where(sql`${table.systemCode} is not null`),
  index('gold_accounts_kind_idx').on(table.kind, table.isActive),
  uniqueIndex('gold_accounts_custody_person_unique').on(table.custodyPersonId).where(sql`${table.custodyPersonId} is not null`),
  // A custody account belongs to a person, a partner account to a partner, and a company
  // account to neither. The three are mutually exclusive by construction.
  check('gold_accounts_scope_check', sql`(${table.kind}::text = 'partner' and ${table.partnerId} is not null and ${table.custodyPersonId} is null) or (${table.kind}::text = 'company' and ${table.partnerId} is null and ${table.custodyPersonId} is null) or (${table.kind}::text = 'custody_person' and ${table.custodyPersonId} is not null and ${table.partnerId} is null)`),
]);

export const goldTransactionSequences = pgTable('gold_transaction_sequences', { year: integer('year').notNull(), type: text('type').notNull(), lastNumber: integer('last_number').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() }, table => [primaryKey({ columns: [table.year, table.type], name: 'gold_transaction_sequences_pk' })]);

export const goldTransactions = pgTable('gold_transactions', {
  id: id(), transactionNumber: text('transaction_number').notNull(), transactionYear: integer('transaction_year').notNull(), sequenceNumber: integer('sequence_number').notNull(),
  type: goldTransactionType('type').notNull(), status: goldTransactionStatus('status').notNull().default('posted'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  sourceType: text('source_type').notNull().default('manual'), sourceId: uuid('source_id'), sourceLineId: uuid('source_line_id'), sourceNumber: text('source_number'), postingEvent: text('posting_event').notNull(),
  description: text('description').notNull(), userNote: text('user_note'),
  reversalOfTransactionId: uuid('reversal_of_transaction_id'), reversedByTransactionId: uuid('reversed_by_transaction_id'),
  idempotencyKey: text('idempotency_key').notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), ...timestamps,
}, table => [
  uniqueIndex('gold_transactions_number_unique').on(table.transactionNumber), uniqueIndex('gold_transactions_idempotency_unique').on(table.idempotencyKey),
  uniqueIndex('gold_transactions_year_type_sequence_unique').on(table.transactionYear, table.type, table.sequenceNumber),
  uniqueIndex('gold_transactions_source_event_unique').on(table.sourceType, table.sourceId, table.sourceLineId, table.postingEvent).where(sql`${table.sourceId} is not null`),
  index('gold_transactions_partner_idx').on(table.partnerId, table.occurredAt), index('gold_transactions_type_status_idx').on(table.type, table.status), index('gold_transactions_source_idx').on(table.sourceType, table.sourceId),
]);

export const goldLedgerEntries = pgTable('gold_ledger_entries', {
  id: id(), goldTransactionId: uuid('gold_transaction_id').notNull().references(() => goldTransactions.id, { onDelete: 'restrict' }), lineNumber: integer('line_number').notNull(),
  goldAccountId: uuid('gold_account_id').notNull().references(() => goldAccounts.id, { onDelete: 'restrict' }),
  karat: text('karat').notNull(), debitGrams: numeric('debit_grams', { precision: 14, scale: 3 }).notNull().default('0'), creditGrams: numeric('credit_grams', { precision: 14, scale: 3 }).notNull().default('0'),
  pureGoldGrams: numeric('pure_gold_grams', { precision: 14, scale: 4 }).notNull(),
  goldPriceUsdPerGram: numeric('gold_price_usd_per_gram', { precision: 18, scale: 4 }), valuationUsd: numeric('valuation_usd', { precision: 18, scale: 4 }),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }), warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }), purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }), returnInvoiceId: uuid('return_invoice_id').references(() => returnInvoices.id, { onDelete: 'restrict' }), salesGoldExchangeId: uuid('sales_gold_exchange_id').references(() => salesGoldExchanges.id, { onDelete: 'restrict' }),
  description: text('description').notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(), actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('gold_ledger_entries_transaction_line_unique').on(table.goldTransactionId, table.lineNumber),
  index('gold_ledger_entries_account_karat_idx').on(table.goldAccountId, table.karat, table.occurredAt), index('gold_ledger_entries_partner_idx').on(table.partnerId, table.occurredAt), index('gold_ledger_entries_transaction_idx').on(table.goldTransactionId), index('gold_ledger_entries_sales_exchange_idx').on(table.salesGoldExchangeId),
  check('gold_ledger_entries_karat_check', sql`${table.karat} in ('24','22','21','18','14')`),
  check('gold_ledger_entries_single_side_check', sql`(${table.debitGrams} > 0 and ${table.creditGrams} = 0) or (${table.creditGrams} > 0 and ${table.debitGrams} = 0)`),
  check('gold_ledger_entries_amounts_check', sql`${table.debitGrams} >= 0 and ${table.creditGrams} >= 0`),
]);

// TASK 18: the shop's operating parameters. Until now these lived in each browser's
// localStorage, which meant two devices could price the same goods differently on the same day
// and the approved invoice printed a store name held in a browser. They belong on the server.
//
// `isProvisional` marks the seeded placeholder values. The real prices exist only in the manager's
// browser and cannot be read from here, so they are seeded obviously-wrong and flagged until a
// human enters the true ones — a plausible-looking wrong price is worse than a visible placeholder.
export const appSettings = pgTable('app_settings', {
  id: id(),
  // One shop, one row. The constraint enforces it so no code path can create a second and leave
  // the system asking which is real.
  singleton: boolean('singleton').notNull().default(true),
  storeName: text('store_name').notNull(), storeSubtitle: text('store_subtitle').notNull().default(''),
  address: text('address').notNull().default(''), branchName: text('branch_name').notNull().default(''),
  phone1: text('phone1').notNull().default(''), phone2: text('phone2').notNull().default(''),
  usdToSypRate: numeric('usd_to_syp_rate', { precision: 18, scale: 4 }).notNull(),
  baseGoldOunceUsd: numeric('base_gold_ounce_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  baseGoldGram24kUsd: numeric('base_gold_gram_24k_usd', { precision: 18, scale: 4 }).notNull().default('0'),
  buyMarginPercent: numeric('buy_margin_percent', { precision: 9, scale: 4 }).notNull().default('0'),
  sellMarginPercent: numeric('sell_margin_percent', { precision: 9, scale: 4 }).notNull().default('0'),
  taxRatePercent: numeric('tax_rate_percent', { precision: 9, scale: 4 }).notNull().default('0'),
  autoSyncGoldPrices: boolean('auto_sync_gold_prices').notNull().default(false),
  isProvisional: boolean('is_provisional').notNull().default(true),
  version: integer('version').notNull().default(1),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, table => [
  uniqueIndex('app_settings_singleton_unique').on(table.singleton),
  check('app_settings_singleton_check', sql`${table.singleton} = true`),
  check('app_settings_rate_check', sql`${table.usdToSypRate} > 0`),
]);

// One row per karat. Karats are never merged here any more than anywhere else in this system.
export const goldPrices = pgTable('gold_prices', {
  id: id(), karat: text('karat').notNull(),
  buyPriceUsdPerGram: numeric('buy_price_usd_per_gram', { precision: 16, scale: 4 }).notNull().default('0'),
  sellPriceUsdPerGram: numeric('sell_price_usd_per_gram', { precision: 16, scale: 4 }).notNull().default('0'),
  buyPriceSypPerGram: numeric('buy_price_syp_per_gram', { precision: 20, scale: 2 }).notNull().default('0'),
  sellPriceSypPerGram: numeric('sell_price_syp_per_gram', { precision: 20, scale: 2 }).notNull().default('0'),
  laborFeeUsdPerGram: numeric('labor_fee_usd_per_gram', { precision: 16, scale: 4 }).notNull().default('0'),
  version: integer('version').notNull().default(1),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, table => [
  uniqueIndex('gold_prices_karat_unique').on(table.karat),
  check('gold_prices_karat_check', sql`${table.karat} in ('24','22','21','18','14')`),
  check('gold_prices_amounts_check', sql`${table.buyPriceUsdPerGram} >= 0 and ${table.sellPriceUsdPerGram} >= 0 and ${table.buyPriceSypPerGram} >= 0 and ${table.sellPriceSypPerGram} >= 0 and ${table.laborFeeUsdPerGram} >= 0`),
]);

// Append-only, like every other ledger here: a correction is a new row, never an edit. This is
// what will later let a report say what the price was on the day of an invoice.
export const settingsHistory = pgTable('settings_history', {
  id: id(),
  scope: text('scope').notNull(), karat: text('karat'),
  field: text('field').notNull(), oldValue: text('old_value'), newValue: text('new_value').notNull(),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('settings_history_occurred_idx').on(table.occurredAt),
  index('settings_history_scope_field_idx').on(table.scope, table.field),
  check('settings_history_scope_check', sql`${table.scope} in ('general', 'gold_price')`),
]);

// TASK 20: one row per backup run, scheduled or manual. A backup nobody can see the state of is
// a backup nobody knows has stopped running - silent failure is the normal way these systems die.
export const backupRuns = pgTable('backup_runs', {
  id: id(),
  fileName: text('file_name').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('running'),
  checksum: text('checksum'),
  errorMessage: text('error_message'),
  // Null for a scheduled run: nobody asked for it, the timer did.
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, table => [
  index('backup_runs_started_idx').on(table.startedAt),
  index('backup_runs_status_idx').on(table.status),
  check('backup_runs_kind_check', sql`${table.kind} in ('scheduled', 'manual')`),
  check('backup_runs_status_check', sql`${table.status} in ('running', 'completed', 'failed')`),
]);

export type BackupRunRow = typeof backupRuns.$inferSelect;

export type AppSettingsRow = typeof appSettings.$inferSelect;
export type GoldPriceRow = typeof goldPrices.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type WarehouseRow = typeof warehouses.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
