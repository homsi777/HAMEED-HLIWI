CREATE TYPE "public"."partner_type" AS ENUM('customer', 'supplier', 'both');--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"type" "partner_type" NOT NULL,
	"phone" text,
	"normalized_phone" text,
	"address" text,
	"notes" text,
	"tax_number" text,
	"normalized_tax_number" text,
	"opening_balance_usd" numeric(16, 4) DEFAULT '0' NOT NULL,
	"opening_gold_balance_21k_grams" numeric(14, 3) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partners_name_phone_type_active_idx" ON "partners" USING btree ("normalized_name","normalized_phone","type","is_active");--> statement-breakpoint
CREATE INDEX "partners_phone_active_idx" ON "partners" USING btree ("normalized_phone","is_active");--> statement-breakpoint
CREATE INDEX "partners_tax_active_idx" ON "partners" USING btree ("normalized_tax_number","is_active");--> statement-breakpoint
CREATE INDEX "partners_created_idx" ON "partners" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO "permissions" ("id", "code", "description", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'customers.archive', 'customers.archive', now(), now()),
  (gen_random_uuid(), 'suppliers.view', 'suppliers.view', now(), now()),
  (gen_random_uuid(), 'suppliers.create', 'suppliers.create', now(), now()),
  (gen_random_uuid(), 'suppliers.update', 'suppliers.update', now(), now()),
  (gen_random_uuid(), 'suppliers.archive', 'suppliers.archive', now(), now())
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles.id, permissions.id FROM "roles" roles CROSS JOIN "permissions" permissions
WHERE roles.name = 'system_admin' AND permissions.code IN ('customers.archive', 'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.archive')
ON CONFLICT DO NOTHING;
