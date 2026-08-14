# TASK 09.1 — Sales / Inventory / Gold Sync & Mobile Preview Fix

**Status:** all four defects fixed, tested, deployed, verified
**Commit:** `8646f98` — *fix: deduct stock on sale, surface historical and scrap gold, one mobile preview*
**Schema change:** none required — no migration was created
**Deployed:** 2026-08-14 — https://hameed-hliwi.org
**Backup:** `/home/ubuntu/backup_pre_task091_20260814_162727.sql` (305 KB)

---

## Defect A — aggregate weight was never deducted

### Root cause

Not an arithmetic bug, and not limited to aggregate items. **No stock sale had ever
deducted stock in production.**

The invoice screen holds a stock reference on each line as `itemId`. `salesApi.create`
spread the UI object straight into the request body, and the API's line parser only ever
read `inventoryItemId`:

```ts
if (line.inventoryItemId) { /* stock line: deduct, lock, write movement */ }
const itemName = this.text(line.itemName, …);   // ← every real sale landed here
```

With the field absent, every stock line fell through to the manual branch. The backend then
did exactly what it is supposed to do for a manual line: it left the stock untouched and
wrote a negative historical record. So the 1250 g item stayed at 1250 g, and a phantom
`MANUAL-SALE-…` row appeared instead.

The production data confirms it exactly — every line of all five real invoices is
`line_type = 'manual'`, including the 12 g «اسوارة برم حلبية» sale, while the 1250 g stock
item of that very name was never touched.

This was invisible to the test suite because the tests posted `inventoryItemId` directly,
which is the shape the API wanted but the browser never sent.

### Fix

`src/services/salesApi.ts` now maps each line into the API contract explicitly instead of
spreading the UI object:

```ts
const saleLine = (item: InvoiceItem) => ({
  ...(item.itemId ? { inventoryItemId: item.itemId, soldWeightGrams: item.netWeightGrams, quantity: item.quantity ?? 1 } : {}),
  itemName: item.itemName, category: item.category, karat: item.karat, …
});
```

The API additionally accepts `itemId` as an alias, so a browser still holding a cached copy
of the old bundle cannot silently recreate the fault.

The deduction logic itself was already correct and was left alone: precise PostgreSQL
numeric arithmetic, the optimistic `version` check plus a `net_weight_grams >= sold` guard
in the same `WHERE`, the item left `in_stock` while weight remains, and the approved
transitional negative quantity preserved.

### Verified

```
1250.000 − 12.000 = 1238.000 g   · quantity −1 · status in_stock
line 1 recorded as `stock` and linked to the inventory item; line 2 as `manual`
movement: before 1250.000 → delta −12.000 → after 1238.000
concurrency: 12 g + 10 g against 20 g → exactly one commits, 10.000 g left
```

---

## Defect B — manual sale item did not appear in Inventory

### Root cause

A visibility bug, not a persistence bug. The records were being written correctly all
along — production holds 8 of them with `quantity = −1`, negative weight and
`is_manual_sale_entry = true`.

`InventoryView.tsx` opened its list filter with:

```ts
if (item.status !== 'in_stock') return false;
```

A historical record is marked `sold` by design, so the screen dropped every one of them.

### Fix

The filter now keeps historical records, and they are marked in the existing design
language — a `مخزون تاريخي` badge plus a muted row background, on both the desktop table
and the mobile cards. The tab counter follows the same rule so it matches what is listed.
Nothing was redesigned and nothing is hidden.

The sellable-stock summaries (warehouse weight tiles) still count `in_stock` only, because
those measure metal available to sell.

### Verified

```
MANUAL-SALE-INV-2026-321-2: quantity −1, weight −8.250 g, warehouse correct,
returned by the inventory API with isManualSaleEntry = true
```

Purchase reconciliation (Task 05) is untouched: these rows keep the same shape, flags and
movement history it already reads.

---

## Defect C — scrap gold was not visible as a physical holding

### Root cause

Task 09 did post the metal correctly — scrap taken in on a sale is debited to the branch's
physical gold account. But nothing in the interface ever showed a company account: the
ذمم الأوزان screen listed **partner** balances only. The holding existed and was
unreachable.

### Fix

New endpoint `GET /gold/holdings` (permission `gold_accounts.view`) returning the metal the
shop physically holds, per branch and per karat, with the movements that put it there. Each
karat line also states how much of it arrived as scrap, and every movement carries a
`source` (`scrap_exchange` for a sale exchange) plus its sale, exchange row, partner,
warehouse, karat, weight and pure-gold equivalent. The invoice settlement clearing account
is excluded — it is an accounting device, not metal on a shelf.

The gold screen gained a **الذهب الموجود فعلياً في المحل** section: per-branch karat
balances with a `منها … كسر مقايضة` note, and a movement table where exchange rows carry a
`كسر مقايضة` badge and a soft amber row tint.

The three concepts stay separate exactly as required: **ذمم الأوزان** (weight debts) keeps
its business purpose, partner gold obligations keep theirs, and physical holdings are a
third, clearly labelled surface. Scrap is **not** added as sellable jewellery — the screen
says so in plain words: converting it into stock needs an explicit decision.

