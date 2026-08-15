-- TASK 18 — server-held settings, gold prices and exchange rate.
--
-- Until now these lived in each browser's localStorage: two devices could price the same goods
-- differently on the same day, and the approved invoice printed a store name held in a browser.
--
-- Seeding note. The manager's real values exist only in their browser and cannot be read from
-- here. Rather than invent plausible-looking prices — a wrong price that looks right is worse than
-- an obvious placeholder — the seed is derived from the most recent **posted documents**, which
-- are authoritative records of what was actually being used. Everything seeded this way is flagged
-- `is_provisional = true` until a human confirms it.

CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "singleton" boolean DEFAULT true NOT NULL,
  "store_name" text NOT NULL,
  "store_subtitle" text DEFAULT '' NOT NULL,
  "address" text DEFAULT '' NOT NULL,
  "branch_name" text DEFAULT '' NOT NULL,
  "phone1" text DEFAULT '' NOT NULL,
  "phone2" text DEFAULT '' NOT NULL,
  "usd_to_syp_rate" numeric(18, 4) NOT NULL,
  "base_gold_ounce_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
  "base_gold_gram_24k_usd" numeric(18, 4) DEFAULT '0' NOT NULL,
  "buy_margin_percent" numeric(9, 4) DEFAULT '0' NOT NULL,
  "sell_margin_percent" numeric(9, 4) DEFAULT '0' NOT NULL,
  "tax_rate_percent" numeric(9, 4) DEFAULT '0' NOT NULL,
  "auto_sync_gold_prices" boolean DEFAULT false NOT NULL,
  "is_provisional" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "app_settings_singleton_check" CHECK ("singleton" = true),
  CONSTRAINT "app_settings_rate_check" CHECK ("usd_to_syp_rate" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_settings_singleton_unique" ON "app_settings" ("singleton");

CREATE TABLE IF NOT EXISTS "gold_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "karat" text NOT NULL,
  "buy_price_usd_per_gram" numeric(16, 4) DEFAULT '0' NOT NULL,
  "sell_price_usd_per_gram" numeric(16, 4) DEFAULT '0' NOT NULL,
  "buy_price_syp_per_gram" numeric(20, 2) DEFAULT '0' NOT NULL,
  "sell_price_syp_per_gram" numeric(20, 2) DEFAULT '0' NOT NULL,
  "labor_fee_usd_per_gram" numeric(16, 4) DEFAULT '0' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gold_prices_karat_check" CHECK ("karat" in ('24','22','21','18','14')),
  CONSTRAINT "gold_prices_amounts_check" CHECK ("buy_price_usd_per_gram" >= 0 AND "sell_price_usd_per_gram" >= 0 AND "buy_price_syp_per_gram" >= 0 AND "sell_price_syp_per_gram" >= 0 AND "labor_fee_usd_per_gram" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "gold_prices_karat_unique" ON "gold_prices" ("karat");

CREATE TABLE IF NOT EXISTS "settings_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "karat" text,
  "field" text NOT NULL,
  "old_value" text,
  "new_value" text NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "settings_history_scope_check" CHECK ("scope" in ('general', 'gold_price'))
);
CREATE INDEX IF NOT EXISTS "settings_history_occurred_idx" ON "settings_history" ("occurred_at");
CREATE INDEX IF NOT EXISTS "settings_history_scope_field_idx" ON "settings_history" ("scope", "field");

-- The singleton row. The rate comes from the most recent posted sale — the rate the shop was
-- demonstrably transacting at — and falls back to 1 only if no sale has ever been posted, in which
-- case the placeholder is absurd on purpose rather than quietly plausible.
INSERT INTO "app_settings" ("store_name", "usd_to_syp_rate", "is_provisional")
SELECT
  'حميد حليوي لتجارة وصياغة الذهب',
  COALESCE((SELECT "exchange_rate_syp_per_usd" FROM "sales_invoices" WHERE "status" = 'posted' ORDER BY "created_at" DESC LIMIT 1), 1),
  true
WHERE NOT EXISTS (SELECT 1 FROM "app_settings");

-- One row per karat. Selling prices are seeded from the most recent posted sale line at that
-- karat, and workmanship from the same line; a karat never sold stays at zero and is visibly
-- unset rather than guessed.
INSERT INTO "gold_prices" ("karat", "sell_price_usd_per_gram", "labor_fee_usd_per_gram")
SELECT k.karat,
  COALESCE((SELECT i."gold_price_usd_per_gram" FROM "sales_invoice_items" i
             JOIN "sales_invoices" s ON s."id" = i."sales_invoice_id"
            WHERE i."karat_snapshot" = k.karat AND s."status" = 'posted'
            ORDER BY s."created_at" DESC LIMIT 1), 0),
  COALESCE((SELECT i."workmanship_usd_per_gram" FROM "sales_invoice_items" i
             JOIN "sales_invoices" s ON s."id" = i."sales_invoice_id"
            WHERE i."karat_snapshot" = k.karat AND s."status" = 'posted'
            ORDER BY s."created_at" DESC LIMIT 1), 0)
FROM (VALUES ('24'), ('22'), ('21'), ('18'), ('14')) AS k(karat)
WHERE NOT EXISTS (SELECT 1 FROM "gold_prices" WHERE "gold_prices"."karat" = k.karat);

-- Buying prices have no equivalent source on the sales side, so they are left at zero: unset and
-- obviously so. A purchase price invented here would be a number nobody chose.

-- The permission. `bootstrap-production.ts` is a one-time script, so a new code has to be
-- inserted and granted here or it would never reach production.
INSERT INTO "permissions" ("code", "description")
VALUES ('settings.manage', 'settings.manage')
ON CONFLICT ("code") DO NOTHING;

-- Granted to the roles that already held company-wide configuration through `warehouses.manage`,
-- so this changes no one's access — only which code expresses it.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r, "permissions" p
 WHERE p."code" = 'settings.manage'
   AND r."name" IN ('general_manager', 'system_admin')
ON CONFLICT DO NOTHING;
