# TASK 18 — Server Settings, Gold Prices & Exchange Rate

**Hameed Hliwi Jewelry** · specification drafted 2026-08-15
**Status: SPECIFICATION — not started.**

TASK 16 Costing/COGS remains **deferred**. This task does not touch it.

---

## Background — what inspection actually found

This task was not on the roadmap. It was written after checking what backs the settings screen,
and the answer is: nothing.

```
backend/src/            → no `settings` module
database/schema.ts      → no settings table, no gold_prices table
src/services/           → no settingsApi.ts
StoreContext.tsx        → localStorage.setItem(LOCAL_STORAGE_KEY, …)
PrintInvoiceModal.tsx   → reads `settings.` in 4 places
```

**The shop's exchange rate, gold prices, labour fees and store identity live in each browser
separately.** They have never been on the server.

### Why this matters more than it looks

1. **Two devices can price differently.** A seller's phone holding `usdToSypRate = 14000` and the
   manager's desktop holding `14500` will produce different invoices for the same goods on the
   same day, and nothing in the system will notice.
2. **The printed invoice carries a browser's idea of the shop.** The approved template reads the
   store name from `localStorage`.
3. **Clearing browser data erases the shop's pricing.** There is no copy anywhere else.
4. **Reports cannot be trusted until this is fixed.** Any report that states a value needs a gold
   price and a rate that everyone agrees on. Building TASK 19 on top of per-browser settings would
   produce numbers that differ per device — which is worse than no report at all.

That last point is why this task is numbered before Reports.

---

# PART A — The settings store

## 1. Business goal

One authoritative set of operating parameters, held on the server, identical on every device,
changeable only by those authorised, and never silently repricing history.

## 2. Tables

Add server tables. **A migration is required here** — unlike TASK 17, nothing existing can be
derived from.

At minimum:

* **`app_settings`** — the singleton operating parameters (store identity, exchange rate, and
  whatever the current `SettingsView` legitimately owns).
* **`gold_prices`** — one row per karat: buy price, sell price, labour fee per gram.
* **`settings_history`** — an append-only record of every change: what changed, from what, to what,
  by whom, when.

Inspect `SettingsView.tsx` and `StoreContext.tsx` first and carry across **only** what is genuinely
an operating parameter. Anything that is really per-user preference (a collapsed panel, a chosen
tab) stays in the browser and must not be promoted to a company setting.

## 3. Singleton, not a row per anything

There is one shop. `app_settings` holds exactly one row, enforced by a constraint rather than by
convention, so no code path can ever create a second and leave the system asking which is real.

## 4. History is append-only

`settings_history` is never updated or deleted. A correction is a new row. This is the same rule
the ledgers already follow, and it is what will later let a report say *what the price was on the
day of that invoice* rather than what it is now.

Record at least: the field, the old value, the new value, the actor, and the timestamp.

## 5. Seeding — and the one thing that cannot be automated

The current real values exist **only in your browser**. They cannot be read from the server, and I
will not guess them.

The migration therefore seeds a documented, obviously-provisional default set. **The first action
after deployment is for the General Manager to open Settings and enter the true values.** The
report for this task must state plainly that this step is required and was not performed for you.

Do not invent plausible-looking gold prices. A wrong price that looks right is worse than an
obvious placeholder.

---

# PART B — Exchange rate

## 6. One rate, server-held

`usdToSypRate` moves to `app_settings`. Every client reads it from the server.

## 7. Changing the rate must never reprice history — verify, do not assume

Every posted document already snapshots its own `exchange_rate_syp_per_usd`: sales, purchases,
returns, vouchers, cashbox transfers and journal lines all carry it.

**That guarantee must not regress.** The acceptance test is explicit:

```
record a sale at rate 14000
change the rate to 15000
re-read the sale  → its rate, its SYP total and its journal lines are unchanged
```

## 8. Cash balances are compared in their own currency

TASK 08 already established that a SYP cashbox holds USD at historical rates and is reconciled in
its own currency. Changing the rate must not disturb that. Re-run the reconciliation before and
after a rate change and prove both sides still match.

## 9. Rate changes are audited

A rate change is a commercially significant act. It goes to `settings_history` **and** to the
existing audit service.

---

# PART C — Gold prices

## 10. Per karat

Each of `24 · 22 · 21 · 18 · 14` carries its own buy price, sell price and labour fee per gram.
**Karats are never merged**, exactly as everywhere else in this system.

## 11. Derivation from the ounce price

`StoreContext` currently derives all karat prices from a base ounce price
(`recalculateAllGoldPricesFromBase`). Decide and document one of:

* the server derives them the same way and stores the result; or
* the server stores the base and derives on read.

Either is defensible. What is not acceptable is two different derivations — one on the server and
one left in the browser — which would drift apart.

## 12. Prices are defaults, not enforcement

A gold price seeds the sale form. It has never constrained what a document may record, and it must
not start now: an already-posted invoice keeps the price it was written with.

## 13. Price history

