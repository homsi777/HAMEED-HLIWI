# TASK 19 — Operational Reports

**Hameed Hliwi Jewelry** · specification drafted 2026-08-15
**Status: SPECIFICATION — not started. Depends on TASK 18.**

TASK 16 Costing/COGS remains **deferred**. This task must not work around that.

---

## Background — what exists and what it is worth

`ReportsView.tsx` is a 98-line shell listing **17 reports**, reading client-side legacy data. The
list itself is good and largely worth keeping. What is missing is a server behind it.

Two findings shape this task.

### One report on that list cannot honestly be built yet

The list contains `profit — أرباح المصنعية`. Read carefully, that is **workmanship revenue**, not
gross profit — and workmanship revenue *is* a real recorded figure: every sale line stores
`workmanshipValueUsd`.

So it is buildable, but only under its true name. **Gross profit on the gold itself is not
buildable**, because there is no acquisition cost (TASK 16). Live production proves the point:

```
inventory origins on a live page:  3 historical · 2 direct · 0 purchase
filter origin=purchase          :  0 rows
```

Almost nothing in the shop has a purchase behind it. A profit figure today would be fiction with a
decimal point.

### Reports must not re-implement TASK 12

`سجل الفواتير` and `سجل الأوزان المباعة` already exist, are paginated, filtered and scoped. Reports
**aggregate** and **drill into** them. A second list of invoices with slightly different totals is
the worst possible outcome of this task.

---

# PART A — Principles

## 1. Derived, never stored

Every figure is computed from the authoritative records at read time. No report table, no nightly
rollup, no cached total. This is the rule the whole system has followed since TASK 07 and the
reason its numbers reconcile.

## 2. Currencies are never summed

USD and SYP are reported side by side, never added. A single "total" spanning both is forbidden.

## 3. Karats are never merged

Grams of 21K and 18K are different goods. Where a single headline weight is genuinely needed, state
it in **pure gold** and label it as such — the convention TASK 09 established.

## 4. No cost, no profit, no valuation

Forbidden in this task:

```
COGS · FIFO · cost layers · inventory valuation · gross profit · margin
```

**Permitted**, because they are recorded facts:

```
workmanship revenue        (sales_invoice_items.workmanship_value_usd)
sales value                (final_total_usd)
outstanding receivables    (the subledger, as fixed in TASK 17)
weights sold and returned  (TASK 12)
```

## 5. Inventory "value" needs care

A current-inventory report may state **weight** freely. If it states a money value it must be
labelled as *an indicative valuation at today's gold price*, never as cost and never as profit. If
that cannot be made unambiguous in the UI, state weight only and say so in the report.

## 6. Scope is enforced server-side

A seller sees their own documents. A warehouse manager sees their warehouses. The General Manager
sees everything. Reuse the TASK 10 scope service; do not re-derive the rules.

A `sellerId` or `warehouseId` in the query may **narrow** what the caller already holds and must
never widen it.

## 7. Aggregate on the server

No report may download rows to the browser and total them in React. This is both a performance rule
and a correctness rule — two clients must never disagree because one had a shorter page.

---

# PART B — The reports

Build the ones the data supports. Each is one endpoint returning aggregates plus, where useful, a
short list of the top rows with a link into the owning module.

## 8. Overview

Liquidity, gold on hand by karat, sales for the period, outstanding receivables and payables. This
is the manager's first screen and must load fast.

## 9. Sales

By period, warehouse, seller and karat: invoice count, pieces, weight, value, paid, outstanding.

## 10. Sales by customer

Per partner: invoice count, value, outstanding. Tapping a row opens the TASK 17 customer workspace.

## 11. Sales by karat

Pieces, weight sold, weight returned, net weight, value. Never merged across karats.

## 12. Purchases

The mirror of §9 for purchase invoices, including partners whose master role is `customer` —
TASK 17 §46 made that legitimate and the report must not filter them out.

## 13. Workmanship revenue (§4)

Recorded workmanship on sale lines, by period and karat. **Titled as workmanship revenue.** It must
not be called profit, and the screen must not imply that it is the shop's profit.

## 14. Current inventory

Pieces and weight by karat, by warehouse, by condition and — new since TASK 17 — **by origin**.
`origin` is already derived and filterable server-side; reuse it rather than re-deriving.

## 15. Item movement

Search by code or name and show that piece's history: how it entered, transfers, sale, return.
TASK 17 provenance answers the first question already.

## 16. Receivables and payables

Per partner, from the subledger fixed in TASK 17 — never from `partners.opening_balance_usd`.

