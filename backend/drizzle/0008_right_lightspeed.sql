CREATE TYPE "public"."cash_currency" AS ENUM('USD', 'SYP');--> statement-breakpoint
CREATE TYPE "public"."cash_movement_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TYPE "public"."partner_ledger_entry_type" AS ENUM('opening', 'sale', 'purchase', 'sales_return', 'purchase_return', 'receipt', 'payment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."voucher_source_type" AS ENUM('manual', 'sale', 'purchase', 'sales_return', 'purchase_return', 'cashbox_transfer', 'expense');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."voucher_type" AS ENUM('receipt', 'payment', 'expense');--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cashbox_id" uuid NOT NULL,
	"voucher_id" uuid,
	"cashbox_transfer_id" uuid,
	"direction" "cash_movement_direction" NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" "cash_currency" NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4) NOT NULL,
	"amount_usd_equivalent" numeric(18, 4) NOT NULL,
	"partner_id" uuid,
	"warehouse_id" uuid,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"return_invoice_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_amount_check" CHECK ("cash_movements"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "cashbox_transfer_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashbox_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_number" text NOT NULL,
	"transfer_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"status" "voucher_status" DEFAULT 'posted' NOT NULL,
	"from_cashbox_id" uuid NOT NULL,
	"to_cashbox_id" uuid NOT NULL,
	"amount_from" numeric(20, 4) NOT NULL,
	"amount_to" numeric(20, 4) NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4),
	"note" text,
	"idempotency_key" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbox_transfers_amounts_check" CHECK ("cashbox_transfers"."amount_from" > 0 and "cashbox_transfers"."amount_to" > 0),
	CONSTRAINT "cashbox_transfers_distinct_check" CHECK ("cashbox_transfers"."from_cashbox_id" <> "cashbox_transfers"."to_cashbox_id")
);
--> statement-breakpoint
CREATE TABLE "cashboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" "cash_currency" NOT NULL,
	"warehouse_id" uuid,
	"opening_balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashboxes_opening_balance_check" CHECK ("cashboxes"."opening_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"entry_type" "partner_ledger_entry_type" NOT NULL,
	"debit_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credit_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" "cash_currency" DEFAULT 'USD' NOT NULL,
	"original_amount" numeric(20, 4) NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4) NOT NULL,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"return_invoice_id" uuid,
	"voucher_id" uuid,
	"document_number" text,
	"description" text NOT NULL,
	"warehouse_id" uuid,
	"reversal_of_entry_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_ledger_amounts_check" CHECK ("partner_ledger_entries"."debit_usd" >= 0 and "partner_ledger_entries"."credit_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "voucher_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"return_invoice_id" uuid,
	"amount_usd" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_allocations_amount_check" CHECK ("voucher_allocations"."amount_usd" > 0),
	CONSTRAINT "voucher_allocations_target_check" CHECK (("voucher_allocations"."sales_invoice_id" is not null)::int + ("voucher_allocations"."purchase_invoice_id" is not null)::int + ("voucher_allocations"."return_invoice_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "voucher_sequences" (
	"year" integer NOT NULL,
	"type" "voucher_type" NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_sequences_pk" PRIMARY KEY("year","type")
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_number" text NOT NULL,
	"voucher_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"type" "voucher_type" NOT NULL,
	"status" "voucher_status" DEFAULT 'posted' NOT NULL,
	"source_type" "voucher_source_type" DEFAULT 'manual' NOT NULL,
	"source_document_number" text,
	"source_payment_id" uuid,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"return_invoice_id" uuid,
	"cashbox_transfer_id" uuid,
	"partner_id" uuid,
	"partner_name_snapshot" text,
	"cashbox_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"currency" "cash_currency" NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4) NOT NULL,
	"amount_usd_equivalent" numeric(18, 4) NOT NULL,
	"expense_category" text,
	"system_note" text,
	"user_note" text,
	"reversal_of_voucher_id" uuid,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_amount_check" CHECK ("vouchers"."amount" > 0 and "vouchers"."amount_usd_equivalent" >= 0 and "vouchers"."exchange_rate_syp_per_usd" > 0),
	CONSTRAINT "vouchers_expense_partner_check" CHECK ("vouchers"."type" <> 'expense' or "vouchers"."partner_id" is null)
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashbox_id_cashboxes_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashbox_transfer_id_cashbox_transfers_id_fk" FOREIGN KEY ("cashbox_transfer_id") REFERENCES "public"."cashbox_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox_transfers" ADD CONSTRAINT "cashbox_transfers_from_cashbox_id_cashboxes_id_fk" FOREIGN KEY ("from_cashbox_id") REFERENCES "public"."cashboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox_transfers" ADD CONSTRAINT "cashbox_transfers_to_cashbox_id_cashboxes_id_fk" FOREIGN KEY ("to_cashbox_id") REFERENCES "public"."cashboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox_transfers" ADD CONSTRAINT "cashbox_transfers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox_transfers" ADD CONSTRAINT "cashbox_transfers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_allocations" ADD CONSTRAINT "voucher_allocations_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_allocations" ADD CONSTRAINT "voucher_allocations_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_allocations" ADD CONSTRAINT "voucher_allocations_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_allocations" ADD CONSTRAINT "voucher_allocations_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_cashbox_transfer_id_cashbox_transfers_id_fk" FOREIGN KEY ("cashbox_transfer_id") REFERENCES "public"."cashbox_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_cashbox_id_cashboxes_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_cashbox_created_idx" ON "cash_movements" USING btree ("cashbox_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_movements_voucher_idx" ON "cash_movements" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "cash_movements_partner_idx" ON "cash_movements" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "cash_movements_transfer_idx" ON "cash_movements" USING btree ("cashbox_transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cashbox_transfers_number_unique" ON "cashbox_transfers" USING btree ("transfer_number");--> statement-breakpoint
CREATE UNIQUE INDEX "cashbox_transfers_idempotency_unique" ON "cashbox_transfers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cashbox_transfers_year_sequence_unique" ON "cashbox_transfers" USING btree ("transfer_year","sequence_number");--> statement-breakpoint
CREATE INDEX "cashbox_transfers_created_idx" ON "cashbox_transfers" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cashboxes_warehouse_name_unique" ON "cashboxes" USING btree ("warehouse_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cashboxes_default_per_warehouse_currency" ON "cashboxes" USING btree ("warehouse_id","currency") WHERE "cashboxes"."is_default" = true and "cashboxes"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "cashboxes_warehouse_currency_idx" ON "cashboxes" USING btree ("warehouse_id","currency","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_unique" ON "expense_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "partner_ledger_partner_occurred_idx" ON "partner_ledger_entries" USING btree ("partner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "partner_ledger_voucher_idx" ON "partner_ledger_entries" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "partner_ledger_sales_invoice_idx" ON "partner_ledger_entries" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "partner_ledger_purchase_invoice_idx" ON "partner_ledger_entries" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "partner_ledger_return_invoice_idx" ON "partner_ledger_entries" USING btree ("return_invoice_id");--> statement-breakpoint
CREATE INDEX "voucher_allocations_voucher_idx" ON "voucher_allocations" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_allocations_sales_invoice_idx" ON "voucher_allocations" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "voucher_allocations_purchase_invoice_idx" ON "voucher_allocations" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_number_unique" ON "vouchers" USING btree ("voucher_number");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_idempotency_unique" ON "vouchers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_year_type_sequence_unique" ON "vouchers" USING btree ("voucher_year","type","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_source_payment_unique" ON "vouchers" USING btree ("source_type","source_payment_id") WHERE "vouchers"."source_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "vouchers_cashbox_created_idx" ON "vouchers" USING btree ("cashbox_id","created_at");--> statement-breakpoint
CREATE INDEX "vouchers_partner_created_idx" ON "vouchers" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "vouchers_type_status_created_idx" ON "vouchers" USING btree ("type","status","created_at");--> statement-breakpoint
CREATE INDEX "vouchers_sales_invoice_idx" ON "vouchers" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "vouchers_purchase_invoice_idx" ON "vouchers" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "vouchers_return_invoice_idx" ON "vouchers" USING btree ("return_invoice_id");--> statement-breakpoint
INSERT INTO "permissions" ("code", "description") VALUES ('finance.view', 'finance.view'), ('finance.voucher.create', 'finance.voucher.create'), ('finance.voucher.cancel', 'finance.voucher.cancel'), ('finance.cashbox.manage', 'finance.cashbox.manage'), ('finance.transfer', 'finance.transfer') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'system_admin' AND "permissions"."code" IN ('finance.view', 'finance.voucher.create', 'finance.voucher.cancel', 'finance.cashbox.manage', 'finance.transfer') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'warehouse_manager' AND "permissions"."code" IN ('finance.view', 'finance.voucher.create') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'sales' AND "permissions"."code" = 'finance.view' ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "cashboxes" ("name", "currency", "warehouse_id", "opening_balance", "is_default", "created_by_user_id", "updated_by_user_id") SELECT 'صندوق ' || "warehouses"."name" || ' - دولار', 'USD', "warehouses"."id", '0', true, "owner"."id", "owner"."id" FROM "warehouses" CROSS JOIN LATERAL (SELECT "users"."id" FROM "users" ORDER BY "users"."created_at", "users"."id" LIMIT 1) AS "owner" WHERE NOT EXISTS (SELECT 1 FROM "cashboxes" WHERE "cashboxes"."warehouse_id" = "warehouses"."id" AND "cashboxes"."currency" = 'USD');--> statement-breakpoint
INSERT INTO "cashboxes" ("name", "currency", "warehouse_id", "opening_balance", "is_default", "created_by_user_id", "updated_by_user_id") SELECT 'صندوق ' || "warehouses"."name" || ' - ليرة سورية', 'SYP', "warehouses"."id", '0', true, "owner"."id", "owner"."id" FROM "warehouses" CROSS JOIN LATERAL (SELECT "users"."id" FROM "users" ORDER BY "users"."created_at", "users"."id" LIMIT 1) AS "owner" WHERE NOT EXISTS (SELECT 1 FROM "cashboxes" WHERE "cashboxes"."warehouse_id" = "warehouses"."id" AND "cashboxes"."currency" = 'SYP');
