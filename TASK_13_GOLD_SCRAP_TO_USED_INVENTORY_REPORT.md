# TASK 13 — Gold Scrap / Barter → Used Gold Inventory & Resale

**Hameed Hliwi Jewelry** · commit `0ec6795` · migration `0016`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`, 47/47 production checks green (23 read-only + 24 isolated write-path).

---

## 1. Existing gold-holding audit

§3 required inspecting the real implementation before designing, and the inspection changed
the shape of the API.

**Holdings are ledger-derived, not stored rows.** `GET /gold/holdings` computes a balance per
`(gold account, karat)` by summing `gold_ledger_entries`, and marks how much of it arrived via
`sale_exchange`. There is no per-receipt "holding" record — so §49's suggested
`POST /gold/holdings/:id/convert` had no `:id` to address. The natural unit of a conversion is
therefore the **company gold account plus karat**, and that is what the API takes.

**Gold transactions are strict double entry.** `GoldPostingService.post` refuses a draft with
fewer than two sides and validates that debits and credits balance **in pure gold**. So a
conversion could not simply "remove" grams; it needed a counterparty.

**Inventory had no notion of condition or provenance.** `inventory_items` carried
`isManualSaleEntry` but nothing that could say "second-hand" or "came from barter scrap", which
§12 explicitly requires to be machine-readable rather than encoded in a name.

Production at the time: one company gold account holding **9.100 g of 21K** from a real barter
on invoice 100002, and no used inventory of any kind.

## 2. Architecture decision

**A reclassification, expressed as a real double-entry gold movement.**

```
company holding (ذهب المحل)   ── credit 6.250 g 21K ──▶
                                                        used_inventory (clearing)
                              ◀── debit  6.250 g 21K ──
```

Same karat on both sides, so weight and purity are conserved and the ledger still nets to zero
pure gold. The transaction type is a new `used_inventory_conversion` — **not** a receipt or a
payment, which §28 forbids faking.

**A dedicated table was justified, and §21 asked for that judgement to be made explicitly.**
The gold ledger can express the metal moving; the inventory item can express the stock existing.
Neither can express the relationship: which holding was drawn down, by how much, into which
item, on whose judgement, and whether it can still be undone. `gold_inventory_conversions`
records exactly that and nothing else — it is the audit and reversal spine, not a second copy
of the metal.

**Availability is derived, never stored:**

```
available = Σ sale_exchange debits (per account, per karat)
          − Σ posted conversions (per account, per karat)