### Verified

```
holding: 9.100 g 21K from INV-2026-321 · source = scrap_exchange · 7.9625 g fine
traceable to the sale, the gold-exchange row, partner, warehouse and karat
no cash movement · exactly 1 gold transaction · reconciliation 35/35 posted
```

---

## Defect D — mobile invoice preview showed two stacked views

### Root cause

Two independently mounted fixed-position surfaces rendered at once whenever an invoice was
opened:

1. the invoice financial trail — `fixed bottom-4 left-4 z-[60] w-72`, designed as a desktop
   corner panel;
2. `PrintInvoiceModal` — a full-screen fixed overlay.

On a wide screen the 288 px panel sits beside the modal. On a 390 px phone it covers it,
and the two read as nested previews. A contributing factor: the A5 sheet is a fixed
`210mm` (≈794 px) wide, roughly twice a phone viewport, so the preview itself overflowed.

### Fix

The financial trail is now **built once** and placed in exactly one surface, chosen by a
`useIsLargeScreen()` media-query hook — the desktop corner panel, or a stacked section
inside the preview below the invoice on small screens. Only one instance is mounted; this
is not a CSS hide of a duplicate component.

Screen-only responsive rules (`@media screen and (max-width: 1023px)`) let the A5 sheet fill
the available width with its internal type scaling down, wrap long cells, and drop the empty
ruled filler rows that exist only to fill printed paper. The overlay itself no longer scrolls
horizontally and the header collapses its button label. **Print output and desktop layout
are untouched** — the media query is `screen`-only and bounded at 1023 px.

### Verification limits — stated honestly

I have no browser automation in this environment, so I could not visually open the preview
at 390 px and 430 px. What I did verify: exactly one trail instance can mount (it is
conditional on the media query, not on CSS visibility), the responsive rules are present in
the deployed stylesheet, and both builds are clean. **The visual check at 390/430 px still
needs your eyes.**

---

## Historical production records — repaired on your instruction

`npm run db:repair:sale-stock-links`. I first ran it in dry-run only and asked you to
decide, because a saved manual line carries no inventory reference and the match is a
strong hint rather than a recorded fact. **You instructed me to apply it, so I did**, after
a fresh backup (`backup_pre_repair_20260814_175257.sql`).

### Applied — 5 lines across 4 invoices

```
INV-2026-001 line 1 → stock 12345 −19.240 g   (1250.000 → 1230.760)
INV-2026-003 line 2 → stock 12345 −12.000 g   (1230.760 → 1218.760)
INV-2026-004 line 1 → stock 12345 −12.000 g   (1218.760 → 1206.760)
INV-2026-002 line 1 → stock 12346  −5.600 g   ( 400.000 →  394.400)
INV-2026-003 line 1 → stock 12346 −12.000 g   ( 394.400 →  382.400)
```

Final state:

| صنف | قبل | بعد | الكمية |
| --- | --- | --- | --- |
| 12345 «اسوارة برم حلبية» | 1250.000 g | **1206.760 g** | −3 |
| 12346 «محبس خطوبة» | 400.000 g | **382.400 g** | −2 |

Each repair: deducted under the same `net_weight_grams >= sold` guard the live sale path
uses, wrote a `sale` movement with before/after values, repointed the sale line to the real
stock item (`line_type` manual → stock, with the real item code), archived the phantom
record rather than deleting it, and wrote an audit row. Five audit rows exist
(`sales.repair_stock_link`).

The three genuinely manual lines were correctly left alone — «خاتم محبس», «خاتم سهرة» and
«123» have no matching stock item, so their historical records stay live and now display
with the `مخزون تاريخي` badge.

### A defect in my own repair, found and fixed

Verification showed three of the five movements carried a stale `beforeNetWeightGrams`: the
script read the before-value from the candidate query, which was snapshotted before any
repair ran, so the second and third deduction against the same stock item both reported the
original 1250.000 g. The deltas and after-values were correct (they came from the
`UPDATE … RETURNING`), and the inventory rows were correct — but §4 requires the movement
and the row to agree, and they did not.

Both were corrected: the script now derives the before-value from what the update actually
returned, and the three affected rows were repaired in place from their own delta and
after-value (`before = after − delta`), which is exact. Re-verified:

```
every repair movement: before + delta = after   ✓ (5/5)
each item's row weight = its last movement's after value ✓ (12345, 12346)
```

### Idempotency confirmed

A second dry run reports **0 candidates** — the repaired lines are now `stock`, so they can
never be deducted twice. The tool also refuses a line whose phantom is already archived or
that already has a repair movement for that item+invoice.

### Nothing financial moved

```
trial balance 14,046.00 = 14,046.00 balanced ✓   journals 9 (unchanged)
gold net fine 0.000 g ✓   sales 5 · lines 8 · vouchers 4 · cash movements 4 (all unchanged)
invoice totals, paid and remaining amounts: unchanged
```

This is correct — the repair moves metal between records, not money.

---

## Original decision record — why it was not applied automatically

