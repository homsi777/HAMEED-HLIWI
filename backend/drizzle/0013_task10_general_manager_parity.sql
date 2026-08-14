INSERT INTO "permissions" ("code", "description") VALUES ('accounting.journal.post', 'accounting.journal.post') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions" WHERE "roles"."name" = 'general_manager' AND "permissions"."code" = 'accounting.journal.post' ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The operational General Manager now holds everything the internal technical role holds, so
-- retiring `system_admin` from the company administrator removes no capability at all.
DELETE FROM "user_roles" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'system_admin')
  AND "user_id" IN (SELECT "ur"."user_id" FROM "user_roles" "ur" INNER JOIN "roles" "r" ON "r"."id" = "ur"."role_id" WHERE "r"."name" = 'general_manager');
