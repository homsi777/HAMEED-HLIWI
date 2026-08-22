ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "login_locked_until" timestamp with time zone;
