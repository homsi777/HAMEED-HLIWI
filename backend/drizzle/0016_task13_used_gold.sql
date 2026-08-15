CREATE TYPE "public"."inventory_condition" AS ENUM('new', 'used');--> statement-breakpoint
-- PostgreSQL 12+ allows a new enum value inside a transaction as long as it is not used in the
-- same transaction. Nothing below writes these values, so this migration stays atomic.
ALTER TYPE "public"."inventory_movement_type" ADD VALUE IF NOT EXISTS 'gold_used_conversion';--> statement-breakpoint
ALTER TYPE "public"."inventory_movement_type" ADD VALUE IF NOT EXISTS 'gold_used_conversion_reversal';--> statement-breakpoint
ALTER TYPE "public"."gold_transaction_type" ADD VALUE IF NOT EXISTS 'used_inventory_conversion';--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "condition" "inventory_condition" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "source_type" text;--> statement-breakpoint
CREATE TABLE "gold_inventory_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"karat" text NOT NULL,
	"converted_weight_grams" numeric(14, 3) NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"gold_transaction_id" uuid NOT NULL,
	"manager_note" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by_user_id" uuid,
	"reversal_reason" text,
	"reversal_gold_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_inventory_conversions_weight_check" CHECK ("converted_weight_grams" > 0 and "quantity" > 0),
	CONSTRAINT "gold_inventory_conversions_status_check" CHECK ("status" in ('posted', 'reversed'))
);--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_gold_account_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_gold_transaction_id_fk" FOREIGN KEY ("gold_transaction_id") REFERENCES "public"."gold_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_reversal_gold_transaction_id_fk" FOREIGN KEY ("reversal_gold_transaction_id") REFERENCES "public"."gold_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_reversed_by_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_inventory_conversions" ADD CONSTRAINT "gic_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gold_inventory_conversions_idempotency_unique" ON "gold_inventory_conversions" USING btree ("idempotency_key");--> statement-breakpoint
-- One stock item is created by at most one conversion, so a reversal can never double back.
CREATE UNIQUE INDEX "gold_inventory_conversions_item_unique" ON "gold_inventory_conversions" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "gold_inventory_conversions_account_karat_idx" ON "gold_inventory_conversions" USING btree ("gold_account_id","karat","status");--> statement-breakpoint
CREATE INDEX "gold_inventory_conversions_warehouse_idx" ON "gold_inventory_conversions" USING btree ("warehouse_id","created_at");--> statement-breakpoint
-- Existing scrap is left exactly as it is: nothing is converted because this migration ran.
INSERT INTO "permissions" ("code", "description") VALUES ('gold_accounts.used_inventory.convert', 'gold_accounts.used_inventory.convert'), ('gold_accounts.used_inventory.reverse', 'gold_accounts.used_inventory.reverse') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" IN ('system_admin', 'general_manager') AND "permissions"."code" IN ('gold_accounts.used_inventory.convert', 'gold_accounts.used_inventory.reverse') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'warehouse_manager' AND "permissions"."code" = 'gold_accounts.used_inventory.convert' ON CONFLICT DO NOTHING;