`npm run db:repair:sale-stock-links` (dry run by default). Production dry run:

```
Candidate manual lines that match a real stock item: 5
  INV-2026-001 line 1 — «اسوارة برم حلبية» 19.240 g ع21 → stock 12345: 1250.000 → 1230.760
  INV-2026-002 line 1 — «محبس خطوبة»      5.600 g ع21 → stock 12346:  400.000 →  394.400
  INV-2026-003 line 1 — «محبس خطوبة»     12.000 g ع21 → stock 12346:  400.000 →  388.000
  INV-2026-003 line 2 — «اسوارة برم حلبية» 12.000 g ع21 → stock 12345: 1250.000 → 1238.000
  INV-2026-004 line 1 — «اسوارة برم حلبية» 12.000 g ع21 → stock 12345: 1250.000 → 1238.000
```

**Nothing was applied, deliberately.** A saved manual line carries no inventory reference at
all, so which stock item it was meant to be is not recorded anywhere. Matching on
name + karat + warehouse is a strong hint, not an authoritative fact — and §28 forbids
subtracting stock on a guess. The tool therefore refuses to act without an explicit
per-invoice opt-in:

```
npx tsx src/database/repair-sale-stock-links.ts --apply --invoice INV-2026-004
```

Idempotency protections when it does run: the line must still be `manual`, the phantom
record must still be unarchived, a prior repair movement for that item+invoice aborts the
line, and the deduction carries the same `net_weight_grams >= sold` guard as a live sale.
Each repair writes an audit row and archives the phantom record rather than deleting it.

**This is your decision to make, invoice by invoice.** Note the two «اسوارة برم حلبية»
lines sum to more than one sale of that stock item, and three different invoices point at
stock 12345 — so the list needs your judgement, not a script's.

The other two classes named in §27 need no repair: every manual line already has its
historical record (8/8), and every scrap exchange already has its gold holding (1/1, posted
by the Task 09 backfill).

---

## Tests

`npm run test:task091` — the exact §23 acceptance workflow plus the concurrency and
persistence cases:

```
[A] ✓ INV-2026-321: 1250.000 − 12.000 = 1238.000 g, item still in stock
[A] ✓ line 1 recorded as stock and linked to the inventory item; line 2 as manual
[A] ✓ movement: before 1250.000 → delta -12.000 → after 1238.000
[A] ✓ concurrent sale admitted exactly one writer; 10.000 g left of 20.000
[B] ✓ historical record: quantity -1, weight -8.25 g, visible through the API
[C] ✓ holding: 9.100 g 21K from INV-2026-321, source=scrap_exchange, 7.9625 g fine
[C] ✓ no cash movement · 1 gold transaction · reconciliation clean (35/35)
[R] ✓ trial balance balanced at $1331859.20
[P] ✓ aggregate weight and the physical holding both survived the restart
```

Regression suites re-run and passing: `test:task06` (returns), `test:task071`
(images/preview), `test:finance` (Task 07), `test:accounting` (Task 08), `test:gold` and
`test:task09` (Task 09).

One test correction: the gold suite asserted that exactly two karats carried a conversion
effect, which is a property of the whole shared database rather than of the run. It now
asserts the real invariant — conversions net to zero fine gold across karats.

---

## Deployment

Backup → commit `8646f98` transferred as a git bundle and pulled → backend and frontend
rebuilt → only `hameed-hliwi-api` and `hameed-hliwi` restarted. No schema change, so no
migration and no Drizzle ledger entry. No other VPS application was touched.

### Live verification

```
site 200 · api health {"status":"ok","database":"ok"} · GET /gold/holdings 401 (registered, guarded)
served bundle: index-CCcjfuXc.js + index-k1osvCYk.css
deployed frontend contains: inventoryItemId mapping · مخزون تاريخي · كسر مقايضة · gold/holdings · @media 1023px
deployed backend contains:  stockReference alias · holdings endpoint · scrap_exchange source
both processes online, zero errors since restart
```

---

## Remaining risks

1. **The mobile preview needs your visual confirmation** at 390 px and 430 px — I could not
   run a real browser here.
2. **The repaired weights rest on a name match, not a recorded fact.** 12345 and 12346 now
   read 1206.760 g and 382.400 g. If any of those five lines was actually a different piece,
   the correction is wrong for that line — worth comparing against the physical drawer once.
   The phantom records were archived rather than deleted and every step is in `audit_logs`,
   so any line can be traced, and `backup_pre_repair_20260814_175257.sql` predates all of it.
3. **A cached browser bundle** on a device that has not reloaded will still send the old
   payload shape — harmless now, because the API accepts both names, but that device will
   not show the new screens until it reloads.
4. **The negative quantities** (−3 and −2) are the approved transitional rule: these
   aggregate items were created with a starting quantity of 0 while their weight was known.
   A purchase or an explicit reconciliation is what brings the piece count back to reality.

---

**TASK 09.1 = CLOSED / PASSED** — the four code defects are fixed and deployed, and the five
historical lines were repaired on your instruction. The mobile visual check remains yours.
