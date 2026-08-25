# TASK 04 — Sales Backend Migration Report

Status: **IMPLEMENTED AND DEPLOYED — automated verification passed; final authenticated production acceptance is pending designated business data.**

The final production login-and-sale acceptance remains for the designated business user because production currently contains no warehouses, inventory items, partners, or designated sales test account. No production business data was fabricated for testing.

## Database Changes

Migration `backend/drizzle/0004_loose_golden_guardian.sql` adds:

- `sales_invoices`, `sales_invoice_items`, `sales_payments`, and `sales_gold_exchanges`.
- `sales_invoice_sequences` for atomic annual invoice numbers in the `INV-YYYY-NNN` format.
- `sale`, `manual_sale`, and `sale_cancellation` inventory movement types.
- `sales_invoice_id` on inventory movements.
- `quantity` and `is_manual_sale_entry` on inventory items. A manual sale creates a real, historical inventory record in the selected warehouse with quantity `-1` and negative weights, as explicitly requested.
- Foreign keys, unique idempotency/number/line constraints, and indexes for invoice number, warehouse/date, customer, status/date, invoice lines, payments, exchanges, and movement-to-invoice lookup.

Weights use `numeric(14,3)`. Monetary and rate fields use `numeric(18,4)`; SYP totals/payments use `numeric(20,2)`.

## Sales Workflow

`POST /api/v1/sales` validates the authenticated user, `sales.create`, warehouse scope, active customer/both partner, input values, and stock availability in one PostgreSQL transaction. It then assigns a sequence number, creates immutable invoice snapshots, payment records and exchanges, updates stock, adds movements and audit data, and commits together.

The supported paths are:

1. Existing stock item: atomically changes an available in-stock item to `sold` and records a `sale` movement.
2. Manual invoice item: creates and immediately sells a real negative historical inventory record in the selected warehouse, with `manual_sale` movement and invoice link.

Purchases and returns remain on the legacy client workflow and are not sent to the sales API.

## Calculation Rules

The backend calculates line values in PostgreSQL:

`gold value = net weight × gold price per gram`

`workmanship = net weight × workmanship per gram`

`line total = gold value + workmanship`

`final total = gold subtotal + workmanship subtotal − scrap exchange value − discount`

SYP is converted using the submitted validated SYP/USD rate. The server rejects an over-discount or payments greater than the final total. React previews remain visual only.

## Inventory Concurrency

For a stock sale, `inventory_items` is updated only when the record is still in the selected warehouse, not archived, not manual, and `in_stock`. The conditional update is inside the invoice transaction. A second concurrent attempt receives a conflict and rolls back; it cannot create a second posted invoice.

## Customer Integration

Sales reference the Task 03 `partners` master. The backend accepts only active `customer` or `both` partners. The existing Partner API is used for quick customer creation. The invoice stores customer name/phone snapshots for history.

The invoice name input also offers existing backend customers without changing the approved visual layout.

## Payments

USD and SYP payments are individual rows in `sales_payments`; SYP stores its conversion rate and applied USD value. Gold/scrap exchange is preserved in `sales_gold_exchanges` as karat, weight, evaluation price and computed value. The chosen legacy payment classification is preserved on the invoice.

No cashbox or double-entry accounting entries are created in Task 04.

## Balance Boundary

The customer outstanding amount returned with an invoice is derived from the Task 03 opening balance plus remaining debt from posted server sales. It does not mutate an editable partner balance and does not mix browser-local legacy invoices.

## Cancellation

`POST /api/v1/sales/:id/cancel` requires `sales.cancel` and a reason. It marks the invoice cancelled rather than deleting it, checks that each stock movement is still the latest safe movement, restores normal stock to `in_stock`, archives a negative manual-sale record, creates `sale_cancellation` movements, records audit data, and emits events after commit. A second cancellation is rejected.

## Idempotency

The client sends a UUID idempotency key. `sales_invoices.idempotency_key` is unique. A retry with the same key returns the original sale; a distinct key cannot sell an already sold stock item.

## Audit

`sales.create` and `sales.cancel` use `AuditService` inside the database transaction with actor, invoice, warehouse, customer, invoice number and non-secret operational metadata.

## Realtime

After commit, `sale.created`, `sale.cancelled`, and `inventory.updated` are emitted. Warehouse-permission rooms were added so sales events are scoped to both the relevant warehouse and `sales.view` permission.

## Frontend Migration

`InvoicesView` uses `salesApi` for server sales listing, posting, cancellation, reload after a change, and authoritative printing data. It shows API loading/error state, supports server-backed pages of 30 sale invoices, retains the approved invoice layout, and keeps purchases/returns local.

The legacy local shift identifier is intentionally not stored on server sales because a trustworthy backend shift module is outside this task.

## Legacy Boundary

Not migrated: purchases, returns, cashboxes, vouchers, accounting, reports, shifts, and gold-weight accounts. Browser printing remains the approved PDF/print mechanism.

## Tests

Executed locally on 2026-08-13:

- `backend/npm run build` — passed.
- `backend/npm run test:integration` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.

Integration coverage includes valid stock sale, manual negative inventory sale, calculation values, USD/SYP payment rows, gold exchange, customer type rejection, scope denial, duplicate stock conflict, same-key idempotency, concurrent double-sale prevention, invalid-discount rollback, audit, cancellation reason/permission/repeat checks, stock restoration, manual-entry archival, and persistence after backend restart.

## Local Verification

Database migration and real HTTP integration scenarios were executed locally. Automated visual browser verification and print-preview inspection were not performed because no interactive browser was available in this run.

## Production Deployment

The Task 04 migration was reviewed and applied manually on production; `drizzle-kit push` was not used. The frontend and backend were built on the VPS. Only `hameed-hliwi` and `hameed-hliwi-api` were restarted.

## Production Verification

Verified against `https://hameed-hliwi.org/`:

- Root returned HTTP 200.
- `/api/v1/health` returned HTTP 200.
- Unauthenticated `/api/v1/sales` returned HTTP 401.
- The migration ledger contains the Task 04 migration and the four sales tables exist.

Authenticated sale creation, cross-warehouse denial, persistence, cancellation, restoration and audit were not run in production because the production database had zero warehouses, inventory items and partners. No fabricated production business records were inserted.

## Remaining Risks

- A designated production account plus deliberate test warehouse/customer/item are required for final end-user acceptance.
- Visual review of the existing invoice and print design is still required from the business browser.
- Cashbox/accounting and shift integration are intentionally deferred to their dedicated tasks.
