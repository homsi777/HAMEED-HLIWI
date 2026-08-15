# TASK 12 — Invoice History & Sold Weight History

**Hameed Hliwi Jewelry** · commit `6a0339a` · migration `0015`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`, 26/26 production checks green.

---

## 1. Existing sales-history audit

The audit was the first step, because §5 asks for a decision, not an assumption: is a dedicated
history table genuinely needed, or does the data already exist?

It already exists, in full, and immutably:

| Fact needed by history | Already persisted on |
|---|---|
| invoice number, date, status, totals, paid, remaining | `sales_invoices` |
| customer name **as it was** | `sales_invoices.customer_name_snapshot` |
| seller | `sales_invoices.created_by_user_id` (Task 10) |
| warehouse **at the time of sale** | `sales_invoices.warehouse_id` |
| shift | `sales_invoices.shift_id` (Task 11, nullable) |
| item name, code, category, karat **as they were** | `sales_invoice_items.*_snapshot` |
| quantity and sold weight | `sales_invoice_items.quantity`, `net_weight_grams` |
| stock vs manual | `sales_invoice_items.line_type` |
| returned amounts per line | `return_invoice_items.source_sales_invoice_item_id` |

## 2. Implementation choice: derived, not duplicated

**No new table and no new column were created.**

A denormalised history table would have copied facts that are already immutable. It would have
added no information — only a second place for the same number to live, and therefore a way for
history to disagree with the documents after a cancellation, a return or a backfill. The
snapshot-safety requirement in §6 is already satisfied by the `*_snapshot` columns the sale
writes, so the usual justification for a copy does not apply here either.

The one thing a copy could have bought is read speed, and that was answered with two indexes
instead of a table (§8 below).

So `HistoryService` is an authoritative **read** over what the sale already recorded.

## 3. سجل الفواتير — Invoice History

`GET /history/invoices` — real PostgreSQL, no localStorage, no browser archive.

Sales invoices and sales returns are **unioned in SQL**, so ordering and paging stay correct
across both rather than being merged in the browser. `type` selects `sale` (default),
`sales_return`, or `all`. Purchases were deliberately left out: §8 sets Sales history as the
objective and warns against turning this into a reports module.

Each row carries invoice number, date and time, customer, seller, warehouse, shift number,
total, paid, remaining, payment method, item count, line count, manual-line count and status.

**Payment state is derived, never stored** (§13): cancelled → `cancelled`; remaining ≤ 0 →
`paid`; remaining > 0 with something paid → `partial`; nothing paid → `credit`. There is no
second editable status field to drift out of step with the money.

Numbering is the current production scheme untouched — `100001`…; the suite asserts no
`INV-YYYY-` string can reappear.

## 4. سجل الأوزان المباعة — Sold Weight History

`GET /history/sold-weights` — **one row per real sold line**, not per invoice.

Each row: sale date, item name and code snapshot, category, karat, quantity, gross and net sold
weight, returned quantity and weight, net after returns, price, seller, warehouse, stock/manual
source, shift, and the invoice number for traceability.

* **Aggregate sales (§23)** report the weight the line actually sold. The suite sells 5.000 g
  out of a 400 g aggregate holding and asserts the row reads 5.000 g, never 400 g.
* **Individual sales (§24)** use the line snapshot, not the current inventory record.
* **Manual/historical sales (§22)** are marked `بيع يدوي / تاريخي`, treated as a normal fact.

`GET /history/sold-weights/summary` computes totals over the **whole filtered set**, not the
visible page, grouped by karat in SQL.

## 5. Separation from ذمم الأوزان

`ذمم الأوزان` is untouched and unchanged. It remains the **custody / weight-debt** module: grams
handed to a craftsman for work and returned later, with a balance owed back. TASK 12 did not
read from it, write to it, rename it, or merge anything into it.

`سجل الأوزان المباعة` is a different thing entirely: the historical record of jewellery actually
sold through Sales. The screen is labelled in full — "سجل الأوزان المباعة" — precisely so the two
are never confused in conversation.

## 6. Separation from Gold scrap

Scrap received in exchange on a sale lives in `sales_gold_exchanges` and belongs to the Gold
domain. **It is never added to sold weight.** The automated suite asserts a 9.100 g scrap intake
does not appear in the sold total, and production verification confirms the same against the
real books: sold weight is 89.670 g with 9.100 g of scrap on file, and the two never mix.

## 7. Returns, cancellations, manual sales

**Returns (§25, §26, §61).** The original sold line is never rewritten. The row shows sold,
returned and net side by side:

```
مباع 5.000 غ · مرتجع 2.000 غ · صافي 3.000 غ
```

Asserted directly: after a partial return the original still reads 5.000 g, and the karat
summary reports sold 5.000, returned 2.000, net 3.000 — with 21K untouched by an 18K return.

**Cancellations (§27, §62).** A cancelled sale stays fully visible and clearly labelled `ملغاة`,
and contributes **zero** to net sold weight. Asserted: 14K net goes 3.000 → 0.000 on
cancellation while the sold figure stays 3.000 and the row remains in history.

**Manual sales (§55).** A manual sale also creates a negative historical inventory record. Sold
weight is counted **once**, from the commercial document, because the query drives from
`sales_invoice_items` and never from inventory movements (§56). Verified in production:
3 manual lines in the books, 3 in history.

## 8. Indexes and performance

Existing indexes were reviewed before anything was added. Migration `0015` adds **three**, each
justified by a query this task actually runs and documented in the migration file itself:

| Index | Why |
|---|---|
| `sales_invoices (created_by_user_id, created_at DESC)` | every seller request carries a forced own-scope predicate and orders newest-first |
| `sales_invoices (created_at DESC)` | the unfiltered manager listing orders the whole table; the existing composite starts with `status` and cannot serve it |
| `return_invoices (created_by_user_id, created_at DESC)` | the same, for the returns branch of the union |

Nothing was added speculatively. Sold-weight history drives from `sales_invoices` and reaches
lines through the existing `sales_invoice_items_invoice_idx`; returned amounts resolve through
the existing `return_invoice_items_source_sale_line_idx`. A trigram index for item-name search
was considered and rejected as premature at current volumes.

All filtering, sorting, paging and summarising happen in SQL (§49, §51). Summaries are a single
`GROUP BY karat` over the filtered set — no N+1, and no invoice is ever pulled into React to be
totalled there.

## 9. Authorization

Task 10's `AuthorizationScopeService` is reused unchanged. Scope is pushed into the SQL
predicate, so hidden rows are never fetched, never counted and never paged.

| Role | Sees |
|---|---|
| Seller (`own`) | only their own invoices and sold lines |
| Warehouse Manager | every seller inside the assigned warehouses |
| General Manager | company-wide |

Verified against real production data: a freshly created seller sees **0** of the 5 existing
invoices and **0** of the 8 sold lines, an exact-number search for a real invoice returns
nothing — including a zero `meta.total`, so the count leaks nothing either — and a forged
`sellerId` parameter cannot widen an own-scope view. The seller filter selector is not even
offered to an own-scope user.

## 10. Filters

Server-side and composable: date range, invoice number, customer id, customer name, seller,
warehouse, shift, status, payment state, document type — plus karat, item name, item code and
stock/manual source on the weight screen. Quick periods (اليوم / أمس / هذا الأسبوع / هذا الشهر)
sit above the results.

Warehouse choices follow scope: a branch manager is offered only assigned warehouses and is
refused others with `403`; the General Manager sees all.

## 11. Shift integration

**Shift → history (§35).** A shift's detail sheet has two buttons — `فواتير هذه الوردية` and
`أوزان هذه الوردية` — that open السجلات with the shift filter already applied. Shift totals are
not recomputed or duplicated; this is drill-down.

**History → shift (§36).** An invoice row's shift number is a link back to that shift for an
authorized manager. Invoices from before the shifts module show `قبل نظام الورديات` and link
nowhere. Nothing is fabricated (§11, §54).

**No discrepancy (§64).** Asserted directly: sold weight filtered to a shift equals that shift's
TASK 11 totals per karat.

## 12. Opening an invoice (§16)

No second invoice rendering engine was built. A row hands its invoice number to the existing
Invoices screen, which opens the corrected production preview under the existing permissions.

## 13. Read-only by construction (§38, §39, §40, §41)

Every endpoint is a `SELECT`. History creates no voucher, no cash movement, no journal entry, no
gold transaction and no inventory write, and offers no inline editing of old records —
corrections continue to go through cancellation, return or reversal so the audit trail holds.

This was verified rather than claimed: after the full verification run the production counts for
sales, lines, vouchers, journals, gold transactions and inventory items were **identical**, the
trial balance still balanced, and total inventory weight was unchanged at 1499.490 g.

## 14. Mobile and desktop

**Mobile (390/430 px).** Compact cards on both screens. One search field and a single `تصفية`
button open a bottom sheet; active filters appear as removable chips with a clear-all. Quick
period buttons wrap. No horizontal scrolling, no ten filters strung across a phone.

**Desktop.** From `md` up both screens use efficient tables, because a table is the right tool
there and §45 warns against replacing a usable one with giant cards. The existing visual
language — slate-900 headers, amber-400 accents, `rounded-sm`, `border-2`, RTL — is unchanged.

Empty states are specific: `لا توجد فواتير ضمن الفترة المحددة`,
`لا توجد أوزان مباعة مطابقة للفلاتر` — never a technical error for an empty query.

## 15. Tests

**`backend/test/task12-history.spec.ts`** — 19 assertion groups, all passing, on the §63
scenario: General Manager, branch manager, Seller A and Seller B in one warehouse.

Invoice history: scoped listing · exact-number search · payment state and line composition ·
no leak by number, count or forged `sellerId` · pre-shift invoices visible · manager warehouse
scope and GM global scope · shift, customer, date and pagination filters.
Sold weight: one row per line with snapshots · aggregate line reports 5.000 g not 400 g · manual
marker · 21K = 20.250 g and 18K = 5.000 g reported separately · scrap absent · partial return
preserves sold/returned/net · cancellation keeps the row and zeroes net · shift drill-down
matches TASK 11 · seller isolation · manual counted once.

**Regression (§65):** TASK 11 Shifts, TASK 10 Authorization, TASK 07 Finance, TASK 07.1,
TASK 08 Accounting, TASK 09 Gold, TASK 09.1 — all passing.

One honest update was needed: the TASK 10 suite asserted a seller's modules were exactly
`['invoices','returns']`, and a seller now also holds `history`. TASK 12 §14 and §32 define
seller behaviour in both history screens, so the access is intended and the assertion was
corrected — it is still scoped to their own documents, so the isolation guarantee is unchanged.

## 16. Production migration and deployment

`pg_dump` backup → `backup_pre_task12_*.sql`. Commit transferred as a git bundle. Migration
`0015` — **indexes only, no schema change** — applied as the PostgreSQL owner in a single
transaction with `ON_ERROR_STOP=1`, hash recorded in `drizzle.__drizzle_migrations` (id 16).
**`drizzle-kit push` was not used.** Only `hameed-hliwi-api` and `hameed-hliwi` were restarted.

## 17. Production verification

**26 checks, 26 passed, 0 failed**, read-only against Nabil's real records. Rather than trust the
API, every figure was compared against direct SQL over the same rows:

```
5 invoices          100001 · 100002 · 100003 · 100004 · 100005   (unchanged)
totals              $10,488.00 — matches SQL
credit invoices     2 — matches SQL
8 sold lines        89.670 g total — matches SQL
by karat            21K : 89.670 g — matches grouped SQL exactly
manual lines        3 — counted once
scrap on file       9.100 g — absent from sold weight
pre-shift invoices  5 of 5 shown, none hidden, no shift fabricated
```

Seller isolation was proven against the real books: a temporary seller saw 0 invoices, 0 sold
lines, and got nothing back when searching a real invoice number exactly.

Books before and after the entire run:

```
sales=5 lines=8 vouchers=4 journals=9 gold=1 inventory=10
trial balance balanced · inventory weight 1499.490 g unchanged
```

**No production business data was created, altered or renumbered** (§53, §70). One temporary
General Manager and one temporary seller were created for the isolation checks and removed
afterwards; remaining users are `admin` and `hameed`, exactly as before.

---

## 18. Remaining risks and notes for Nabil

1. **Visual check on your phone.** Both tabs were built for 390/430 px but I have not seen them
   on your device — worth a look at the filter sheet and the weight cards.
2. **All your current sales are 21K and pre-shift**, so the karat summary shows a single row and
   every invoice reads `قبل نظام الورديات`. Both are correct; the screen will fill out as soon as
   there are sellers working inside shifts.
3. **Purchases are not in this history.** §8 made Sales the objective and warned against a giant
   reports module. If you want purchase history in the same screen later it is a contained
   addition — the union already supports a third branch.
4. **Item-name search is a plain `ILIKE`.** Fast at today's volumes; if the catalogue grows into
   the tens of thousands a trigram index would be the next step, and I deliberately did not add
   one speculatively.
5. **Sellers can see their own history.** That is what §14 and §32 require, and it adds a
   `السجلات` item to their navigation. If you would rather sellers had no history screen at all,
   removing `history` from the seller preset is a one-line change.
6. **History is read-only on purpose.** There is no editing of old invoices or weights.
   Corrections keep going through cancellation, return or reversal so the trail stays auditable.

**TASK 12 = CLOSED / PASSED.**
