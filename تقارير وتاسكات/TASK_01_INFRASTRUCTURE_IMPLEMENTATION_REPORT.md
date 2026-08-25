# TASK 01 — تقرير تنفيذ البنية التحتية

**الحالة:** اكتمل التنفيذ والتحقق المحلي. النشر الإنتاجي لم يُنفذ بعد عمداً، لأن قاعدة PostgreSQL إنتاجية مخصصة واعتماد إنتاج قوي لم يُوفرا بعد. لا يستخدم هذا التقرير كلمة مرور أو سراً فعلياً.

## Architecture Implemented

```text
React/Vite frontend
  └─ same-origin API client: /api/v1
      └─ NestJS modular monolith (Fastify)
          ├─ Auth: httpOnly JWT cookie + server-side session version
          ├─ RBAC: persisted roles and granular permissions
          ├─ Warehouse scope: persisted many-to-many memberships
          ├─ Audit: PostgreSQL audit logs
          ├─ Realtime: authenticated Socket.IO namespace /realtime
          └─ Health/readiness: GET /api/v1/health
              └─ Drizzle ORM + PostgreSQL pooled connection
```

The frontend business modules still use their legacy React/localStorage state. Task 01 intentionally does not migrate them. A minimal login screen and API session service were added: if the API is unavailable the legacy UI remains usable locally; when the same-origin API is available and the browser is unauthenticated, the app displays the login screen. The old local user switcher is disabled while a server-authenticated identity exists.

## Files Created or Modified

- `backend/` — independent NestJS/Fastify service, own package manifest, TypeScript configuration, environment example, Drizzle configuration, and operational README.
- `backend/src/database/schema.ts` — PostgreSQL/Drizzle source schema.
- `backend/drizzle/0000_broad_slapstick.sql` — generated initial SQL migration and Drizzle metadata.
- `backend/src/database/seed.ts` — development-only seed; refuses `NODE_ENV=production`.
- `backend/src/auth/*` — login, logout invalidation, `me`, authentication guard, DTO, bcrypt verification, JWT handling.
- `backend/src/permissions/*` — `@RequirePermissions` metadata decorator and reusable permission guard.
- `backend/src/warehouses/*` — central warehouse-scope service and protected scope endpoints.
- `backend/src/audit/*`, `common/*`, `health/*`, `realtime/*` — persistent audit, request context, structured errors, health, and authenticated realtime foundation.
- `src/services/infrastructureApi.ts`, `src/hooks/useInfrastructureSession.ts`, `src/components/LoginView.tsx` — same-origin API client and minimal frontend login/session integration.
- `src/App.tsx`, `src/components/Navbar.tsx`, `vite.config.ts`, `.env.example`, `src/vite-env.d.ts` — API proxy/configuration and authenticated-identity compatibility updates.

## Database Schema

All IDs are PostgreSQL UUIDs generated in the database (`gen_random_uuid()`), not browser counters. Major time fields are `timestamp with time zone`.

| Table | Purpose / important constraints |
|---|---|
| `users` | unique `username`, bcrypt `password_hash`, `is_active`, `session_version`, timestamps. Password hashes never leave the API. |
| `roles` | extensible named role catalog; unique name and active flag. |
| `permissions` | extensible granular permission codes; unique code. |
| `user_roles` | many-to-many user ↔ role, composite primary key. |
| `role_permissions` | many-to-many role ↔ permission, composite primary key. |
| `warehouses` | name, location, phone, `manager_user_id` relation, active/default flags and timestamps. |
| `user_warehouses` | many-to-many user ↔ warehouse with `is_manager`; composite primary key. |
| `audit_logs` | server-side actor/action/module/entity/warehouse/request context/metadata/timestamp. |

Indexes cover unique user names/permission codes/role names plus active users and warehouse, role, permission, and audit lookup paths. The migration was generated from `schema.ts` and applied to the dedicated local database `hameed_hliwi_local`.

## Authentication

