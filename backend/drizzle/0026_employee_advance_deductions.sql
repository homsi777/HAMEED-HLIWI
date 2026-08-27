ALTER TABLE "employee_transactions" ADD COLUMN "advance_deduction_amount" numeric(18,4) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_advance_deduction_check" CHECK ("advance_deduction_amount" >= 0);
