CREATE TYPE "public"."purchase_invoice_status" AS ENUM('posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."purchase_payment_method" AS ENUM('cash_usd', 'cash_syp', 'debt', 'mixed');--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'purchase';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'legacy_reconciliation';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'purchase_cancellation';--> statement-breakpoint
CREATE TABLE "purchase_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"received_inventory_item_id" uuid,
	"reconciliation_target_inventory_item_id" uuid,
	"item_code_snapshot" text NOT NULL,
	"item_name_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"karat_snapshot" text NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"gross_weight_grams" numeric(14, 3) NOT NULL,
	"stone_weight_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_weight_grams" numeric(14, 3) NOT NULL,
	"gold_price_usd_per_gram" numeric(18, 4) NOT NULL,
	"workmanship_usd_per_gram" numeric(18, 4) NOT NULL,
	"gold_value_usd" numeric(18, 4) NOT NULL,
	"workmanship_value_usd" numeric(18, 4) NOT NULL,
	"line_total_usd" numeric(18, 4) NOT NULL,
	"reconciled_quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reconciled_net_weight_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_number" text NOT NULL,
	"purchase_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"status" "purchase_invoice_status" DEFAULT 'posted' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"supplier_partner_id" uuid NOT NULL,
	"supplier_name_snapshot" text NOT NULL,
	"supplier_phone_snapshot" text,
	"gold_subtotal_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"workmanship_subtotal_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"final_total_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"final_total_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"paid_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"paid_syp_in_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remaining_debt_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"payment_method" "purchase_payment_method" NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4) NOT NULL,
	"notes" text,
	"item_photo_data" text,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"method" "purchase_payment_method" NOT NULL,
	"amount_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4),
	"applied_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_payments_amounts_check" CHECK ("purchase_payments"."amount_usd" >= 0 and "purchase_payments"."amount_syp" >= 0 and "purchase_payments"."applied_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_quantity_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "purchase_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_received_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("received_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_reconciliation_target_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("reconciliation_target_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_partner_id_partners_id_fk" FOREIGN KEY ("supplier_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_items_invoice_line_unique" ON "purchase_invoice_items" USING btree ("purchase_invoice_id","line_number");--> statement-breakpoint
CREATE INDEX "purchase_invoice_items_received_inventory_idx" ON "purchase_invoice_items" USING btree ("received_inventory_item_id");--> statement-breakpoint
CREATE INDEX "purchase_invoice_items_reconciliation_idx" ON "purchase_invoice_items" USING btree ("reconciliation_target_inventory_item_id");--> statement-breakpoint
CREATE INDEX "purchase_invoice_items_invoice_idx" ON "purchase_invoice_items" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_number_unique" ON "purchase_invoices" USING btree ("purchase_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_idempotency_key_unique" ON "purchase_invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_year_sequence_unique" ON "purchase_invoices" USING btree ("purchase_year","sequence_number");--> statement-breakpoint
CREATE INDEX "purchase_invoices_warehouse_date_idx" ON "purchase_invoices" USING btree ("warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_date_idx" ON "purchase_invoices" USING btree ("supplier_partner_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_invoices_status_created_idx" ON "purchase_invoices" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_payments_invoice_idx" ON "purchase_payments" USING btree ("purchase_invoice_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_purchase_invoice_idx" ON "inventory_movements" USING btree ("purchase_invoice_id");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_check" CHECK (("inventory_items"."is_manual_sale_entry" = true and "inventory_items"."quantity" < 0) or ("inventory_items"."is_manual_sale_entry" = false and "inventory_items"."quantity" > 0));
--> statement-breakpoint
INSERT INTO "permissions" ("code", "description") VALUES ('purchases.view', 'purchases.view'), ('purchases.create', 'purchases.create'), ('purchases.cancel', 'purchases.cancel') ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE (r."name" = 'system_admin' OR (r."name" = 'warehouse_manager' AND p."code" IN ('purchases.view', 'purchases.create'))) AND p."code" IN ('purchases.view', 'purchases.create', 'purchases.cancel')
ON CONFLICT DO NOTHING;
