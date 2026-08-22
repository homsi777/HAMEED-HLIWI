ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "backup_reminder_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "backup_reminder_interval_hours" integer DEFAULT 6 NOT NULL,
  ADD COLUMN IF NOT EXISTS "backup_reminder_last_sent_at" timestamp with time zone;

ALTER TABLE "app_settings"
  ADD CONSTRAINT "app_settings_backup_reminder_interval_check"
  CHECK ("backup_reminder_interval_hours" between 1 and 168);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_unique" ON "push_subscriptions" ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
