# TASK 03 — Customers & Suppliers Backend Migration

## Status

Implemented locally and deployed to production on 2026-08-13. This task migrates the shared customer/supplier master only. It does not migrate sales, purchases, returns, vouchers, accounting, reports, shifts, or gold-weight accounts.

## What changed

- Added the `partners` PostgreSQL master table and migration `backend/drizzle/0003_moaning_nuke.sql`.
- A partner can be `customer`, `supplier`, or `both`. It is company-wide and has no automatic warehouse binding.
- Added protected REST endpoints:
  - `GET /api/v1/partners`
  - `GET /api/v1/partners/:id`
  - `POST /api/v1/partners`
  - `PATCH /api/v1/partners/:id`
  - `DELETE /api/v1/partners/:id`
  - `POST /api/v1/partners/:id/reactivate`
- Added customer and supplier view/create/update/archive permissions, role seed support, audit rows, optimistic concurrency with `version`, soft archive, normalized phone/tax-number duplicate checks, search, sorting, and pagination.
- Added permission-scoped realtime rooms. Partner events are emitted only to authenticated users holding the appropriate customer/supplier view permission.
- Migrated `PartnersView` to the backend API while retaining its existing header, summary cards, filters, mobile cards, desktop table, modal, and print flow.

## Balance and statement boundary

The two balances in the existing UI are stored only as immutable opening balances for this transition. They are not editable from updates and must not be treated as an accounting ledger source.

The printable account statement now explicitly avoids mixing legacy browser invoices, vouchers, and gold-debt entries with the backend master. Those modules will need their own database migrations before their transactions can appear in a trusted statement.

## Warehouse and access policy

Partners are shared company master records, not warehouse-owned records. Warehouse scope still applies to inventory and operational records. Partner access is controlled by the granular customer/supplier permission set, including the stricter dual permission requirement for a `both` record.

## Local verification

- `npm --prefix backend run db:migrate` completed.
- `npm --prefix backend run db:seed` completed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm --prefix backend run build` passed.
- `npm --prefix backend run test:integration` passed.

The integration coverage includes customer/supplier/both creation, unauthenticated access rejection, missing permission rejection, duplicate phone rejection, invalid type and UUID rejection, filtered/paginated/sorted list response, update concurrency conflict, archive/reactivate, audit records, restart persistence, and the existing security/inventory checks.

## Production safety notes

Production was inspected read-only before deployment. At that point it contained one user, zero warehouses, and no inventory or partner table; no browser-local records can be inferred or copied into PostgreSQL. The existing Drizzle ledger contained only migrations 0000 and 0001, so the owner account applied 0002 and 0003 in order, registered both hashes, and transferred ownership of the new application tables/types to `hameed_hliwi_app`.

The deployed server commit is `78b20e7`. Both `hameed-hliwi` and `hameed-hliwi-api` were restarted; `/api/v1/health` returned `200` with database `ok`, the domain root returned `200`, and unauthenticated `/api/v1/partners` returned the expected `401`.

## Deferred work

- Sales, purchases, returns, vouchers, accounting, reports, and their partner references.
- Transaction ledger and reconciled USD/gold balances.
- Gold-weight account migration and settlement workflows.
- Export/import and external data migration after a reviewed source dataset is supplied.
