CREATE TYPE "public"."sales_invoice_status" AS ENUM('posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sales_line_type" AS ENUM('stock', 'manual');--> statement-breakpoint
CREATE TYPE "public"."sales_payment_method" AS ENUM('cash_usd', 'cash_syp', 'gold_exchange', 'debt', 'mixed');--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'sale';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'manual_sale';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'sale_cancellation';--> statement-breakpoint
CREATE TABLE "sales_gold_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"karat" text NOT NULL,
	"weight_grams" numeric(14, 3) NOT NULL,
	"evaluation_price_usd_per_gram" numeric(18, 4) NOT NULL,
	"value_usd" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_gold_exchanges_karat_check" CHECK ("sales_gold_exchanges"."karat" in ('24','22','21','18','14'))
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"line_type" "sales_line_type" NOT NULL,
	"inventory_item_id" uuid,
	"item_code_snapshot" text,
	"item_name_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"karat_snapshot" text NOT NULL,
	"gross_weight_grams" numeric(14, 3) NOT NULL,
	"stone_weight_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_weight_grams" numeric(14, 3) NOT NULL,
	"gold_price_usd_per_gram" numeric(18, 4) NOT NULL,
	"workmanship_usd_per_gram" numeric(18, 4) NOT NULL,
	"gold_value_usd" numeric(18, 4) NOT NULL,
	"workmanship_value_usd" numeric(18, 4) NOT NULL,
	"line_total_usd" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"status" "sales_invoice_status" DEFAULT 'posted' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"customer_partner_id" uuid NOT NULL,
	"customer_name_snapshot" text NOT NULL,
	"customer_phone_snapshot" text,
	"gold_subtotal_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"workmanship_subtotal_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"scrap_total_value_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"final_total_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"final_total_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"paid_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"paid_syp_in_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remaining_debt_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"payment_method" "sales_payment_method" NOT NULL,
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
CREATE TABLE "sales_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"method" "sales_payment_method" NOT NULL,
	"amount_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"exchange_rate_syp_per_usd" numeric(18, 4),
	"applied_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_payments_amounts_check" CHECK ("sales_payments"."amount_usd" >= 0 and "sales_payments"."amount_syp" >= 0 and "sales_payments"."applied_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_weights_check";--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "quantity" numeric(14, 3) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "is_manual_sale_entry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "sales_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_gold_exchanges" ADD CONSTRAINT "sales_gold_exchanges_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_partner_id_partners_id_fk" FOREIGN KEY ("customer_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_gold_exchanges_invoice_idx" ON "sales_gold_exchanges" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_items_invoice_line_unique" ON "sales_invoice_items" USING btree ("sales_invoice_id","line_number");--> statement-breakpoint
CREATE INDEX "sales_invoice_items_inventory_idx" ON "sales_invoice_items" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_items_invoice_idx" ON "sales_invoice_items" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_number_unique" ON "sales_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_idempotency_key_unique" ON "sales_invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_year_sequence_unique" ON "sales_invoices" USING btree ("invoice_year","sequence_number");--> statement-breakpoint
CREATE INDEX "sales_invoices_warehouse_date_idx" ON "sales_invoices" USING btree ("warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "sales_invoices" USING btree ("customer_partner_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_status_created_idx" ON "sales_invoices" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sales_payments_invoice_idx" ON "sales_payments" USING btree ("sales_invoice_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_sale_invoice_idx" ON "inventory_movements" USING btree ("sales_invoice_id");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_check" CHECK (("inventory_items"."is_manual_sale_entry" = true and "inventory_items"."quantity" = -1) or ("inventory_items"."is_manual_sale_entry" = false and "inventory_items"."quantity" > 0));--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_weights_check" CHECK (("inventory_items"."is_manual_sale_entry" = true and "inventory_items"."gross_weight_grams" < 0 and "inventory_items"."stone_weight_grams" <= 0 and "inventory_items"."net_weight_grams" < 0) or ("inventory_items"."is_manual_sale_entry" = false and "inventory_items"."gross_weight_grams" > 0 and "inventory_items"."stone_weight_grams" >= 0 and "inventory_items"."net_weight_grams" >= 0 and "inventory_items"."gross_weight_grams" >= "inventory_items"."stone_weight_grams"));