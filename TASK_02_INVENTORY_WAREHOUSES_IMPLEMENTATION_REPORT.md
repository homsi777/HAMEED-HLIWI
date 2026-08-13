# TASK 02 — Inventory & Warehouses Backend Migration

Status: implemented and locally verified; production deployment verification follows this report update.

## Database changes

- Migration `0002_curvy_robbie_robertson.sql` adds `inventory_items`, `inventory_movements`, and `stocktakes`.
- Jewelry weights use `numeric(14,3)` grams. Workmanship uses `numeric(16,4)` USD.
- Inventory codes are globally unique. Database checks reject invalid karats, negative weights, stone weight above gross weight, and negative workmanship.
- Items retain a version number for optimistic concurrency and are archived rather than hard-deleted.
- Query indexes cover warehouse/status, karat, category, movement history, and stocktake history.

## Inventory API

- `GET /api/v1/inventory` supports scoped filters, validated sorting, and page/limit metadata.
- `GET /api/v1/inventory/:id`, `POST /api/v1/inventory`, `PATCH /api/v1/inventory/:id`, and `DELETE /api/v1/inventory/:id` implement reads, create, optimistic updates, and archive.
- `POST /api/v1/inventory/:id/transfer` moves an item inside a transaction and records immutable movement history.
- `GET /api/v1/inventory/:id/movements`, stocktake create/list endpoints, and image upload are provided.

## Scope, permissions, and audit

- Every item read/write calls the existing `WarehouseScopeService`; supplied warehouse identifiers cannot bypass the authenticated user's memberships.
- Permissions are enforced server-side: `inventory.view`, `inventory.create`, `inventory.update`, `inventory.delete`, `inventory.transfer`, and `inventory.adjust` for stocktakes.
- Create, update, archive, transfer, and stocktake operations generate server-side audit records. Realtime events are emitted only after a successful database commit and scoped to warehouse rooms.

## Images and stocktakes

- Images are stored outside database rows under a configurable storage directory, with generated UUID filenames, 5 MB default limit, MIME allow-list, and JPEG/PNG/WebP signature validation.
- PostgreSQL stocktake records retain the warehouse, actor, timestamp, count, net weight, and a server-generated snapshot.

## Frontend migration

- `InventoryView` now loads inventory and warehouses only through the backend API, supports loading/error state and 30-record server pagination, and keeps the approved page layout.
- New inventory writes, transfers, archives, stocktakes, and image uploads no longer use `StoreContext` or localStorage.
- Warehouse manager entry is no longer a free-text source of truth; user/warehouse assignment remains the existing many-to-many backend relationship.
- Sales, reports, invoices, and dashboard still read legacy local state by design and have not been migrated in TASK 02. No database inventory is copied back to localStorage.

## Local tests

- `npm --prefix backend run db:migrate` passed.
- `npm --prefix backend run db:seed` passed for local development users and two scoped warehouses.
- `npm --prefix backend run test:integration` passed. It covers duplicate code, invalid weights/UUIDs, filtering/pagination response, isolation, denied cross-warehouse create/transfer, authorized transfer, movements, audit, stocktake, image validation, persistence after backend restart, archive, sessions, realtime, and rate limiting.
- `npm --prefix backend run build`, `npm run lint`, and `npm run build` passed.

## Browser verification

The local in-app browser was unavailable in this session, so no visual browser result is claimed. Functional backend integration and frontend TypeScript/build verification completed; production API/domain verification is recorded after deployment.

## Production data safety

Before migration, the production database contained no inventory rows and no warehouse rows. Browser-local legacy data is not visible from the server and was not overwritten. If a user has legacy browser-only inventory that must be retained, it must be imported deliberately from that browser before using the new PostgreSQL inventory as the source of truth.

## Remaining risks

- The existing Cloudflare public WebSocket edge issue remains deferred from TASK 01; backend scoped event emission is implemented and locally tested.
- The current frontend bundle remains above Vite's default chunk-size warning threshold; this migration does not change the approved UI architecture.