**Aging** (current / 30 / 60 / 90+) is worth building and is derivable from invoice dates. Confirm
by inspection that the dates support it before promising it.

## 17. Cash

Cashbox movements and closing balances, each in its own currency (§2).

## 18. Expenses

By category and period, from the existing expense records.

## 19. Gold and custody

Physical gold by karat and warehouse; outstanding weight custody per person per karat. These are
**separate domains** and must not be added together — the rule TASK 14 established.

## 20. Shifts

Per shift: seller, opened, closed, documents, expected versus counted custody, variance. TASK 11
already computes these; the report presents them across a period.

## 21. Stocktake

Saved stocktakes and their differences. Read-only here; performing a stocktake is not this task.

## 22. Audit

The audit trail is written today and read nowhere. Surfacing it — filtered by actor, module and
period — is genuinely valuable and belongs to a manager, never to a seller.

## 23. Drop what cannot be honest

If a report on the existing list cannot be built without inventing cost, **remove it from the list
rather than shipping an empty or misleading screen**, and say so in the report.

---

# PART C — Mobile

## 24. This is a phone-first screen

The manager reads reports on a phone. 390 and 430 px are mandatory, not an afterthought.

## 25. Tables do not fit

A wide table must either become cards on narrow screens or scroll **inside its own container**. The
page body must never scroll horizontally.

## 26. Date ranges without a date picker fight

Offer presets — اليوم · أمس · هذا الأسبوع · هذا الشهر · مخصص. A manual two-date picker as the only
option is painful on a phone and will not be used.

## 27. Numbers must be readable

Arabic RTL, monospace figures, thousands separators, currency stated on every figure. A number
whose currency is implied is a number that will eventually be read wrong.

## 28. Load fast, then detail

Show the headline aggregates first. Long lists load underneath and are paginated.

---

# PART D — Export

## 29. Print

Reuse the existing print approach. **Do not build another invoice template** — TASK 17 §57 and
TASK 15 §52 still hold.

## 30. File export from a phone

If CSV or PDF export is offered, it must actually work on a mobile browser. See TASK 20 §22–§26 —
the same download constraints apply and should be solved once and reused, not twice.

## 31. Exports respect scope

An export contains exactly what the caller may see on screen. A seller must not be able to export
the company's figures.

---

# PART E — Testing

## 32. Reports agree with the modules they summarise

The decisive test. For a controlled period:

```
report total sales   = the sum the sales module reports for the same filter
report receivables   = the AR subledger = GL AR
report sold weight   = TASK 12 سجل الأوزان المباعة for the same filter
```

A report that disagrees with its own source is worse than no report.

## 33. Cancelled documents

Prove explicitly how cancellations are treated — excluded, or shown and marked. Either is
defensible; silence is not. Assert it.

## 34. Returns

A sale of 50 g with a 20 g return must not read as 50 g sold anywhere.

## 35. Scope

* seller sees only their own documents in every report
* warehouse manager sees only their warehouses
* a browser-supplied `sellerId` cannot widen a seller's view
* General Manager sees all

## 36. No forbidden fields

Assert that no report response contains `cost`, `acquisition`, `COGS`, `margin` or `profit` —
except the workmanship report, under its true name.

## 37. Performance

No N+1. State the query count per report. A report must not slow down linearly with the number of
invoices.

## 38. Regression

All suites, including the three TASK 17 suites and TASK 18.

---

# PART F — Constraints

## 39. TASK 16 stays deferred

No costing work, in any disguise.

## 40. Invoice template locked

Zero visual change.

## 41. No duplication of TASK 12

Reports aggregate and link. They do not re-list.

## 42. Production data

Do not modify real data to make a report look better. If a figure looks odd, inspect and explain
it — that is a finding, not a bug to paper over.

## 43. Prefer no migration

If a report needs a new index for performance, that is a legitimate migration. A new **table** of
precomputed totals is not — see §1.

## 44. Deployment

`https://hameed-hliwi.org/`. Restart only the two applications. Backup before any migration. Never
`drizzle-kit push`.

## 45. Verify on the public site

Open the reports on the real domain at mobile width and confirm the figures against the modules.

---

# Final acceptance

TASK 19 is **CLOSED** when:

* every report is computed on the server from authoritative records
* every report's totals **agree with the module they summarise**, proven by test
* no report states cost, COGS, margin or gross profit; workmanship revenue appears under its true
  name
* currencies are never summed and karats are never merged
* scope is enforced server-side and cannot be widened from the browser
* the reports are genuinely usable at 390 and 430 px with no horizontal overflow
* any report that could not be built honestly is removed and named in the report

Do not start Dashboard afterwards. Return the final report first.
