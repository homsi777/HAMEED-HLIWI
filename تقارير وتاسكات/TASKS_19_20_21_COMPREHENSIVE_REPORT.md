# Comprehensive Report — TASK 19, 20 & 21

**Hameed Hliwi Jewelry** · 2026-08-15
**All three CLOSED / PASSED**, deployed and verified on `https://hameed-hliwi.org/`.

Covered here: **TASK 19 Reports**, **TASK 20 Backup & Recovery**, **TASK 21 Dashboard** — with
**TASK 18 Settings** included as the foundation the other three stand on, because Reports could not
have been trusted without it.

TASK 16 Costing/COGS remains **deferred**, on evidence rather than convenience (§3).

---

## 1. The thread running through all four

Each of these tasks began by checking what was actually there, and in every case the inspection
changed the plan.

| task | what inspection found | what it changed |
|---|---|---|
| 18 | settings lived in **each browser's localStorage** | Reports had to wait — per-device prices make per-device reports |
| 19 | live production has **zero purchased inventory items** | no profit report is honest; workmanship revenue reported under its own name |
| 20 | `crontab -l` was **empty** | the only backups in existence were the ones I took by hand |
| 21 | the dashboard chart was **hardcoded fake data**, and the debt cards were **inverted** | the manager's first screen was showing invented numbers |

None of that was on the roadmap when we started. All four were found by looking.

---

## 2. TASK 18 — Settings (the foundation)

**The defect.** There was no settings module, no settings table, no `settingsApi`. The exchange
rate, gold prices, workmanship fees and the shop's own name lived in `localStorage`. Two devices
could price the same goods differently on the same day, and the approved invoice printed a store
name held in a browser.

**The seed was derived, not invented.** Your real values existed only in your browser, so the
migration read them back out of your own posted documents:

```
exchange rate       13,200      from your most recent posted sale
karat 21 selling    122.00 $/g  from your most recent posted 21K sale line
karat 21 workmanship 12.00 $/g  the same line
other karats        0           never sold — left visibly unset, not guessed
```

**The guarantee.** Doubling the rate on a live posted sale left its USD total, its **SYP total**
and its journal untouched, and the invoice kept the rate it was written with. A rate change cannot
reach backwards.

**A real security hole, found by its own test.** A seller successfully changed the shop's exchange
rate. The controller had `AuthGuard` but not `PermissionGuard`, which makes `@RequirePermissions`
**decorative and silent** — no error, no warning. Fixed, and the same mistake is now called out in
the comment at every controller written since.

---

## 3. TASK 19 — Reports

**Scoped to what the data honestly supports.** Live production has **zero inventory items with a
purchase behind them**, so gross profit has no cost basis at all. The catalogue entry that read
`أرباح المصنعية` now reads `إيراد المصنعية`, and the payload carries its own disclaimer so no
screen can quietly relabel it.

**Eleven reports**, all aggregated on the server: overview, sales, sales by customer, purchases,
workmanship, inventory, receivables with aging, cash, gold and custody, shifts, and the daily
series added in TASK 21.

**The rules each figure obeys** — derived never stored, aggregated server-side, currencies never
summed, karats never merged, and no cost, COGS, margin, profit or valuation anywhere, asserted by
test across every response.

**Two behaviours made explicit rather than implied.** A cancelled invoice leaves the totals *and*
appears in a separate count, so nobody wonders where the difference went. A 50 g sale with a 50 g
return does not read as 50 g sold anywhere.

**The test that matters** — a report must agree with the module it summarises:

```
sales report count  = the sales module's own total for the same filter
receivables         = the subledger, which still matches the GL
sold weight         = TASK 12 سجل الأوزان المباعة for the same filter
```

---

## 4. TASK 20 — Backup & Recovery

**Before:** no schedule, no retention, no verification, no copy anywhere except the one VPS.

**Now:** a daily cron entry at 03:15, compressed, pruned (daily 14 days, weekly 90), with every
run recorded — **success or failure**.

**The monitoring proved itself during its own deployment.** The first two scheduled runs failed:
the application's database role could not read the migrations ledger. Both failures were recorded
correctly, which is exactly what the design is for. Fixed with a read-only grant.

Those two failed rows are still in production. **I left them there deliberately** — they are
truthful history and tidying away evidence is the wrong instinct.

**The restore is proven, not assumed.** Into a scratch database, never over production:

```
restore errors             0
books in the restored copy 14,046.0000 = 14,046.0000
production, for comparison 14,046.0000 = 14,046.0000   identical
partners / sales / users   5 / 5 / 3                   identical
gold ledger nets to        0.000 pure grams
```

**No restore button**, on purpose — behind a tap on a phone that is a destroy-everything button
with a friendly label. Recovery is [a written runbook](BACKUP_AND_RECOVERY_RUNBOOK.md).

**The mobile download, built the way a phone needs.** A real `Content-Disposition` response rather
than a JavaScript blob (which is the first thing to break inside an installed PWA), reached by a
single-use ticket bound to the requesting session and expiring in five minutes. The size is stated
before the download starts, and afterwards the app says where the file went.

