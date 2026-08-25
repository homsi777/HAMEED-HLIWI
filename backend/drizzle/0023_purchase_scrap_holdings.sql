CREATE TYPE "public"."purchase_material_type" AS ENUM('new', 'scrap');--> statement-breakpoint
ALTER TYPE "public"."gold_transaction_type" ADD VALUE IF NOT EXISTS 'purchase_scrap';--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "material_type" "purchase_material_type" DEFAULT 'new' NOT NULL;
