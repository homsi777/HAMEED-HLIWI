CREATE TYPE "public"."return_invoice_status" AS ENUM('posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."return_payment_method" AS ENUM('cash_usd', 'cash_syp', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."return_type" AS ENUM('sales_return', 'purchase_return');--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'sales_return';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'purchase_return';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'return_cancellation';--> statement-breakpoint
CREATE TABLE "return_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"source_sales_invoice_item_id" uuid,
	"source_purchase_invoice_item_id" uuid,
	"inventory_item_id" uuid,
	"item_code_snapshot" text,
	"item_name_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"karat_snapshot" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"gross_weight_grams" numeric(14, 3) NOT NULL,
	"stone_weight_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_weight_grams" numeric(14, 3) NOT NULL,
	"gold_price_usd_per_gram" numeric(18, 4) NOT NULL,
	"workmanship_usd_per_gram" numeric(18, 4) NOT NULL,
	"gold_value_usd" numeric(18, 4) NOT NULL,
	"workmanship_value_usd" numeric(18, 4) NOT NULL,
	"line_gross_usd" numeric(18, 4) NOT NULL,
	"discount_allocated_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"scrap_credit_allocated_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_total_usd" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_invoice_items_source_check" CHECK (("return_invoice_items"."source_sales_invoice_item_id" is not null and "return_invoice_items"."source_purchase_invoice_item_id" is null) or ("return_invoice_items"."source_purchase_invoice_item_id" is not null and "return_invoice_items"."source_sales_invoice_item_id" is null)),
	CONSTRAINT "return_invoice_items_amounts_check" CHECK ("return_invoice_items"."quantity" > 0 and "return_invoice_items"."net_weight_grams" > 0 and "return_invoice_items"."gross_weight_grams" > 0 and "return_invoice_items"."line_gross_usd" >= 0 and "return_invoice_items"."line_total_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "return_invoice_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_number" text NOT NULL,
	"return_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"type" "return_type" NOT NULL,
	"status" "return_invoice_status" DEFAULT 'posted' NOT NULL,
	"original_sales_invoice_id" uuid,
	"original_purchase_invoice_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_name_snapshot" text NOT NULL,
	"partner_phone_snapshot" text,
	"reason" text NOT NULL,
	"gold_subtotal_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"workmanship_subtotal_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"return_gross_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_allocated_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"scrap_credit_allocated_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"final_total_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"final_total_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"refunded_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"refunded_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"refunded_syp_in_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"outstanding_adjustment_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4) NOT NULL,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_invoices_source_check" CHECK (("return_invoices"."type" = 'sales_return' and "return_invoices"."original_sales_invoice_id" is not null and "return_invoices"."original_purchase_invoice_id" is null) or ("return_invoices"."type" = 'purchase_return' and "return_invoices"."original_purchase_invoice_id" is not null and "return_invoices"."original_sales_invoice_id" is null)),
	CONSTRAINT "return_invoices_amounts_check" CHECK ("return_invoices"."return_gross_usd" >= 0 and "return_invoices"."discount_allocated_usd" >= 0 and "return_invoices"."scrap_credit_allocated_usd" >= 0 and "return_invoices"."final_total_usd" >= 0 and "return_invoices"."refunded_usd" >= 0 and "return_invoices"."refunded_syp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "return_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_invoice_id" uuid NOT NULL,
	"method" "return_payment_method" NOT NULL,
	"amount_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4),
	"applied_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_payments_amounts_check" CHECK ("return_payments"."amount_usd" >= 0 and "return_payments"."amount_syp" >= 0 and "return_payments"."applied_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "return_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "return_invoice_items" ADD CONSTRAINT "return_invoice_items_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoice_items" ADD CONSTRAINT "return_invoice_items_source_sales_invoice_item_id_sales_invoice_items_id_fk" FOREIGN KEY ("source_sales_invoice_item_id") REFERENCES "public"."sales_invoice_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoice_items" ADD CONSTRAINT "return_invoice_items_source_purchase_invoice_item_id_purchase_invoice_items_id_fk" FOREIGN KEY ("source_purchase_invoice_item_id") REFERENCES "public"."purchase_invoice_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoice_items" ADD CONSTRAINT "return_invoice_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_original_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("original_sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_original_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("original_purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_payments" ADD CONSTRAINT "return_payments_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_invoice_items_return_line_unique" ON "return_invoice_items" USING btree ("return_invoice_id","line_number");--> statement-breakpoint
CREATE INDEX "return_invoice_items_return_idx" ON "return_invoice_items" USING btree ("return_invoice_id");--> statement-breakpoint
CREATE INDEX "return_invoice_items_source_sale_line_idx" ON "return_invoice_items" USING btree ("source_sales_invoice_item_id");--> statement-breakpoint
CREATE INDEX "return_invoice_items_source_purchase_line_idx" ON "return_invoice_items" USING btree ("source_purchase_invoice_item_id");--> statement-breakpoint
CREATE INDEX "return_invoice_items_inventory_idx" ON "return_invoice_items" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_invoices_number_unique" ON "return_invoices" USING btree ("return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "return_invoices_idempotency_key_unique" ON "return_invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "return_invoices_year_sequence_unique" ON "return_invoices" USING btree ("return_year","sequence_number");--> statement-breakpoint
CREATE INDEX "return_invoices_warehouse_date_idx" ON "return_invoices" USING btree ("warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "return_invoices_partner_date_idx" ON "return_invoices" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "return_invoices_type_status_idx" ON "return_invoices" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "return_invoices_original_sale_idx" ON "return_invoices" USING btree ("original_sales_invoice_id");--> statement-breakpoint
CREATE INDEX "return_invoices_original_purchase_idx" ON "return_invoices" USING btree ("original_purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "return_payments_return_idx" ON "return_payments" USING btree ("return_invoice_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_return_invoice_idx" ON "inventory_movements" USING btree ("return_invoice_id");--> statement-breakpoint
INSERT INTO "permissions" ("code", "description") VALUES ('returns.view', 'returns.view'), ('returns.create', 'returns.create'), ('returns.cancel', 'returns.cancel') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'system_admin' AND "permissions"."code" IN ('returns.view', 'returns.create', 'returns.cancel') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'warehouse_manager' AND "permissions"."code" IN ('returns.view', 'returns.create') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'sales' AND "permissions"."code" = 'returns.view' ON CONFLICT DO NOTHING;