---

## 5. TASK 21 — Dashboard

**Two things on the manager's first screen were actively wrong.**

**The chart was fiction.** Six of its seven points were hardcoded numbers, with only the last one
real. It is now a genuine fourteen-day series, including the quiet days — closing gaps would make
a slow week look busy.

**The debt cards were backwards.** They read `balanceUSD < 0` as a customer debt. That convention
inverted when balances started coming from the subledger in TASK 17, so the dashboard had been
showing receivables and payables the wrong way round ever since. They now come from the same
receivables report the reports screen uses.

Also fixed: cashboxes were looked up by hardcoded legacy ids that no longer exist — matched by
currency now, and dollars are never added to lira. And the charts hidden in TASK 17 are back: the
console flood was a percentage height inside a container with no size at first paint, so they now
carry an explicit pixel height and only mount once there is a series.

**A timezone bug caught by the test.** The series grouped by day in the session timezone while the
filters were built in UTC, so the last point disagreed with the sales report for the same day.
Pinned to UTC.

---

## 6. Production verification — all live, not localhost

```
settings        rate 13,200 · karat 21 = 122 / 12 · provisional flag set
                seller reads prices · seller cannot change anything (3× 403)

reports         receivables $6,930 = GL accounts receivable $6,930
                workmanship $650.16, labelled "ليس ربحاً وليس هامشاً"
                no field named cost, COGS, margin, profit or valuation

backups         last success 114,645 bytes · stale=false · offServerCopy=false
                seller 403 · unauthenticated 401 · guessed path never serves a file
                download: attachment header, 114,645 bytes received, token 404 on reuse

dashboard       13 Aug: 1 invoice $3,195 · 14 Aug: 4 invoices $7,293 · quiet days shown as 0
                لنا على العملاء 6,930 · علينا للموردين 0

books           14,046.0000 = 14,046.0000 — unchanged through all four deployments
users           only admin, hameed, nabil remain; every temporary account removed
```

## 7. Regression — fourteen suites green

TASK 07 Finance · 07.1 · 08 Accounting · 10 Authorization · 11 Shifts · 12 History ·
13 Used Gold · 14 Weight Custody · 16A Logout · 17 ×3 · 18 Settings · 19 Reports · 20 Backups.

`task091-regression` still fails for a reason verified as predating this work — a shared
development database artefact, documented in the TASK 17 report.

## 8. Commits

```
595b77e  feat(settings): move the exchange rate, gold prices and store identity to the server
5a4fa3f  feat(reports): operational reports aggregated on the server
d6e059c  feat(backups): scheduled backups, monitored state and mobile download
3f0f141  feat(dashboard): real figures on the manager's first screen
```

Plus their four reports and the recovery runbook.

## 9. Safety, held across all four

* **COGS deferred** — no cost layer, no FIFO, no valuation. A gold price is a selling price.
* **The invoice template is visually unchanged** — it now reads store identity from the server.
* **Every migration** backed up first, applied as the PostgreSQL owner in one transaction with
  `ON_ERROR_STOP=1`, hash recorded, ownership reassigned. `drizzle-kit push` never used.
* **Only `hameed-hliwi-api` and `hameed-hliwi` restarted.** The other three VPS applications were
  online before and after every deployment.
* **Every temporary verification account removed**, and the books were identical before and after
  each one.

---

## 10. What is still open — three things, honestly

**1. The off-server backup copy — your decision, and the only irreversible risk left.**
Backups survive a bad migration. They do not survive losing the machine. It needs storage you own;
my recommendation is object storage (S3-compatible / Backblaze B2 / Wasabi), a daily upload after
the cron run. Until then the panel says so rather than letting a green banner imply safety.

**2. The provisional settings flag is still set.** Open Settings, check the rate and the karat
prices, and save. Four karats and every buying price are zero because there was no honest source
for them.

**3. Nothing was measured on a phone.** Mobile 390/430, the browser console walk-through, and the
backup download on iOS and inside the installed PWA — all verified by request shape and response
headers against the live server, none of them pressed by hand on a handset. That is the one class
of check I cannot do for you.

## 11. What I would do next

**TASK 16 Costing stays deferred** until purchased stock is a meaningful share of the inventory —
today it is zero, and a profit figure built on that would be fiction with a decimal point.

The candidates I would rank first:

* **The audit trail** — written on every task, read nowhere. It is the cheapest remaining piece of
  real value, and TASK 19 left a slot for it.
* **Stocktake** — the tables exist, the workflow does not.
* **Seller purchases** — deferred in TASK 17 §48, still a genuine counter reality.

---

## Verdict

Four tasks, four deployments, no data lost, and the books read `14,046.0000 = 14,046.0000` at the
start and at the end.

The system now prices from one place, reports what it can prove, backs itself up without anyone
remembering, and shows the manager real numbers instead of invented ones.
