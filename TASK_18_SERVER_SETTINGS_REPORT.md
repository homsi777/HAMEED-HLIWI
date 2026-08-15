# TASK 18 — Server Settings, Gold Prices & Exchange Rate

**Hameed Hliwi Jewelry** · commit `595b77e`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`.

**One action is waiting for you — see §10.** TASK 16 Costing/COGS remains **deferred**.

---

## 1. What was actually wrong

The settings screen had nothing behind it:

```
backend/src/            no settings module
database/schema.ts      no settings table, no gold_prices table
src/services/           no settingsApi.ts
StoreContext.tsx        localStorage.setItem(LOCAL_STORAGE_KEY, …)
PrintInvoiceModal.tsx   reads `settings.` in 4 places
```

The exchange rate, the gold prices, the workmanship fees and the shop's own name lived in **each
browser separately**. Two devices could price the same goods differently on the same day and
nothing in the system would notice; clearing browser data erased the shop's pricing; and the
approved invoice printed a store name held in a browser.

## 2. What it looks like now

One row on the server, read by every session:

```
app_settings       one row, enforced by a constraint — not by convention
gold_prices        one row per karat, never merged
settings_history   append-only: field, old value, new value, actor, timestamp
```

## 3. Seeding — derived, not invented

Your real values existed only in your browser and could not be read from the server. Rather than
invent plausible-looking prices — **a wrong price that looks right is worse than a visible
placeholder** — the migration derived them from your own posted documents:

| value | source | seeded |
|---|---|---|
| exchange rate | most recent posted sale | **13,200** |
| karat 21 selling price | most recent posted 21K sale line | **122.00 $/g** |
| karat 21 workmanship | the same line | **12.00 $/g** |
| karats 24 · 22 · 18 · 14 | never sold | **0 — visibly unset** |
| buying prices | no equivalent source on the sales side | **0 — left unset rather than guessed** |

You should recognise 13,200 and 122. They are yours, read back out of your own invoices.

## 4. The guarantee this task turns on

Changing the rate must change what the **next** document is priced at and nothing else. Every
posted document already snapshots its own rate; that had to survive.

The suite doubles the rate on a live posted sale and asserts:

```
sale total USD      unchanged
sale total SYP      unchanged   ← the one that would have moved
journal behind it   unchanged
stored rate on the invoice      still the rate it was written with
```

Then it re-checks the books: **trial balance balanced, AR and AP matching, and every cashbox still
reconciled in its own currency**. A rate change cannot reach backwards.

## 5. A real security defect, found and fixed here

While writing the permission tests, a seller successfully changed the shop's exchange rate.

**Root cause.** The controller carried `@UseGuards(AuthGuard)` but not `PermissionGuard`. Without
it, `@RequirePermissions('settings.manage')` is **decorative and silently does nothing** — no
error, no warning, just an unguarded endpoint.

This is precisely the failure mode the specification's own §16 exists to catch, and it was caught
by a test rather than by reading the code. It is fixed, the reason is recorded at the decorator,
and the boundary is now verified on production (§9).

## 6. Permissions

* **Reading needs no permission beyond being signed in.** A seller cannot price a sale without the
  gold price; this is a read every session performs.
* **Changing needs `settings.manage`**, added through the TASK 10 constants file — the single
  source of truth — and granted by the migration to the roles that already held company-wide
  configuration through `warehouses.manage`. **Nobody gained or lost access**; only the code
  expressing it changed.
* The seller's navigation is unchanged: still exactly `history · invoices · returns`.

## 7. Concurrency and history

Saving carries a `version`. A stale one is refused with `409` rather than silently overwriting
another manager. Every field that actually moved gets a history row — a value re-saved unchanged
does not earn one.

## 8. Propagation — stated honestly

The backend emits `settings.changed` to every connected session. **There is no socket client in
this frontend**, so convergence is achieved by re-reading the settings on load and again whenever
the app is brought back to the front — which covers a seller's phone returning to the app.

That is weaker than a push and I am not calling it one. If you want true push, it needs a socket
client added to the frontend, and that is its own small task.

## 9. Production verification

Against `https://hameed-hliwi.org/`, using two temporary accounts created for the run and **both
deleted afterwards** (only `admin`, `hameed`, `nabil` remain):

```
settings served from the server   rate 13,200 · karat 21 = 122 / 12 · provisional = true

seller MAY read                   sees the same rate and the same karat price
seller MAY NOT change             PATCH /settings            403
                                  PUT  /settings/gold-prices 403
                                  GET  /settings/history     403
seller navigation                 ['history','invoices','returns'] — settings absent
after those attempts              rate still 13,200 — nothing moved

unauthenticated                   GET and PATCH both 401
books                             14,046.0000 = 14,046.0000 · AR ✓ · AP ✓
```

Deployed bundle `index-7v_qCHl1.js` contains the provisional banner and the save-failure message.

## 10. **What is waiting for you**

The seeded values are flagged **provisional**. Open Settings and you will see:

> هذه القيم مبدئية — استُنتجت من آخر مستنداتك المرحّلة ولم يؤكّدها أحد بعد.

Check the rate and the karat prices, correct anything that is stale, and press save. That clears
the flag and makes the values authoritative.

**Four karats and every buying price are currently zero** because there was no honest source for
them. They need entering.

## 11. Migration and deployment

```
backup      /home/ubuntu/backups/pre-task18-20260815-184708.sql  (384 KB, before the migration)
migration   0018_task18_settings.sql — applied as the PostgreSQL owner, single transaction,
            ON_ERROR_STOP=1, hash recorded in drizzle.__drizzle_migrations
ownership   the three new tables reassigned to hameed_hliwi_app
restart     hameed-hliwi-api, hameed-hliwi only
untouched   abooerp-backend, clotexerp-server, obada-server — all still online
```

`drizzle-kit push` was not used. Books identical before and after the migration.

## 12. Regression — twelve suites green

TASK 18 Settings · TASK 07 Finance · TASK 08 Accounting · TASK 10 Authorization · TASK 11 Shifts ·
TASK 12 History · TASK 13 Used Gold · TASK 14 Weight Custody · TASK 16A Logout ·
TASK 17 ×3 (reconciliation, seller stock sales, inventory provenance).

`task091-regression` still fails for the reason recorded in the TASK 17 report — it predates this
work and is a shared-development-database artefact.

## 13. Safety confirmations

* **COGS remains deferred.** A gold price is a selling price, not an acquisition cost; no cost
  field, cost layer or valuation was added.
* **The invoice template is visually unchanged.** It now reads the store identity from the server
  instead of `localStorage` — same fields, same markup.
* **`localStorage` is now a cache, not the authority.** It renders the app before the first
  response lands and is overwritten by the server on every load.
* **Production data untouched** apart from the three new tables. Books identical throughout.

## 14. Commit

```
595b77e  feat(settings): move the exchange rate, gold prices and store identity to the server
```

---

## Verdict

**TASK 18 = CLOSED / PASSED.** The shop's operating parameters are on the server, identical on
every device, changeable only by whoever runs the company, recorded when they change, and unable to
reach backwards into a single posted document.

The one thing left is yours: open Settings, confirm the numbers, and save.

Next, per the order we agreed: **TASK 19 — Operational Reports**.