Every price change lands in `settings_history`. This is what makes a future "what did we sell at
last month" report answerable.

---

# PART D — Permissions

## 14. Who may read

Any authenticated user may **read** the operating parameters — a seller cannot price a sale
without the gold price. This is a read every session performs.

## 15. Who may change

Changing prices, the exchange rate or store identity requires an explicit permission, held by the
General Manager and not by a seller or a warehouse manager unless you decide otherwise.

Add the permission through the TASK 10 constants file, the single source of truth. Do not
special-case it in a controller.

## 16. Server-side enforcement

As always: hiding the screen is not a permission. A seller calling the update endpoint directly
must receive `403`.

## 17. Seller navigation is unchanged

Adding a read permission must not add Settings to the seller's module list. Verify the seller's
modules are exactly what TASK 10 asserts, plus nothing.

---

# PART E — Propagation

## 18. Every device must converge

When the manager changes the rate, a seller's open session must not keep pricing at the old one.

`RealtimeGateway` already exists and is used elsewhere. Emit a settings-changed event and have
clients refetch. State explicitly what happens to a client that is offline at that moment.

## 19. A sale in progress

Decide and document: if the rate changes while a seller has a half-finished invoice open, does the
open form keep the rate it started with or adopt the new one?

**Recommendation:** keep the rate the form started with, show a quiet notice that the rate changed,
and let the seller decide. Silently changing the price of goods a customer is already looking at is
worse than a stale number.

## 20. The server is the arbiter regardless

Whatever the form displays, the document is posted with the rate the **server** validates. A
client-supplied rate is an input to be checked, never trusted.

---

# PART F — The frontend

## 21. Do not redesign Settings

`SettingsView.tsx` exists and is approved. This task changes **where its values come from**, not
how it looks.

## 22. The invoice template stays locked

The approved Sales/Purchase invoice template is unchanged. It will now read the store identity from
the server instead of `localStorage` — same fields, same markup, same layout. **Zero visual
change.**

## 23. localStorage stops being the source of truth

Once the server owns these values, the browser copy must not be able to override it. A stale cached
value that survives and wins is exactly the bug this task exists to remove.

Decide whether to keep a cache for offline reads, and if so make it explicitly a cache — refreshed
on connect, never authoritative.

## 24. Mobile 390/430

Settings is edited from a phone. Verify at both widths:

* no horizontal overflow
* the karat price table is usable — a wide table scrolls inside its own container, or becomes cards
* numeric inputs raise a numeric keypad
* save is reachable without hunting

## 25. Saving must be unambiguous

A manager changing the exchange rate needs to know it took effect. Show the saved state plainly.
Silence after a save on a phone reads as failure.

---

# PART G — Testing

## 26. Server authority

```
device A sets the rate → device B reads the same value without being told
```

## 27. History is not repriced (§7)

The explicit before/after test above, on a real posted sale.

## 28. Reconciliation survives a rate change (§8)

Trial balance balanced, AR/AP matching, cash reconciled — before and after.

## 29. Permissions

* seller reads the gold price: allowed
* seller writes any setting: `403`
* seller's module list unchanged
* unauthenticated read: `401`

## 30. History records the change

Old value, new value, actor and timestamp all present and correct.

## 31. Singleton holds

No code path can create a second settings row.

## 32. Regression

TASK 07 Finance · TASK 08 Accounting · TASK 09 Gold · TASK 10 Authorization · TASK 11 Shifts ·
TASK 12 History · TASK 13 Used Gold · TASK 14 Weight Custody · TASK 16A Logout · TASK 17 ×3.

Particular attention: anything that reads a rate or a gold price.

---

# PART H — Constraints

## 33. No COGS

TASK 16 stays deferred. A gold price is not an acquisition cost and must not be treated as one.
Do not add a cost field, a cost layer, or a valuation to inventory.

## 34. Invoice template locked

Zero visual change, as above.

## 35. Production data

The real values are yours to enter. Do not fabricate them, and do not overwrite anything you did
not create.

## 36. Migration discipline

Backup first. Apply as the PostgreSQL owner in one transaction with `ON_ERROR_STOP=1`. Record the
hash in the migrations ledger. **Never `drizzle-kit push`.**

## 37. Deployment

Deploy to `https://hameed-hliwi.org/`. Restart only `hameed-hliwi-api` and `hameed-hliwi`. Do not
touch the other three applications on that VPS.

## 38. Verify on the public site

Not localhost. Confirm the values load from the server on a real page, and confirm the seeded
placeholders are visibly placeholders.

---

# Final acceptance

TASK 18 is **CLOSED** when:

* the exchange rate, gold prices and store identity live on the server and every device agrees
* changing any of them **cannot** alter a single posted document, proven by test
* every change is recorded in history with actor and timestamp
* a seller may read prices and may not change them, enforced server-side
* the approved invoice template is visually unchanged and now reads server-held identity
* Settings is usable at 390 and 430 px
* the report states plainly that the true values must still be entered by you

Do not start Reports before this is closed — see the reasoning at the top.
