-- TASK 20 — backup runs and the permission that guards them.
--
-- Until now the only backups were the ones taken by hand during a deployment, on the same machine
-- they protect. This records every run so a schedule that quietly stopped is visible rather than
-- discovered on the day it is needed.

CREATE TABLE IF NOT EXISTS "backup_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "file_name" text NOT NULL,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "checksum" text,
  "error_message" text,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "backup_runs_kind_check" CHECK ("kind" in ('scheduled', 'manual')),
  CONSTRAINT "backup_runs_status_check" CHECK ("status" in ('running', 'completed', 'failed'))
);
CREATE INDEX IF NOT EXISTS "backup_runs_started_idx" ON "backup_runs" ("started_at");
CREATE INDEX IF NOT EXISTS "backup_runs_status_idx" ON "backup_runs" ("status");

-- A backup file is the entire business in one document: every customer, every balance, every
-- price, every password hash. It belongs to the highest role and to nobody else.
INSERT INTO "permissions" ("code", "description")
VALUES ('backups.manage', 'backups.manage')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r, "permissions" p
 WHERE p."code" = 'backups.manage'
   AND r."name" IN ('general_manager', 'system_admin')
ON CONFLICT DO NOTHING;
