CREATE TYPE "public"."account_class" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."account_normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."journal_source_type" AS ENUM('manual', 'opening', 'sale', 'purchase', 'sales_return', 'purchase_return', 'voucher', 'cashbox_transfer');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('posted', 'reversed');--> statement-breakpoint
CREATE TABLE "account_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"parent_account_id" uuid,
	"account_class" "account_class" NOT NULL,
	"normal_balance" "account_normal_balance" NOT NULL,
	"allows_posting" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"warehouse_id" uuid,
	"currency" "cash_currency",
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_number" text NOT NULL,
	"journal_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "journal_status" DEFAULT 'posted' NOT NULL,
	"source_type" "journal_source_type" NOT NULL,
	"source_id" uuid,
	"source_number" text,
	"posting_event" text NOT NULL,
	"description" text NOT NULL,
	"warehouse_id" uuid,
	"partner_id" uuid,
	"total_debit_usd" numeric(20, 4) NOT NULL,
	"total_credit_usd" numeric(20, 4) NOT NULL,
	"reversal_of_journal_id" uuid,
	"reversed_by_journal_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_balanced_check" CHECK ("journal_entries"."total_debit_usd" = "journal_entries"."total_credit_usd" and "journal_entries"."total_debit_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_usd" numeric(20, 4) DEFAULT '0' NOT NULL,
	"credit_usd" numeric(20, 4) DEFAULT '0' NOT NULL,
	"currency" "cash_currency" DEFAULT 'USD' NOT NULL,
	"original_amount" numeric(20, 4) NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4) NOT NULL,
	"partner_id" uuid,
	"cashbox_id" uuid,
	"warehouse_id" uuid,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"return_invoice_id" uuid,
	"voucher_id" uuid,
	"cashbox_transfer_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_lines_single_side_check" CHECK (("journal_entry_lines"."debit_usd" > 0 and "journal_entry_lines"."credit_usd" = 0) or ("journal_entry_lines"."credit_usd" > 0 and "journal_entry_lines"."debit_usd" = 0)),
	CONSTRAINT "journal_entry_lines_amounts_check" CHECK ("journal_entry_lines"."debit_usd" >= 0 and "journal_entry_lines"."credit_usd" >= 0 and "journal_entry_lines"."original_amount" > 0 and "journal_entry_lines"."exchange_rate_syp_per_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_cashbox_id_cashboxes_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_cashbox_transfer_id_cashbox_transfers_id_fk" FOREIGN KEY ("cashbox_transfer_id") REFERENCES "public"."cashbox_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_mappings_key_unique" ON "account_mappings" USING btree ("mapping_key");--> statement-breakpoint
CREATE INDEX "account_mappings_account_idx" ON "account_mappings" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_unique" ON "accounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_system_key_unique" ON "accounts" USING btree ("system_key") WHERE "accounts"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_account_id");--> statement-breakpoint
CREATE INDEX "accounts_class_active_idx" ON "accounts" USING btree ("account_class","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_number_unique" ON "journal_entries" USING btree ("journal_number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_year_sequence_unique" ON "journal_entries" USING btree ("journal_year","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_source_event_unique" ON "journal_entries" USING btree ("source_type","source_id","posting_event") WHERE "journal_entries"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_warehouse_idx" ON "journal_entries" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "journal_entries_partner_idx" ON "journal_entries" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_lines_entry_line_unique" ON "journal_entry_lines" USING btree ("journal_entry_id","line_number");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_entry_idx" ON "journal_entry_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_account_idx" ON "journal_entry_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_partner_idx" ON "journal_entry_lines" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_cashbox_idx" ON "journal_entry_lines" USING btree ("cashbox_id");--> statement-breakpoint
INSERT INTO "permissions" ("code", "description") VALUES ('accounting.view', 'accounting.view'), ('accounting.accounts.manage', 'accounting.accounts.manage'), ('accounting.journal.create', 'accounting.journal.create'), ('accounting.journal.post', 'accounting.journal.post'), ('accounting.journal.reverse', 'accounting.journal.reverse') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'system_admin' AND "permissions"."code" IN ('accounting.view', 'accounting.accounts.manage', 'accounting.journal.create', 'accounting.journal.post', 'accounting.journal.reverse') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'warehouse_manager' AND "permissions"."code" = 'accounting.view' ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "accounts" ("code", "name_ar", "name_en", "account_class", "normal_balance", "allows_posting", "is_system", "system_key", "created_by_user_id", "updated_by_user_id")
SELECT seed."code", seed."name_ar", seed."name_en", seed."account_class"::"account_class", seed."normal_balance"::"account_normal_balance", seed."allows_posting", true, seed."system_key", "owner"."id", "owner"."id"
FROM (VALUES
  ('1',   'الأصول',                    'Assets',                 'asset',     'debit',  false, NULL),
  ('11',  'النقدية والصناديق',          'Cash and Cashboxes',     'asset',     'debit',  false, 'cash_parent'),
  ('111', 'نقدية بالدولار',             'Cash USD',               'asset',     'debit',  false, 'cash_usd_parent'),
  ('112', 'نقدية بالليرة السورية',       'Cash SYP',               'asset',     'debit',  false, 'cash_syp_parent'),
  ('12',  'ذمم العملاء المدينة',         'Accounts Receivable',    'asset',     'debit',  true,  'accounts_receivable'),
  ('13',  'المخزون والمشتريات',          'Inventory and Purchases','asset',     'debit',  true,  'inventory'),
  ('2',   'الخصوم',                     'Liabilities',            'liability', 'credit', false, NULL),
  ('21',  'ذمم الموردين الدائنة',        'Accounts Payable',       'liability', 'credit', true,  'accounts_payable'),
  ('3',   'حقوق الملكية',                'Equity',                 'equity',    'credit', false, NULL),
  ('31',  'الأرصدة الافتتاحية',          'Opening Equity',         'equity',    'credit', true,  'opening_equity'),
  ('4',   'الإيرادات',                   'Revenue',                'revenue',   'credit', false, NULL),
  ('41',  'إيرادات المبيعات',            'Sales Revenue',          'revenue',   'credit', true,  'sales_revenue'),
  ('42',  'مردودات المبيعات',            'Sales Returns',          'revenue',   'debit',  true,  'sales_returns'),
  ('5',   'المصاريف',                    'Expenses',               'expense',   'debit',  false, NULL),
  ('51',  'المصاريف التشغيلية',          'Operating Expenses',     'expense',   'debit',  true,  'operating_expenses')
) AS seed("code", "name_ar", "name_en", "account_class", "normal_balance", "allows_posting", "system_key")
CROSS JOIN LATERAL (SELECT "users"."id" FROM "users" ORDER BY "users"."created_at", "users"."id" LIMIT 1) AS "owner"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "accounts" SET "parent_account_id" = "parent"."id" FROM "accounts" AS "parent" WHERE "parent"."code" = left("accounts"."code", length("accounts"."code") - 1) AND length("accounts"."code") > 1 AND "accounts"."parent_account_id" IS NULL;
