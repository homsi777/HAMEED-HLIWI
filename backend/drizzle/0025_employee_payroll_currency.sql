ALTER TABLE "employee_transactions" ADD COLUMN "exchange_rate_syp_per_usd" numeric(18,4) NOT NULL DEFAULT '1';--> statement-breakpoint
ALTER TABLE "employee_transactions" ADD COLUMN "voucher_id" uuid REFERENCES "vouchers"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_rate_check" CHECK ("exchange_rate_syp_per_usd" > 0);
