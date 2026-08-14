CREATE TYPE "public"."gold_account_kind" AS ENUM('partner', 'company');--> statement-breakpoint
CREATE TYPE "public"."gold_transaction_status" AS ENUM('posted', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."gold_transaction_type" AS ENUM('opening', 'sale_exchange', 'sales_return_obligation', 'purchase_settlement', 'purchase_return_adjustment', 'receipt', 'payment', 'conversion', 'reversal');--> statement-breakpoint
CREATE TABLE "gold_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "gold_account_kind" NOT NULL,
	"name" text NOT NULL,
	"system_code" text,
	"partner_id" uuid,
	"warehouse_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_accounts_scope_check" CHECK (("gold_accounts"."kind" = 'partner' and "gold_accounts"."partner_id" is not null) or ("gold_accounts"."kind" = 'company' and "gold_accounts"."partner_id" is null))
);
--> statement-breakpoint
CREATE TABLE "gold_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_transaction_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"gold_account_id" uuid NOT NULL,
	"karat" text NOT NULL,
	"debit_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"credit_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"pure_gold_grams" numeric(14, 4) NOT NULL,
	"gold_price_usd_per_gram" numeric(18, 4),
	"valuation_usd" numeric(18, 4),
	"partner_id" uuid,
	"warehouse_id" uuid,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"return_invoice_id" uuid,
	"sales_gold_exchange_id" uuid,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_ledger_entries_karat_check" CHECK ("gold_ledger_entries"."karat" in ('24','22','21','18','14')),
	CONSTRAINT "gold_ledger_entries_single_side_check" CHECK (("gold_ledger_entries"."debit_grams" > 0 and "gold_ledger_entries"."credit_grams" = 0) or ("gold_ledger_entries"."credit_grams" > 0 and "gold_ledger_entries"."debit_grams" = 0)),
	CONSTRAINT "gold_ledger_entries_amounts_check" CHECK ("gold_ledger_entries"."debit_grams" >= 0 and "gold_ledger_entries"."credit_grams" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gold_transaction_sequences" (
	"year" integer NOT NULL,
	"type" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_transaction_sequences_pk" PRIMARY KEY("year","type")
);
--> statement-breakpoint
CREATE TABLE "gold_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_number" text NOT NULL,
	"transaction_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"type" "gold_transaction_type" NOT NULL,
	"status" "gold_transaction_status" DEFAULT 'posted' NOT NULL,
	"partner_id" uuid,
	"warehouse_id" uuid,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"source_line_id" uuid,
	"source_number" text,
	"posting_event" text NOT NULL,
	"description" text NOT NULL,
	"user_note" text,
	"reversal_of_transaction_id" uuid,
	"reversed_by_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_gold_transaction_id_gold_transactions_id_fk" FOREIGN KEY ("gold_transaction_id") REFERENCES "public"."gold_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_sales_gold_exchange_id_sales_gold_exchanges_id_fk" FOREIGN KEY ("sales_gold_exchange_id") REFERENCES "public"."sales_gold_exchanges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_ledger_entries" ADD CONSTRAINT "gold_ledger_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_transactions" ADD CONSTRAINT "gold_transactions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_transactions" ADD CONSTRAINT "gold_transactions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_transactions" ADD CONSTRAINT "gold_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gold_accounts_partner_unique" ON "gold_accounts" USING btree ("partner_id") WHERE "gold_accounts"."partner_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gold_accounts_company_warehouse_unique" ON "gold_accounts" USING btree ("warehouse_id") WHERE "gold_accounts"."kind" = 'company' and "gold_accounts"."warehouse_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gold_accounts_system_code_unique" ON "gold_accounts" USING btree ("system_code") WHERE "gold_accounts"."system_code" is not null;--> statement-breakpoint
CREATE INDEX "gold_accounts_kind_idx" ON "gold_accounts" USING btree ("kind","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "gold_ledger_entries_transaction_line_unique" ON "gold_ledger_entries" USING btree ("gold_transaction_id","line_number");--> statement-breakpoint
CREATE INDEX "gold_ledger_entries_account_karat_idx" ON "gold_ledger_entries" USING btree ("gold_account_id","karat","occurred_at");--> statement-breakpoint
CREATE INDEX "gold_ledger_entries_partner_idx" ON "gold_ledger_entries" USING btree ("partner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "gold_ledger_entries_transaction_idx" ON "gold_ledger_entries" USING btree ("gold_transaction_id");--> statement-breakpoint
CREATE INDEX "gold_ledger_entries_sales_exchange_idx" ON "gold_ledger_entries" USING btree ("sales_gold_exchange_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gold_transactions_number_unique" ON "gold_transactions" USING btree ("transaction_number");--> statement-breakpoint
CREATE UNIQUE INDEX "gold_transactions_idempotency_unique" ON "gold_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gold_transactions_year_type_sequence_unique" ON "gold_transactions" USING btree ("transaction_year","type","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "gold_transactions_source_event_unique" ON "gold_transactions" USING btree ("source_type","source_id","source_line_id","posting_event") WHERE "gold_transactions"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "gold_transactions_partner_idx" ON "gold_transactions" USING btree ("partner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "gold_transactions_type_status_idx" ON "gold_transactions" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "gold_transactions_source_idx" ON "gold_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
INSERT INTO "permissions" ("code", "description") VALUES ('gold_accounts.view', 'gold_accounts.view'), ('gold_accounts.transaction.create', 'gold_accounts.transaction.create'), ('gold_accounts.adjust', 'gold_accounts.adjust'), ('gold_accounts.convert', 'gold_accounts.convert'), ('gold_accounts.reverse', 'gold_accounts.reverse') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'system_admin' AND "permissions"."code" IN ('gold_accounts.view', 'gold_accounts.transaction.create', 'gold_accounts.adjust', 'gold_accounts.convert', 'gold_accounts.reverse') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'warehouse_manager' AND "permissions"."code" IN ('gold_accounts.view', 'gold_accounts.transaction.create') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'sales' AND "permissions"."code" = 'gold_accounts.view' ON CONFLICT DO NOTHING;
