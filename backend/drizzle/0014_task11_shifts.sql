CREATE TYPE "public"."shift_status" AS ENUM('open', 'closing_requested', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_number" text NOT NULL,
	"shift_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "shift_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by_user_id" uuid NOT NULL,
	"closing_requested_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"opening_custody_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
	"opening_custody_syp" numeric(20, 2) DEFAULT '0' NOT NULL,
	"expected_usd" numeric(18, 4),
	"expected_syp" numeric(20, 2),
	"actual_usd" numeric(18, 4),
	"actual_syp" numeric(20, 2),
	"difference_usd" numeric(18, 4),
	"difference_syp" numeric(20, 2),
	"seller_note" text,
	"manager_note" text,
	"closure_snapshot" jsonb,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "shift_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"description" text NOT NULL,
	"reference_number" text,
	"amount_usd" numeric(18, 4),
	"sales_invoice_id" uuid,
	"return_invoice_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_activities" ADD CONSTRAINT "shift_activities_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_activities" ADD CONSTRAINT "shift_activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_activities" ADD CONSTRAINT "shift_activities_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_activities" ADD CONSTRAINT "shift_activities_return_invoice_id_return_invoices_id_fk" FOREIGN KEY ("return_invoice_id") REFERENCES "public"."return_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_number_unique" ON "shifts" USING btree ("shift_number");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_idempotency_unique" ON "shifts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_year_sequence_unique" ON "shifts" USING btree ("shift_year","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_live_per_seller" ON "shifts" USING btree ("seller_user_id") WHERE status in ('open', 'closing_requested');--> statement-breakpoint
CREATE INDEX "shifts_warehouse_status_idx" ON "shifts" USING btree ("warehouse_id","status","opened_at");--> statement-breakpoint
CREATE INDEX "shifts_seller_opened_idx" ON "shifts" USING btree ("seller_user_id","opened_at");--> statement-breakpoint
CREATE INDEX "shifts_status_opened_idx" ON "shifts" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "shift_activities_shift_time_idx" ON "shift_activities" USING btree ("shift_id","occurred_at");--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_invoices_shift_idx" ON "sales_invoices" USING btree ("shift_id");--> statement-breakpoint
ALTER TABLE "return_invoices" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "return_invoices" ADD CONSTRAINT "return_invoices_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_invoices_shift_idx" ON "return_invoices" USING btree ("shift_id");--> statement-breakpoint
-- Documents created before the shifts module keep a null shift and are reported as
-- "قبل نظام الورديات". No shift is ever fabricated for historical data.
INSERT INTO "permissions" ("code", "description") VALUES ('shifts.view', 'shifts.view'), ('shifts.open', 'shifts.open'), ('shifts.close.request', 'shifts.close.request'), ('shifts.approve', 'shifts.approve'), ('shifts.manage', 'shifts.manage') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" IN ('system_admin', 'general_manager') AND "permissions"."code" IN ('shifts.view', 'shifts.open', 'shifts.close.request', 'shifts.approve', 'shifts.manage') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'warehouse_manager' AND "permissions"."code" IN ('shifts.view', 'shifts.approve', 'shifts.manage') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'sales' AND "permissions"."code" IN ('shifts.view', 'shifts.open', 'shifts.close.request') ON CONFLICT DO NOTHING;
