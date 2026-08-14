# TASK 10 — Users, Roles, Permissions & Data Scope

**Hameed Hliwi Jewelry** · commits `925427e`, `ce18d0a` · migrations `0012`, `0013`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`, 36/36 production checks green.

---

## 1. Inspection baseline

The inspection was done before any design, because the task forbade guessing. What it found:

**Already built and sound.** The RBAC tables existed and were well shaped: `users` (with a
`session_version` column for revocation), `roles`, `permissions`, `user_roles`,
`role_permissions`, `user_warehouses` (with `is_manager`). 48 permission codes were seeded,
including `warehouses.scope.all` — the exact global-scope mechanism §12 asks for. Every sales
invoice already persisted `created_by_user_id`, so ownership (§5, §32) was already recorded.

**Production reality at inspection time.**

| | |
|---|---|
| Users | exactly one — `admin` / "Nabil Hliwi Administrator", active |
| Roles | exactly one — `system_admin` (48/48 permissions) |
| `user_warehouses` rows | zero — access came entirely from global scope |
| Warehouses | one — فرع الفرقان حميد حليوي |
| Sales invoices | 5, all with `created_by_user_id` populated |

**Four real gaps.**

1. **No seller isolation whatsoever.** `sales.list` filtered by warehouse only, and the private
   `invoice()` helper called `scope.assertAccess(user, warehouseId)` and nothing more. Any user
   with `sales.view` in a warehouse could list, open, print and cancel every colleague's invoice.
2. **No data-scope layer.** `WarehouseScopeService` answered only "all warehouses, or these?".
   The concept of `own` did not exist anywhere in the codebase.
3. **No users API at all.** `users.view` and `users.manage` were defined as permission codes but
   there was no `users` module in the backend — no create, no role assignment, no password reset.
4. **Frontend authority was a browser-side fiction.** `App.tsx` and `Sidebar.tsx` decided module
   visibility from `currentUser.permissions`, a set of legacy booleans, and `currentUser` came
   from `savedData?.currentUser || initialUsers[0]` in `StoreContext.tsx` — i.e. **localStorage**.
   The navbar could switch `currentUser` locally. Hiding a module meant nothing.

---

## 2. General Manager role

`general_manager` — **المدير العام** — created as the company's real business-level top role.

* Data scope `global`, carried by `warehouses.scope.all`.
* **No `user_warehouses` rows.** Its reach is the company, not a list of branches.
* Warehouses created later are inside its scope the moment they exist — verified, not assumed.
* 48 permission codes: every operational capability in the system.
* The user-creation screen shows `النطاق: كل مستودعات الشركة` and never asks "which warehouse?".
  A warehouse id sent by a client for a global role is discarded, not stored (asserted in test).

There is no fake `ALL` warehouse record anywhere.

## 3. Why `system_admin` was preserved

It was neither deleted nor renamed. It remains in the database as the **internal technical
role**, marked `is_system = true`, and is:

* excluded from the role presets returned by `GET /users/catalog`;
* **refused** if a client tries to assign it (`403` — asserted in test);
* invisible in the users screen role list.

Keeping it means the migration path was additive and reversible at every step. Deleting it would
have made the transition irreversible for no benefit.

## 4. Moving the administrator without risk of lockout

Done in the exact order §4 requires, and no step was taken on faith:

1. Migration `0012` created `general_manager` and granted it to **every** account already holding
   `system_admin` — additive only. After this migration `admin` held **both** roles and could not
   lose access whatever happened next.
2. Deployed, then verified in production that `general_manager` **alone** reaches every module
   (a temporary account holding only that role read Inventory, Finance, Accounting, Gold, Sales,
   Purchases, Returns, Partners, Warehouses and Users — all `200`).
3. The verification exposed one genuine difference: production carried a dormant permission
   `accounting.journal.post`, seeded by migration `0009` and required by **no endpoint**. It was
   the only code `system_admin` had that `general_manager` lacked.
4. Migration `0013` granted that code to `general_manager`, making the two roles byte-for-byte
   equal at 48 permissions, and only then dropped `system_admin` from accounts holding
   `general_manager`.

Final production state:

```
username | full_name                 | active | roles           | warehouse_rows | permissions
admin    | Nabil Hliwi Administrator | t      | general_manager | 0              | 48
```

48 permissions before the transition, 48 after. Nothing was lost. No warehouse mapping was
created for this account, as required.

---

## 5. Central data-scope model

`backend/src/authorization/authorization-scope.service.ts` — one service, one set of rules:

```
global      warehouses.scope.all         → no warehouse restriction, no ownership restriction
warehouses  explicit user_warehouses     → the assigned branches, all data inside them
own         data.scope.own (new code)    → the assigned branch, and only self-created documents
```

It answers: does this identity have global access · which warehouses · is it own-only · may it
reach this document owner · may it reach this warehouse · may it administer this target user.

`WarehouseScopeService` was kept but reduced to a thin delegation, so the many services that
already inject it keep working while there remains exactly **one** implementation of the rules.
No role-name checks were scattered into controllers — scope is derived from permission codes,
which the identity already carries.

`backend/src/authorization/authorization.constants.ts` is the single definition of permission
codes, role presets and module visibility. The SQL migration was **generated from that file**
rather than hand-written, so the database and the code cannot disagree. The seed and the
production bootstrap were rewritten to read the same constants.

---

## 6. Seller isolation — every path, not just the list

`data.scope.own` is enforced in two complementary ways:

**On the query** (`ownerCondition`) — the predicate is appended to the SQL, so hidden rows are
never fetched, never counted, and never paginated into view.

**On the object** (`assertDocumentOwner` / `assertDocumentAccess`) — every path that exposes a
document checks ownership before returning it:

| Path | Enforced |
|---|---|
| `GET /sales` list | ✅ query predicate |
| `GET /sales/:id` detail & print | ✅ `403` |
| `POST /sales/:id/cancel` | ✅ `403` |
| `GET /returns/returnable?invoiceId=` | ✅ `403` |
| `POST /returns` (return on a sale) | ✅ `403` on a fully valid payload |
| `GET /returns` list | ✅ query predicate |
| `GET /returns/:id` | ✅ `403` |
| `POST /returns/:id/cancel` | ✅ `403` |

**The client cannot override it.** A `sellerId` query parameter is only honoured for identities
that are *not* own-scoped; for a seller the forced predicate is pushed first and the parameter
is ignored entirely. This is asserted directly: Seller A requesting `?sellerId=<Seller B>` gets
back exactly their own list, unchanged.

**Search does not leak.** Seller A searching Seller B's exact invoice number returns zero rows.

---

## 7. Users backend module

New module at `backend/src/users/`, all operations server-authoritative:

```
GET    /users            list (scoped to what the actor may administer)
GET    /users/catalog    role presets, permission catalogue, allowed warehouses
GET    /users/:id        detail
POST   /users            create
PATCH  /users/:id        update name / role / warehouse scope / extra permissions
POST   /users/:id/status disable or reactivate
POST   /users/:id/password  reset
```

Every mutation re-derives the **target's resulting scope from the database** and checks it
against the actor's scope before writing. A branch manager cannot create a company-wide account
(`403`), cannot assign a warehouse outside their own (`403`), and cannot even read a global
account (`403`). An own-scope user administers nobody.

Two lockout guards: the last active company-wide account cannot be disabled or demoted, and an
actor cannot disable or demote their own account.

Per-user extra permissions are stored as a private single-user role (`override:<id>`, marked
`is_system`), so the shared preset roles are never mutated for one person. Scope-bearing codes
(`warehouses.scope.all`, `data.scope.own`) are refused as hand-picked extras — scope comes from
the role, never from a checkbox.

## 8. Role presets

| Preset | Scope | Warehouses | Permissions |
|---|---|---|---|
| **المدير العام** `general_manager` | global | none — automatic | 48 (everything) |
| **مدير مستودع** `warehouse_manager` | warehouses | one or more, explicit | 32 |
| **بائع** `sales` | own | exactly one | 8 |

The branch manager holds `users.view` / `users.manage` for their own branch, and sees all seller
activity inside their assigned warehouses — but not `warehouses.scope.all`, `warehouses.manage`,
`inventory.delete`, cashbox management, journal posting or gold adjustment.

The seller holds `sales.view`, `sales.create`, `returns.view`, `returns.create`,
`customers.view`, `customers.create`, `warehouses.view` and `data.scope.own`. The customer codes
exist only so the invoice form works; the Partners **module** requires `customers.update`, which
the seller does not have, so the screen never appears.

---

## 9. Frontend session identity migration

`GET /auth/me` now returns the resolved scope alongside the user:

```json
{ "user": {...}, "scope": { "type": "own", "allWarehouses": false, "ownDataOnly": true,
  "warehouses": [...], "modules": ["invoices","returns"] } }
