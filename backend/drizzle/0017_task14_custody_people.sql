-- ذمم الأوزان previously required a commercial partner: the check constraint below made
-- `partner_id` mandatory for every non-company gold account, which is why handing gold to a
-- polisher forced the operator to create a Customer first. This migration adds a light
-- identity for custody recipients and relaxes that constraint.
--
-- Production carries zero partner gold accounts at the time of this migration, so no existing
-- custody record needs remapping. Any that appear later keep working untouched: the `partner`
-- kind is unchanged.
CREATE TABLE "weight_custody_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"phone" text,
	"note" text,
	"partner_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "weight_custody_people" ADD CONSTRAINT "wcp_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_custody_people" ADD CONSTRAINT "wcp_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weight_custody_people_name_unique" ON "weight_custody_people" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_custody_people_partner_unique" ON "weight_custody_people" USING btree ("partner_id") WHERE "partner_id" is not null;--> statement-breakpoint
CREATE INDEX "weight_custody_people_active_idx" ON "weight_custody_people" USING btree ("is_active");--> statement-breakpoint
-- PostgreSQL 12+ permits a new enum value inside a transaction while nothing uses it here.
ALTER TYPE "public"."gold_account_kind" ADD VALUE IF NOT EXISTS 'custody_person';--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD COLUMN IF NOT EXISTS "custody_person_id" uuid;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_custody_person_id_fk" FOREIGN KEY ("custody_person_id") REFERENCES "public"."weight_custody_people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gold_accounts_custody_person_unique" ON "gold_accounts" USING btree ("custody_person_id") WHERE "custody_person_id" is not null;--> statement-breakpoint
ALTER TABLE "gold_accounts" DROP CONSTRAINT IF EXISTS "gold_accounts_scope_check";--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_scope_check" CHECK (
  ("kind"::text = 'partner' and "partner_id" is not null and "custody_person_id" is null)
  or ("kind"::text = 'company' and "partner_id" is null and "custody_person_id" is null)
  or ("kind"::text = 'custody_person' and "custody_person_id" is not null and "partner_id" is null)
);