```

## 3. Weight, karat and value conservation

* **Weight** — grams leaving the scrap holding equal grams entering inventory exactly, at
  `numeric(14,3)`. No JavaScript float is ever the authority.
* **Karat** — the conversion writes the same karat on both ledger sides and on the item. 21K
  scrap can only become 21K used stock; refining is a different business process and is out of
  scope (§8).
* **Value** — none is invented. Conversion posts **no journal entry**, because there is no
  inventory cost model yet (COGS is a later task). §29's boundary is documented here and
  enforced by test.

## 4. Partial and full conversion

Partial conversion is the normal case and each one is individually traceable:

```
holding 8.000 g 18K → convert 3.000 → convert 2.000
converted total 5.000 · available 3.000 · two separate conversion records
```

Full conversion leaves `available = 0` and the holding is marked `محوّل بالكامل`, while the
original receipt stays visible in history exactly as it was (§4, §7, §53).

## 5. Inventory integration and the used marker

The conversion creates a real inventory item the existing sales engine can sell:

| Field | Value |
|---|---|
| `condition` | `used` — a real enum column (§12) |
| `source_type` | `gold_scrap_conversion` |
| karat, weight | conserved from the conversion |
| `inventoryMode` | `individual` or `aggregate`, manager's choice (§16) |
| `notes` | the manager's note |
| warehouse | the warehouse physically holding the scrap |

Inventory shows a compact violet **مستعمل** badge beside the existing `مخزون تاريخي` badge —
added without touching the surrounding layout, per §13 and §44.

An `inventory_movements` row of type `gold_used_conversion` records the new physical stock,
distinguishable from purchase, manual sale, transfer, stocktake and reconciliation (§27).

## 6. Manager decision and note

Nothing converts automatically. Scrap stays scrap until a manager presses
**إضافة للمخزون كمستعمل** and writes a note; a blank or whitespace-only note is refused with
`409` (§10, §11). The note is stored on the conversion record and on the item, and is
**internal** — it is never printed on a customer invoice (§46).

## 7. Source traceability

Each conversion links its gold account, gold transaction number, warehouse, karat, weight,
created item, actor and note, and the log is readable from the gold screen. The manager can see
where a used piece came from without the inventory list being cluttered (§26).

## 8. Authorization

Task 10's `AuthorizationScopeService` is reused. New permissions:
`gold_accounts.used_inventory.convert` and `gold_accounts.used_inventory.reverse`.

| Role | Convert | Reverse |
|---|---|---|
| Seller | ✗ `403` — cannot even read scrap holdings | ✗ |
| Warehouse Manager | ✓ own warehouses only | ✗ |
| General Manager | ✓ global | ✓ |

Cross-warehouse conversion is impossible by construction: the target warehouse is taken from
the gold account itself, never from the request (§18, §19).

## 9. Resale

The used item is an ordinary stock item. It appears in the normal sales selector and sells
through the normal sales engine — quantity and weight deducted, invoice line linked, normal
finance and accounting effects, normal history. **No separate used-gold sales workflow was
built** (§31, §32). Aggregate used gold sells partially under the Task 09.1 rules; an
individual used piece is consumed whole.

Crucially, selling the used stock does **not** return the grams to the scrap holding — the
metal is on the invoice now, and it is counted exactly once.

## 10. Finance and accounting boundary

Conversion creates **no voucher, no cash movement, no receivable, no expense, no revenue and no
journal entry**. Verified in production by counting all four tables immediately before and
after a real conversion: identical.

## 11. History integration

Task 12 sold-weight history shows the resale once, marked `stock`, at the converted weight.
There is no double count with the original scrap intake, because scrap intake never entered
sold-weight history in the first place — it belongs to the gold domain (§35, §40).

## 12. Concurrency, over-conversion and idempotency

* **Over-conversion** — refused with a clear Arabic message naming both figures, and nothing is
  written. Asserted by re-reading availability after the refusal.
* **Concurrency** — the gold account row is `SELECT … FOR UPDATE` locked and availability is
  re-read inside the transaction. Two overlapping conversions of 70 % and 50 % of one holding:
  exactly one commits, and `converted ≤ received` always holds.
* **Idempotency** — `idempotency_key` is unique; a retried request returns the same conversion,
  and exactly one record, item, movement and gold transaction exist.

## 13. Reversal and correction rules

A conversion may be reversed **only while the created stock is untouched** — still `in_stock`,
not archived, full weight and quantity intact, and carrying no movement other than its own
creation. Then the metal returns to the scrap holding, the item is **archived, never deleted**,
and the reversal is a real opposite gold transaction linked to the original.

If the stock has been sold, transferred or adjusted, reversal is **refused**; the correction
belongs to the ordinary return or adjustment workflow so the audit trail survives (§40, §41).

## 14. Tests

**`backend/test/task13-used-gold.spec.ts`** — 18 assertion groups, all passing:

holding built by a real barter sale · seller and other-warehouse manager both refused · note
required · over-conversion refused with no partial write · used item created with real
`condition`/`source_type` · received unchanged while available drops · no voucher, journal, cash
movement or second gold receipt · net pure gold unchanged by the reclassification · idempotent
retry · resale through the normal engine · scrap not returned by the resale · history counts it
once as stock · partial conversions tracked separately · full conversion leaves zero available ·
two concurrent conversions, exactly one commits · reversal refused after sale · clean reversal
archives the item and returns the grams · seller cannot reverse.

**Regression:** TASK 09 Gold, TASK 09.1, TASK 12 History, TASK 11 Shifts, TASK 10 Authorization,
TASK 07 Finance, TASK 08 Accounting, TASK 07.1 — all passing.

One honest note: the Task 09 gold suite failed once during the regression sweep and then passed
three consecutive re-runs with no code change in between. It contains a deliberate concurrency
race, which is the likely source. It is recorded here rather than glossed over, and is worth
watching on the next run.

## 15. Migration

`0016` adds: the `inventory_condition` enum and `inventory_items.condition` / `.source_type`;
enum values `gold_used_conversion`, `gold_used_conversion_reversal`, `used_inventory_conversion`;
the `gold_inventory_conversions` table; and the two new permissions mapped to the roles above.

PostgreSQL 16 on both environments, so `ALTER TYPE … ADD VALUE` runs safely inside the
migration's single transaction — nothing in the migration uses the new values. Applied as the
PostgreSQL owner with `ON_ERROR_STOP=1`, ownership reassigned to `hameed_hliwi_app`, hash
recorded in the Drizzle ledger (id 17). **`drizzle-kit push` was not used.**

**Existing scrap was not converted by deploying.** Immediately after migration:
`conversions = 0`, `used items = 0` (§42).

## 16. Production verification

**47 checks, 47 passed.**

**Read-only against Nabil's real 9.100 g (23 checks).** The holding is listed with
`received 9.100 · converted 0.000 · available 9.100`; the manager is offered the action and a
seller is refused both the action and the holdings list; a conversion attempted without a note
and an over-conversion are both refused — writing nothing — and the holding is confirmed still
fully unconverted afterwards. **His 9.100 g was never converted** (§43).

**Write path in an isolated temporary warehouse (24 checks).** A temporary branch, customer and
barter sale were created, 6.250 g of 10.000 g converted, the used item verified
(`used/gold_scrap_conversion`, 21K, 6.250 g), the absence of voucher/journal/cash confirmed
against counts taken seconds earlier, the piece resold through the normal engine, and history
checked to show it once as stock. Then every row was removed.

Final production state, matching the baseline exactly:

```
users        admin, hameed
warehouses   فرع الفرقان حميد حليوي · الدانه   (both created by Nabil)
sales 5 · inventory 10 · gold accounts 2 · conversions 0 · used items 0
real 21K barter scrap 9.100 g · trial balance balanced
```

Two cleanup items needed a second pass and are recorded honestly: an empty temporary warehouse
survived the first attempt because a raw-SQL customer insert failed and aborted the run, and
the `used_inventory` clearing account created during the test held a foreign key to the
temporary user. Both were removed; the clearing account is recreated on demand at the first
real conversion.

## 17. Invoice template

The approved sales/purchase invoice template was **not touched** — no file under the invoice
rendering path was modified in this task. A used item prints through it exactly like any other
stock item, using the existing fields (§45).

---

## 18. Remaining risks and notes for Nabil

1. **Your 9.100 g is still 9.100 g, entirely unconverted**, and now shows in the gold screen
   under **كسر المقايضة المتاح للتحويل** with an **إضافة للمخزون كمستعمل** button. Converting it
   is your decision, not something the system did for you.
2. **Visual check on your phone.** The panel and the conversion sheet were built for 390/430 px
   but I have not seen them on your device.
3. **No value is recorded for used gold yet.** A converted piece enters inventory with zero
   labour cost and no valuation, because there is no inventory cost model yet — that is COGS,
   a later task. Selling it still posts revenue normally; only the cost side is absent.
4. **Reversal is deliberately narrow.** Once a used piece is sold or moved, the conversion
   cannot be undone; the correction is a return or an adjustment. This keeps history honest.
5. **Karat refining is out of scope.** 21K scrap becomes 21K used stock only. If you ever melt
   and re-refine, that is a different operation and the existing karat-conversion path in the
   gold module is where it belongs.
6. **Sellers cannot see barter holdings at all**, not just the button. If you would rather a
   seller could see what the shop holds without acting on it, adding `gold_accounts.view` to
   the seller preset is a one-line change.

**TASK 13 = CLOSED / PASSED.**