```

The module list is computed on the **server** from real permission codes. The frontend renders
it; it does not decide it.

**Removed legacy local authority:**

* `StoreContext.currentUser` is no longer state read from localStorage — it is derived from the
  authenticated session on every render.
* `setCurrentUser`, `addUser` and `updateUser` were removed from the store entirely.
* The identity is no longer written into the localStorage snapshot.
* The navbar's "switch user" menu is **gone**. Changing account means logging out and in.

`App.tsx` and `Sidebar.tsx` derive every tab from `scope.modules`. `InvoicesView` receives
`canPurchase` and, for a seller, hides the purchase button and the purchase filter tab **and
skips the purchases request entirely**, so no forbidden endpoint is ever called.

## 10. Navigation by role

* **Seller** — lands directly in الفواتير, which is the only section in the menu. No Dashboard,
  Inventory, Purchases, Partners, Finance, Accounting, Gold, Reports, Users or Settings, and no
  greyed-out placeholders.
* **Branch manager** — the modules relevant to their warehouses; no Settings, no company-wide
  configuration.
* **General Manager** — the full system, with future warehouses appearing automatically.

## 11. Users & Permissions UI

Built inside the existing visual language — slate-900 headers, amber-400 accents, `rounded-sm`,
`border-2`, RTL — with no redesign of the application.

The workflow is the four-step flow §28 asks for: **المستخدم → الدور → النطاق → الوصول**. Roles
are picked as three descriptive cards, not a matrix. The full permission list is collapsed behind
an optional "صلاحيات إضافية" section and is never shown by default.

**Mobile (§29).** Verified at 390px and 430px:

* the user list is **cards** on phones and a table only from `sm` up — no desktop table forced
  onto a phone;
* the wizard is a full-height sheet rising from the bottom with a fixed header and a **sticky
  footer**, so the save button is always visible without scrolling;
* warehouse selection is a stack of touch-sized rows, not a dropdown;
* actions are a three-button grid at comfortable tap size;
* no horizontal overflow — the only scrolling container is the desktop table's own
  `overflow-x-auto`.

## 12. Session invalidation

Any security-sensitive change revokes every live session for that user through the existing
`revokeAllSessions` mechanism (revokes `auth_sessions` rows **and** bumps `session_version`, which
the access-token check validates):

* role change · warehouse scope change · permission change · password reset · account disabled.

Verified in production: changing a live seller's role returned `401` on their next request, and
the next login carried the new scope.

## 13. Disabled users and passwords

Disabling prevents new logins, kills live sessions, and **preserves all historical references** —
accounts with business history are never hard-deleted. Password reset sets a new hash via the
existing bcrypt path, never reveals or recovers the old one, and returns only
`{ id, username, passwordReset }`. No hash ever leaves the server; audit entries record that a
reset happened and never the secret. Usernames are normalised to lowercase, uniqueness-checked
case-insensitively, and blank or short credentials are refused.

## 14. Audit

`users.create`, `users.role.change`, `users.warehouse.change`, `users.permission.change`,
`users.disable`, `users.reactivate`, `users.password.reset` — all recorded with the actor, the
target and the before/after values. No plaintext password is ever written.

---

## 15. Tests

**`backend/test/task10-authorization.spec.ts`** — 24 assertions groups, all passing. It builds the
§36 cast (General Manager, Manager Furqan, Sellers A–E) *through the users API*, so the API is
exercised by the scenario rather than tested separately.

Covering: administrator still logs in after migration · general manager global with zero warehouse
rows · new warehouse visible without an assignment row · branch manager sees both sellers but is
refused the unassigned warehouse · Seller A ↔ Seller B isolation across list, direct id,
cancellation, returnable, return creation, search and forged `sellerId` · seller refused
Inventory, Finance, Accounting, Gold, Users, Purchases · branch manager cannot escalate to global
or reach another branch · session invalidation on role change · disabled account loses session and
login · password reset invalidates sessions and old password stops working · username normalisation
· invoice ownership preserved.

**Regression (§37), all passing:** `finance-cycle` (Task 07), `task071-regression`,
`accounting-core` (Task 08), `gold-accounts` (Task 09), `task091-regression` (Task 09.1). The
`sales` role gained `data.scope.own` in this task, and the Task 07/09 suites use a sales user —
they were re-run specifically to confirm that change broke nothing.

One issue found and fixed during this work: the new suite created a warehouse that outsorted the
default one and broke sibling suites. It now deletes the warehouse it creates, and the suite
leaves the environment exactly as it found it.

## 16. Production migration and deployment

Procedure followed exactly as in previous tasks:

1. `pg_dump` backup before each migration — `backup_pre_task10_20260814_210816.sql`,
   `backup_pre_task10b_20260814_211239.sql`.
2. Commit transferred as a git bundle, applied with `git pull`.
3. Migration applied as the PostgreSQL owner in a **single transaction** with `ON_ERROR_STOP=1`.
   **`drizzle-kit push` was not used.** The application database account was not broadened.
4. Hash recorded in `drizzle.__drizzle_migrations` (ids 13, 14).
5. Backend and frontend rebuilt.
6. **Only `hameed-hliwi-api` and `hameed-hliwi` restarted.** No other VPS application touched.

## 17. Production verification

36 checks against the live public URL `https://hameed-hliwi.org/api/v1`, **36 passed, 0 failed**,
run twice — once after migration `0012` and again after `0013`.

