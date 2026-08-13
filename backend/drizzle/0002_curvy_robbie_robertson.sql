CREATE TYPE "public"."inventory_movement_type" AS ENUM('initial', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('in_stock', 'reserved', 'sold');--> statement-breakpoint
CREATE TYPE "public"."stocktake_status" AS ENUM('completed');--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"karat" text NOT NULL,
	"gross_weight_grams" numeric(14, 3) NOT NULL,
	"stone_weight_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_weight_grams" numeric(14, 3) NOT NULL,
	"labor_fee_usd_per_gram" numeric(16, 4) DEFAULT '0' NOT NULL,
	"total_labor_fee_usd" numeric(16, 4) DEFAULT '0' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "inventory_status" DEFAULT 'in_stock' NOT NULL,
	"image_path" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_karat_check" CHECK ("inventory_items"."karat" in ('24','22','21','18','14')),
	CONSTRAINT "inventory_items_weights_check" CHECK ("inventory_items"."gross_weight_grams" > 0 and "inventory_items"."stone_weight_grams" >= 0 and "inventory_items"."net_weight_grams" >= 0 and "inventory_items"."gross_weight_grams" >= "inventory_items"."stone_weight_grams"),
	CONSTRAINT "inventory_items_labor_check" CHECK ("inventory_items"."labor_fee_usd_per_gram" >= 0 and "inventory_items"."total_labor_fee_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"type" "inventory_movement_type" NOT NULL,
	"from_warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"status" "stocktake_status" DEFAULT 'completed' NOT NULL,
	"item_count" integer NOT NULL,
	"net_weight_grams" numeric(14, 3) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_code_unique" ON "inventory_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "inventory_items_warehouse_status_idx" ON "inventory_items" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "inventory_items_karat_idx" ON "inventory_items" USING btree ("karat");--> statement-breakpoint
CREATE INDEX "inventory_items_category_idx" ON "inventory_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_created_idx" ON "inventory_movements" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_warehouse_idx" ON "inventory_movements" USING btree ("to_warehouse_id");--> statement-breakpoint
CREATE INDEX "stocktakes_warehouse_created_idx" ON "stocktakes" USING btree ("warehouse_id","created_at");