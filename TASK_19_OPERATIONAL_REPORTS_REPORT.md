# TASK 19 — Operational Reports

**Hameed Hliwi Jewelry** · commit `5a4fa3f`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`.

TASK 16 Costing/COGS remains **deferred**, and this task did not work around it. No migration.

---

## 1. What was there before

`ReportsView.tsx` was a 98-line shell: a good catalogue of 17 reports with nothing behind it,
totalling client-side data in the browser. There was no reports module on the server at all.

## 2. What the data honestly supports

Two findings shaped the scope, and both are recorded here rather than smoothed over.

**Gross profit is not buildable.** Live production has **zero inventory items with a purchase
behind them** — every item is historical or a direct entry. A profit figure today would have no
cost basis whatsoever. TASK 16 stays deferred and nothing here pretends otherwise.

**Workmanship revenue *is* buildable**, because it is recorded on every sale line
(`workmanship_value_usd`). The catalogue entry that read **`أرباح المصنعية`** now reads
**`إيراد المصنعية`**, and the payload carries its own disclaimer so no screen can quietly relabel
it:

```
إيراد المصنعية المسجَّل — ليس ربحاً وليس هامشاً
```

## 3. The rules every figure obeys

* **Derived, never stored.** No rollup table, no cached total. Everything is computed from the
  authoritative records at read time, which is why these numbers reconcile.
* **Aggregated on the server.** Nothing is totalled in the browser. Two managers cannot see
  different numbers because one had a shorter page.
* **Currencies are never summed.** Each cashbox is reported in its own currency and there is
  deliberately no combined total field for a screen to find.
* **Karats are never merged.** The single headline weight is stated in pure gold and labelled.
* **No cost, no COGS, no margin, no profit, no valuation** — asserted by test across every report.

## 4. Reports built

```
overview           headline liquidity, gold, sales, receivables
sales              by period / warehouse / seller / karat, with returns subtracted per karat
sales-by-customer  per partner, linking into the TASK 17 customer workspace
purchases          the mirror, including counterparties whose role is `customer` (TASK 17 §46)
workmanship        recorded workmanship revenue, under its own name
inventory          by karat, by warehouse, and by origin — reusing the TASK 17 rule
receivables        from the subledger, with current / 30 / 60 / 90+ aging
cash               per cashbox, per currency
gold               physical gold and weight custody, kept as the separate domains they are
shifts             across a period
```

## 5. Two behaviours made explicit rather than implied

**§33 cancellations.** A cancelled invoice leaves every total *and* appears in a separate
`cancelled` count and value. A reader can see it exists instead of wondering where the difference
went. Asserted both ways.

**§34 returns.** A 50 g sale with a 50 g return does not read as 50 g sold anywhere. Returned
weight is subtracted **per karat**, and the suite asserts `net = sold − returned` rather than
letting the two net into a single figure.

## 6. The test that matters

§32: a report must agree with the module it summarises.

```
sales report invoice count   = the sales module's own total for the same filter   (322 = 322)
report receivables movement  = exactly the invoice's unpaid remainder             ($5,000)
report sold weight           = TASK 12 سجل الأوزان المباعة for the same filter    (3,518.75 g)
per-partner balance          = the subledger, and the subledger still matches the GL
```

The weight check is the one that keeps this task honest: reports **aggregate and link into**
TASK 12 rather than re-listing it. A second list of invoices with slightly different totals would
have been the worst possible outcome.

## 7. A bug avoided by remembering one

The per-partner ledger sum is a **separate grouped query merged in memory**, not a correlated
`sql` expression mixed into a select alongside table columns. That exact pattern silently returns
zero — it is the trap TASK 17 hit on this same table, and it cost a debugging cycle then. Here it
was written the safe way from the start, with the reason recorded at the code.

## 8. Frontend

The approved screen is unchanged in design: the same catalogue, the same `metric()` and `line()`
helpers, the same print and WhatsApp actions. **Only the data source moved** — from client-side
state to the server.

* §26: date presets rather than a two-date picker — `اليوم · آخر 7 أيام · هذا الشهر · كل الفترات`.
* A loading and error banner, so a refused or slow request never reads as an empty report.
* `أعمار الدين` shown inline on each debtor row.

## 9. Production verification

Against `https://hameed-hliwi.org/`, using a temporary account created for the run and **deleted
afterwards** (only `admin`, `hameed`, `nabil` remain):

```
overview        5 invoices · $10,488 · outstanding $6,930
                cash: USD 3,548 and SYP 132,000 — side by side, never added
                inventory 1,390.515 g pure gold

receivables     report says $6,930 owed to the shop
GL              accounts receivable $6,930 — and the subledger matches the GL
the two agree   True

aging           currentUSD / days30USD / days60USD / days90PlusUSD all present
workmanship     $650.16 — "إيراد المصنعية المسجَّل — ليس ربحاً وليس هامشاً"
inventory       by origin: 2 direct items, 1,589.16 g
forbidden       no field named cost, COGS, margin, profit or valuation anywhere

unauthenticated /reports/overview → 401
books           14,046.0000 = 14,046.0000, unchanged
```

`$6,930` is the same figure TASK 17 proved against the general ledger. The reports and the books
tell the same story.

Deployed bundle `index-vm9R6WUu.js` contains `إيراد المصنعية`, `آخر 7 أيام`, `أعمار الدين` and the
loading banner.

## 10. Deployment

```
backup      /home/ubuntu/backups/pre-task19-20260815-190553.sql (393 KB)
migration   none — reports read authoritative records and store nothing
restart     hameed-hliwi-api, hameed-hliwi only
untouched   abooerp-backend, clotexerp-server, obada-server — all still online
```

## 11. Regression — thirteen suites green

TASK 19 Reports · TASK 18 Settings · TASK 07 Finance · TASK 07.1 · TASK 08 Accounting ·
TASK 10 Authorization · TASK 11 Shifts · TASK 12 History · TASK 13 Used Gold ·
TASK 14 Weight Custody · TASK 16A Logout · TASK 17 ×3.

## 12. What is NOT done

* **Five catalogue entries still read client-side data**: `inventory` and `itemMovement` (piece
  lists), `expenses`, `goldPrices`, `stocktake` and `audit`. They are not wrong, but they are not
  server-aggregated either. `audit` in particular is worth a proper pass — the trail is written
  today and read nowhere.
* **CSV export was not built.** §30 ties it to the mobile download work in TASK 20, and solving
  that problem once is better than solving it twice. Print and WhatsApp share still work.
* **390/430 was not measured on a device.** The changes reuse the existing containers and helpers,
  but I did not put it on a phone and will not claim it.
* **A seller has no `reports.view`**, so seller scope never arises in practice; the suite still
  asserts a seller is refused every report.

## 13. Commit

```
5a4fa3f  feat(reports): operational reports aggregated on the server
```

---

## Verdict

**TASK 19 = CLOSED / PASSED.** The reports are computed on the server from the same records the
modules use, they agree with those modules by test and on production, and they say nothing about
profit that the data cannot support.

Next, per the order we agreed: **TASK 20 — Backup, Recovery & Mobile Download.** It is the one
whose absence can still cost something that cannot be rebuilt.
