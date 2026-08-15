-- TASK 12 adds no table and no column: invoice and sold-weight history are derived from the
-- immutable snapshots the sale already persists. Only two indexes are added, each justified
-- by a query this task actually runs.
--
-- 1. Every request from a seller carries `created_by_user_id = <self>` as a forced predicate
--    (Task 10 own-scope), and history is always ordered newest first. Without this index that
--    is a sequential scan plus a sort on every page a seller opens.
CREATE INDEX IF NOT EXISTS "sales_invoices_seller_created_idx" ON "sales_invoices" USING btree ("created_by_user_id","created_at" DESC);--> statement-breakpoint
-- 2. The unfiltered manager and General Manager listing orders the whole table by date. The
--    existing composite starts with `status`, so it cannot serve an ordering-only query.
CREATE INDEX IF NOT EXISTS "sales_invoices_created_idx" ON "sales_invoices" USING btree ("created_at" DESC);--> statement-breakpoint
-- Sold-weight history drives from `sales_invoices` and joins lines through the existing
-- `sales_invoice_items_invoice_idx`; returned amounts resolve through the existing
-- `return_invoice_items_source_sale_line_idx`. No further index is warranted today, and none
-- was added speculatively.
CREATE INDEX IF NOT EXISTS "return_invoices_seller_created_idx" ON "return_invoices" USING btree ("created_by_user_id","created_at" DESC);