- `POST /api/v1/auth/login` accepts validated username/password.
- Passwords use bcrypt with cost 12.
- Successful login creates a short-lived JWT in the `hh_access` httpOnly, same-site cookie. API calls can also use a Bearer token for non-browser clients.
- `GET /api/v1/auth/me` requires authentication and returns the safe identity only.
- `POST /api/v1/auth/logout` clears the cookie **and increments `session_version`**. Existing tokens for that user are therefore rejected after logout.
- Every protected request reloads the user identity from PostgreSQL and rejects inactive users or a changed session version.

## Roles, Permissions, and Warehouse Scope

Permissions are database records, attached to roles, then roles are attached to users. The initial development seed includes inventory, sales, customer, report, user, and warehouse permission codes, including `warehouses.scope.all` for central administration.

`WarehouseScopeService` is the single reusable source for scope checks. It computes scope only from the authenticated PostgreSQL identity:

- users with `warehouses.scope.all` receive central/all scope;
- other users receive only their explicit `user_warehouses` rows;
- `assertAccess()` rejects a requested warehouse outside that scope.

The browser-provided warehouse id is therefore not trusted. The protected verification endpoints are `GET /api/v1/warehouses/scope` and `GET /api/v1/warehouses/:warehouseId/access`. Future business services must call the same scope service before querying or mutating warehouse-scoped records.

## Audit and Transactions

`AuditService` writes server-side audit records and carries an actor, module/action, optional entity/warehouse IDs, request ID and non-secret metadata. Login and logout are audited. It is not dependent on browser localStorage.

Drizzle receives one pooled PostgreSQL client for the application lifetime; the lifecycle performs a startup connectivity query and ends it gracefully. The integration test proves the reusable PostgreSQL transaction pattern rolls back an inserted permission after an intentional failure. Future invoice services must perform invoice/stock/balance/cash/audit mutations in a single DB transaction.

## WebSocket Foundation

NestJS Socket.IO runs at `/realtime`. Handshakes require the same valid JWT, via cookie, Bearer header, or explicit socket auth token. A connected client joins its own `user:<id>` room and each authorized `warehouse:<id>` room. `emitToWarehouse()` is available for future scoped events. The safe demonstration event is `realtime.ping` → `realtime.pong`.

## Local Verification

Commands executed successfully in the project root/backend:

```powershell
# Local database creation, isolated from other local projects
psql ... -c "create database hameed_hliwi_local"

cd backend
npm install --no-audit --no-fund
npm run db:generate
npm run db:migrate
npm run db:seed
npm run build
npm run test:integration

cd ..
npm run lint
npm run build
```

Results:

- PostgreSQL 16 was reachable locally on `127.0.0.1:5432`.
- Migration `0000_broad_slapstick.sql` applied successfully.
- The eight infrastructure tables exist in `hameed_hliwi_local`.
- Backend and frontend TypeScript builds passed.
- Frontend production Vite build passed.
- Integration test passed health/database, invalid login rejection, unauthenticated protected-route rejection, valid login, central scope, manager scope, cross-warehouse denial, permitted warehouse access, transaction rollback, authenticated WebSocket, and logout token invalidation.

## Production Deployment

**Not performed yet.** This is intentional and required by the task's production-security constraints. The local PostgreSQL database is dedicated to this project, but no dedicated production database/database user/strong production secret has been supplied or established. The development password must not be reused as the production database password.

The production deployment will require a separate `backend/.env` on the server, a production database and least-privilege database user, `NODE_ENV=production`, a unique high-entropy JWT secret, secure cookies, correct trusted origin, a PM2 process for the backend, and Nginx forwarding `/api/` plus the WebSocket upgrade to the backend. The React frontend remains on the existing domain and uses same-origin `/api/v1`.

## Remaining Legacy Local Data

The following modules deliberately remain browser/localStorage-backed and must be migrated one by one in later tasks: inventory, invoices/sales/purchases/returns, customers/suppliers, cashboxes/vouchers/accounting, reports, shifts, general settings/gold prices, dashboard statistics, weight accounts, stocktakes, legacy activity logs, and dashboard shortcuts.