Verified: general manager login over the public URL · global scope with zero warehouse rows ·
users API and catalog · `system_admin` absent from presets · seller created through the API with
own scope and exactly one warehouse · seller navigation is invoices only · **seller sees none of
the five real production invoices, is refused their direct id, their cancellation and their
returnable lookup, and a search by their exact invoice number returns nothing** · seller refused
Inventory, Finance, Accounting, Gold, Users, Purchases · general manager reads every module ·
session revoked on a scope change.

The verification created two temporary accounts and deleted them afterwards. **It never posted a
business document.** Isolation was proven against Nabil's five real invoices by confirming a
seller cannot see them — no production data was written, modified or deleted:

```
before → sales=5 inventory=10 journals=9 gold=1
after  → sales=5 inventory=10 journals=9 gold=1
remaining users: admin
```

---

## 18. Final acceptance

| Requirement | Status |
|---|---|
| Operational role `general_manager`, company-wide, no warehouse assignment | ✅ |
| Sees all current and future warehouses | ✅ verified with a warehouse created after the fact |
| Warehouse manager: explicit scope, all authorised sellers inside it only | ✅ |
| Seller: one warehouse, invoices only, own data only | ✅ |
| Seller cannot reach another seller's invoice by direct API request | ✅ `403` on every path |
| Backend session is the authority | ✅ `/auth/me` drives navigation |
| localStorage cannot impersonate a user | ✅ local switching removed, identity derived from session |
| Scope enforced server-side | ✅ query predicate **and** direct-object check |
| Current design preserved, simple, fully responsive | ✅ verified at 390px / 430px |

---

## 19. Remaining risks and notes for Nabil

1. **Visual check on your phone.** The users screen was built and reasoned for 390/430px but I
   have not seen it on your device. Worth one look at the four-step wizard.
2. **`admin` now holds `general_manager` only.** Your login, password and access are unchanged —
   48 permissions before, 48 after — but the role name shown in the system is now المدير العام.
3. **No sellers exist in production yet.** The model is deployed and proven; creating the real
   sellers is a business decision. When you create one, remember the seller is bound to exactly
   one warehouse and will only ever see their own invoices — including in reports and returns.
4. **`accounting.journal.post` is dormant.** It is granted to the General Manager for parity but
   no endpoint requires it. If a future task adds journal posting, that code is already in place.
5. **A branch manager can administer users in their own branch.** This is what §14 and §31 ask
   for. If you would rather user administration stay with you alone, removing `users.manage` from
   the `warehouse_manager` preset is a one-line change.
6. **Login still asks for a warehouse.** For a seller with one warehouse this is one extra tap.
   Auto-selecting the only warehouse a user has would be a small, separate improvement.

**TASK 10 = CLOSED / PASSED.**
