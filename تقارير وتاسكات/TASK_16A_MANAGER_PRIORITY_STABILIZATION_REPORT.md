# TASK 16A — Production Stabilization: Logout, Sales, Permissions & Weight Custody

**Hameed Hliwi Jewelry** · commit `8d4f559`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`, 25/25 live checks green.
**No database migration.** TASK 16 Costing/COGS remains **deferred** — nothing was built.

---

## 1. The logout 400 — exact root cause

You were right to override the TASK 15 result. Reproduced against production, the server's own
answer named the fault:

```
POST /api/v1/auth/logout
400  {"error":"BAD_REQUEST",
      "message":"Body cannot be empty when content-type is set to 'application/json'"}
```

Fastify refuses an empty body when that content type is set, and rejects the request **before it
reaches the route** — so no amount of logout-handler logic could have helped.

The client set `Content-Type: application/json` on *every* request, including the POSTs that
legitimately carry no body.

**Why TASK 15 passed while you kept failing.** My test sent no `Content-Type` header at all:

```
A. no Content-Type   (what my test sent)     → 201  {"success":true}
B. application/json  (what the browser sends) → 400  Body cannot be empty…
```

The test exercised a request shape no browser ever produces. That is my error, and §31 names it
precisely.

**A second victim, previously invisible.** `/auth/refresh` and `/auth/logout-all` are also
body-less POSTs and returned the same `400`. So **browser token renewal had never worked**: once
the 15-minute access cookie expired, renewal failed and the retry never happened. TASK 15's
renewal-list change could not help, because the renewal call itself was being rejected.

## 2. The fix — both sides

Either side alone leaves a real gap, so both were fixed.

**Client.** The JSON content type is sent only when there is a body. Notably, **eight of the
eleven** service clients already did this correctly; `infrastructureApi` (the auth client),
`shiftsApi` and `historyApi` did not.

```ts
headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
```

**Server.** An empty body under `application/json` is now parsed as an empty object; malformed
JSON is still a `400`. Nest installs its own parser during `init()`, so the app is initialised
first and the parser replaced afterwards. This makes the API tolerant of the real-world request
shape regardless of which client sends it — a proxy or a future client cannot resurrect the bug.

## 3. Logout across authentication states (§3)

| State | Result |
|---|---|
| A — access token valid | `201`, session revoked |
| B — access expired, refresh valid | refresh `201`, then logout `201` |
| C — no access cookie | refresh identifies the session, logout succeeds |
| D — already revoked | `401`, harmless — never a `400` |

After logout: `/auth/me` `401`, protected APIs `401`, and the old refresh token cannot recreate
the session (§5, §6). No request body is required in either header form (§4).

## 4. A test that cannot pass this bug again

`backend/test/task16a-logout-browser-path.spec.ts` sends **the exact headers a browser sends** on
every call. It fails if the JSON content type ever returns to a body-less POST, and it covers
logout, logout-all and refresh in all four authentication states.

## 5. Regression — all suites green

TASK 15 Logout · TASK 14 Weight Custody · TASK 13 Used Gold · TASK 12 History · TASK 11 Shifts ·
TASK 10 Authorization · TASK 09.1 Inventory/Sales sync · TASK 09 Gold · TASK 08 Accounting ·
TASK 07 Finance · TASK 07.1 — **eleven suites, all passing.**

These cover the Sales journey end to end (§8–§12): stock deduction, aggregate weight sales,
manual sales creating the approved historical negative record, barter/scrap gold, automatic
receipt vouchers, receivables, accounting balance and shift linkage. Seller isolation, role
hierarchy and session invalidation (§14–§17) are covered by the TASK 10 suite; weight custody
free-person and per-karat behaviour (§18–§25) by the TASK 14 suite.

## 6. Production verification — 25/25

Against the live site, using the exact browser request from your console:

*Logout* — `/auth/me` `200` → **`POST /auth/logout` = `201`, no longer `400`**, response
`{"success":true}` → `/auth/me` `401` → protected API `401` → revoked refresh `401` → repeated
logout `401` (not `400`) · expired-access path: refresh `201` then logout `201` · fresh login
works.

*Permissions* — a temporary seller was refused `/inventory`, `/finance/cashboxes`,
`/accounting/accounts`, `/gold/accounts`, `/users` and `/gold/custody/balances` (all `403`), saw
**zero** of the existing invoices, and their own logout worked.

*Weight custody* — balances readable by the General Manager, **your real custody person
preserved**, and the gold ledger still nets to exactly `0.000` pure gold (§24).

*Safety* — books identical before and after, trial balance balanced, and **no costing table
exists** (§28 confirmed by query).

## 7. What was deliberately not touched

* **TASK 16 Costing is deferred.** No cost layers, no COGS account, no FIFO, no valuation, no
  costing migration. The inspection findings are preserved in §8 below for whenever you resume.
* **The invoice template** — zero invoice files changed (§13).
* **The chart warnings** (`width(0) and height(0)`) are a separate Dashboard issue and were not
  the cause of the 400. Left alone per §7.
* **Your real data** — `admin`, `hameed`, `nabil`, 9 partners, 5 sales, 10 inventory items and
  your custody person are all untouched. Only accounts named `t16a_*`, created by this run, were
  removed (§26, §27).

## 8. TASK 16 inspection findings, preserved

Recorded so the costing work can resume without re-inspecting:

1. **Purchase lines already carry a usable acquisition basis** — `goldValueUsd`,
   `workmanshipValueUsd`, `lineTotalUsd`, `netWeightGrams`. `lineTotalUsd` is the capitalized
   line amount and **already includes workmanship**, so it must not be added twice.
2. **`inventory_items` has no cost field.** Its `laborFeeUsdPerGram` / `totalLaborFeeUsd` are
   **selling-side** workmanship, not acquisition cost — exactly the confusion §46 warns about.
3. **The chart of accounts has `inventory` and `opening_equity` but no `cost_of_goods_sold`**, so
   a COGS system account is needed while opening valuation can reuse the existing equity path.
4. Still to trace before designing: how the accounting service posts a purchase into `inventory`
   (to avoid double-posting), whether production has any purchases to backfill from, and whether
   `sales_gold_exchanges.valueUsd` gives Used Gold a provable basis.

---

## 9. Remaining risks

1. **Please confirm on your own device.** The server now answers correctly on the exact browser
   request, but the final word on the button is yours — log in, wait past fifteen minutes, then
   press تسجيل الخروج.
2. **The lesson from this task is worth keeping.** A test that does not replicate the real
   request shape can pass while production fails. The new suite pins the browser headers for
   this path; other POST paths are covered by the eight clients that already guarded correctly.
3. **The 15-minute access cookie is unchanged.** Renewal now genuinely works, so the short
   lifetime is no longer felt. Lengthening it would be a security decision, not a UX one.

**TASK 16A = CLOSED / PASSED.**