## Problems Encountered and Resolutions

- Nest ESM decorator metadata did not reliably inject some runtime dependencies. Explicit `@Inject(...)` annotations were added to the affected infrastructure dependencies, then integration tests passed.
- The initial WebSocket test expected acknowledgement semantics. The gateway was changed to emit the explicit `realtime.pong` event, giving a stable reusable event convention and a passing authenticated connection test.
- The local PowerShell HTTP session helper raised a client-side null-reference error while handling cookies. The automated Node integration test was used instead, which exercises the actual Fastify server and cookie lifecycle.

## Remaining Technical Risks

## Task 01 Final Closure

### Implemented session security

- Added PostgreSQL-backed `auth_sessions` through Drizzle migration `0001_material_iron_man.sql`.
- Access tokens remain short lived (15 minutes); httpOnly secure refresh cookies are renewable for 14 days and rotate on every refresh.
- Each device/login receives an independent session record. `POST /auth/logout` revokes only the current session. `POST /auth/logout-all` revokes all of a user's sessions and invalidates all current access tokens.
- Refresh tokens are never stored raw in PostgreSQL; only an HMAC hash using a separate production secret is persisted.
- Production frontend never falls back to legacy localStorage when API calls fail: it displays a service-unavailable state and blocks business operations. Local development retains the temporary legacy mode until business modules are migrated.

### Production deployment completed

- Created dedicated `hameed_hliwi_production` PostgreSQL database and separate application/migration roles with restricted privileges. Production credentials and generated secrets reside only in protected server files; no real values are committed.
- Applied Drizzle migration history, including the nine infrastructure tables and the session table.
- Built frontend and backend on the VPS. PM2 runs `hameed-hliwi` on port 3005 and `hameed-hliwi-api` on internal port 3006, saves the process list, and starts after reboot through PM2 systemd integration.
- Nginx preserves the root frontend route and proxies `/api/v1/`, `/socket.io/`, and `/realtime/` to the backend with forward headers and upgrade configuration.

### Verified production behaviour

- `https://hameed-hliwi.org/` returns 200.
- REST API health, login, `/auth/me`, refresh, invalid-login rejection, protected-route rejection, secure/HttpOnly/SameSite cookies, request IDs, Helmet headers, PostgreSQL persistence after backend restart, audit records, warehouse-scope allow/deny checks, and central-administrator multi-warehouse scope were exercised on the deployed environment.
- Local production-proxy WebSocket upgrade returns HTTP 101 and authenticated realtime ping/pong succeeds against the running backend.
- Integration tests pass for session renewal/rotation/replay rejection, independent devices, current/all-session revocation, validation, warehouse isolation, transactions, WebSocket, and active rate limiting. Rate-limit errors are returned as HTTP 429 with the common API error shape.

### Remaining external blocker: Cloudflare WebSockets

The Cloudflare edge for `hameed-hliwi.org` currently responds with HTTP 400 (`code: 3, Bad request`) to a WebSocket upgrade before the request reaches Nginx. Nginx itself returns HTTP 101 for the identical upgrade and Socket.IO polling works through the domain. This is an external Cloudflare-zone setting, not a backend or Nginx defect.

Required action: enable **WebSockets** for the `hameed-hliwi.org` Cloudflare zone (Network settings), then rerun the authenticated domain WebSocket check. Until that setting is enabled, the realtime requirement is not fully verified and Task 01 must not be marked CLOSED/PASSED.

- Production configuration/deployment and production database migration remain outstanding; no production claim is made in this report.
- Business modules are still local-only until later migrations route their reads/writes through scoped backend services.
- The current frontend is still a single large SPA bundle; Vite reports the pre-existing large-chunk warning.
- The first migration assumes PostgreSQL has `gen_random_uuid()` available, as confirmed by the local PostgreSQL 16 environment; production migration must be run and verified against its actual database before starting the service.
