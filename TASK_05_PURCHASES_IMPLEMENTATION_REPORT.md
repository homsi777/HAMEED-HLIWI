# TASK 05 — Purchases Backend Migration Report

Status: **IMPLEMENTED AND DEPLOYED — automated verification passed; designated-user business acceptance remains pending real warehouse data.**

## Database Changes

Migration `backend/drizzle/0005_pretty_alex_wilder.sql` adds purchase master, line, payment, and annual sequence tables, purchase references on inventory movements, indexes for normal queries, and the `purchase`, `legacy_reconciliation`, and `purchase_cancellation` movement types. It also adds `purchases.view`, `purchases.create`, and `purchases.cancel` permissions.

## Purchase Workflow

`POST /api/v1/purchases` is server authoritative. It validates the authenticated permission, warehouse scope, active supplier/both partner, line data, payment totals, and idempotency key in one PostgreSQL transaction. It creates an immutable `PUR-YYYY-NNN` invoice, lines, payment facts, inventory changes, audit entry, then commits together.

`GET /api/v1/purchases`, `GET /api/v1/purchases/:id`, and `POST /api/v1/purchases/:id/cancel` provide paginated, scoped retrieval and safe cancellation.

## Supplier Integration

Only `supplier` and `both` partners are accepted. Quick supplier creation reuses the Partners API. Supplier outstanding USD is derived from the immutable opening balance plus posted purchase debt; no editable partner balance is mutated.

## Inventory Receipt

A normal posted purchase creates actual available inventory in the selected real warehouse and a linked immutable `purchase` movement. Browser/localStorage inventory is no longer used by the invoice workflow. The invoice page now loads warehouses and stock from the backend, so legacy UI identifiers such as `wh-main` are not sent to production.

## Legacy Negative Inventory Reconciliation

Reconciliation is opt-in and explicit: the user chooses one negative legacy inventory record while adding a purchase line. The backend verifies the same warehouse, manual-negative state, karat, category, proportional quantity/weight, and optimistic version before it changes anything. It never merges merely by name.

Full reconciliation archives the negative record while keeping its sale and movement history. Partial reconciliation leaves the correctly reduced negative quantity/weight visible. Any positive purchase remainder becomes a separate available inventory record. A `legacy_reconciliation` movement retains the before-values and reconciliation amounts for safe reversal.

## Calculation Rules and Payments

PostgreSQL calculates gold value and workmanship from net weight and per-gram values. The server validates discount and confirms USD + converted SYP payments do not exceed the final purchase total. Payments are persisted as facts only; cashboxes and accounting ledgers are intentionally unchanged.

## Cancellation

Posted purchases are never deleted. Cancellation requires `purchases.cancel` and a reason. It archives only receipt inventory that has no later activity, reverses a compatible reconciliation from its recorded before-values, records reversal movements, and audits the action. A purchase whose received item was later sold, transferred, or otherwise moved is rejected safely.

## Idempotency, Concurrency, Audit, and Realtime

Purchase idempotency is enforced by a unique key. Explicit reconciliation uses a versioned conditional update so only one of conflicting simultaneous attempts can commit. Create/cancel actions use `AuditService`; post-commit events are emitted to scoped purchase and inventory realtime rooms.

## Frontend Migration

Only purchase behaviour within `InvoicesView` was migrated. The approved layout is retained. Purchase list, supplier selection/quick creation, server errors, printing, cancellation, and server pagination use the backend. Returns remain legacy by scope. A purchase-only control offers an explicit negative-stock reconciliation target; selecting nothing means a wholly new receipt.

## Local Verification

Completed successfully:

- local Drizzle migration application;
- frontend TypeScript lint and production build;
- backend TypeScript build;
- integration test suite, including purchase creation, supplier/customer validation, scope/permission denial, inventory receipt, payments, debt derivation, idempotency, full and partial reconciliation, no auto-match, concurrent reconciliation conflict, safe/unsafe cancellation, audit, and restart persistence.

Browser visual verification has not been performed in this Task 05 run. Production route verification was completed, but authenticated business acceptance remains pending a real warehouse and business stock.

## Production Safety and Remaining Risks

Production was previously observed with no inventory and no warehouses. This task does not fabricate stock or import browser-local purchases. A real warehouse must be created by the business user before purchase or sale can be posted. The two temporary production customer records created during earlier troubleshooting are not inventory data and are left untouched.

Production deployment completed: the reviewed migration was applied manually as the PostgreSQL owner, recorded in the Drizzle migration ledger, new tables assigned to the application role, backend/frontend rebuilt, and only `hameed-hliwi-api` and `hameed-hliwi` restarted. Root returned 200, health returned `database: ok`, unauthenticated purchases returned 401, and an authenticated administrator received 200 from Purchases, Inventory, and Suppliers endpoints. No other project process was restarted.
