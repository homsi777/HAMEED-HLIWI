CREATE TYPE "public"."employee_schedule" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'archived', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."employee_transaction_type" AS ENUM('advance', 'salary_payment');--> statement-breakpoint

CREATE TABLE "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "full_name" text NOT NULL,
  "phone" text,
  "warehouse_id" uuid NOT NULL,
  "schedule" "employee_schedule" NOT NULL,
  "salary_currency" text NOT NULL,
  "salary_amount" numeric(18,4) NOT NULL DEFAULT '0',
  "photo_data_url" text,
  "notes" text,
  "status" "employee_status" NOT NULL DEFAULT 'active',
  "archived_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employees_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "employees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "employees_currency_check" CHECK ("salary_currency" in ('USD','SYP')),
  CONSTRAINT "employees_salary_check" CHECK ("salary_amount" >= 0)
);--> statement-breakpoint
CREATE INDEX "employees_warehouse_status_idx" ON "employees" USING btree ("warehouse_id", "status");--> statement-breakpoint

CREATE TABLE "employee_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL,
  "type" "employee_transaction_type" NOT NULL,
  "currency" text NOT NULL,
  "amount" numeric(18,4) NOT NULL,
  "occurred_on" date NOT NULL DEFAULT CURRENT_DATE,
  "note" text,
  "idempotency_key" text NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "employee_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "employee_transactions_currency_check" CHECK ("currency" in ('USD','SYP')),
  CONSTRAINT "employee_transactions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "employee_transactions_idempotency_unique" UNIQUE ("idempotency_key")
);--> statement-breakpoint
CREATE INDEX "employee_transactions_employee_date_idx" ON "employee_transactions" USING btree ("employee_id", "occurred_on");--> statement-breakpoint

INSERT INTO "permissions" ("id", "code", "description", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'employees.view', 'employees.view', now(), now()),
  (gen_random_uuid(), 'employees.manage', 'employees.manage', now(), now()),
  (gen_random_uuid(), 'employees.payroll', 'employees.payroll', now(), now())
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name IN ('system_admin', 'general_manager', 'warehouse_manager')
  AND p.code IN ('employees.view', 'employees.manage', 'employees.payroll')
ON CONFLICT DO NOTHING;
