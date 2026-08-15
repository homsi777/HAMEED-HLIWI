# TASK 17 — Final Operational Completion

**Hameed Hliwi Jewelry** · commits `3d76793`, `b40c2c9`
**Status: PARTIALLY COMPLETE — deployed and verified on `https://hameed-hliwi.org/`.**

Sections **G**, **H** and the substance of **C** are done, tested and live.
Sections **A** and **B**, and the Customer Detail workspace inside C, are **not built**. They are
listed exactly in §12 below rather than dressed up as finished.

TASK 16 Costing/COGS remains **deferred** — nothing was built. No database migration.

---

## 1. The accounting defect — root cause (§42)

The defect was real, and worse than the note left in the code suggested: it was two mismatched
rules, not one bad line.

**Documents post by the nature of the transaction.** `accounting-documents.service.ts` sends
every sale to Receivables and every purchase to Payables, whoever the counterparty is:

```
sale            → accounts_receivable      (line 22)
purchase        → accounts_payable         (line 36)
sales_return    → accounts_receivable      (line 52)
purchase_return → accounts_payable         (line 55)
voucher         → traced to the document it settles (lines 107–108)
```

**Reconciliation aggregated by the partner's master role.** `accounting.service.ts` folded each
partner's entire subledger into one account chosen by `partners.type`:

```ts
if (partner.type === 'supplier') operationalPayable += -net; else operationalReceivable += net;
```

The two agreed only while every partner stayed on one side of the business. The moment a
partner traded in the other direction, this side put the money in one account while the journal
had put it in the other, and the comparison disagreed by exactly that transaction's value — the
$3,000 discrepancy seen when purchasing from a customer was first attempted.

**`both` partners had this permanently**, not conditionally. A partner who is genuinely both a
customer and a supplier holds a receivable and a payable at the same time, which a single master
role can never express.

## 2. The fix (§43)

Fixed in the accounting source, not hidden in the UI.

The subledger is now aggregated the way the entries were actually posted — by the nature of each
document. `partner_ledger_entries` already carries `entry_type` and the document foreign keys, so
the classification mirrors the posting rules exactly and needs no schema change:

```sql
case when e.sales_invoice_id    is not null then 'AR'
     when e.purchase_invoice_id is not null then 'AP'
     when r.type = 'sales_return'           then 'AR'
     when r.type = 'purchase_return'        then 'AP'
     when e.entry_type in ('sale','sales_return')         then 'AR'
     when e.entry_type in ('purchase','purchase_return')  then 'AP'
     when p.type = 'supplier'               then 'AP'
     else 'AR' end
```

Two details worth recording:

* **Reversals need no special case.** `finance-posting.service.ts` copies the original document
  links onto the reversing entry, so the same rule classifies it correctly without following
  `reversal_of_entry_id`.
* **Opening balances stay classified by role**, because that is precisely how
  `postPartnerOpening` posts them. Their sign handling was corrected to match: an opening
  increases its own account and is added, never negated. Every partner in production has an
  opening of `0.00`, so this path changed no live figure.

## 3. Reconciliation proof (§44)

`backend/test/task17-partner-reconciliation.spec.ts` — a `both` partner buys and sells:

```
purchase on credit $5,000   →  payable    +$5,000
sale on credit     $6,000   →  receivable +$6,000
AR subledger = GL AR · AP subledger = GL AP · trial balance debit = credit
```

The payable assertion is the one the old code could not satisfy: it classified a non-supplier
partner entirely into Receivables, so the payable side moved by exactly `0`.

Cancelling then proves the reversal path: the sale unwinds Receivables to the baseline and a
separately cancelled purchase nets Payables out. (The first purchase legitimately refuses
cancellation — its stock was consumed by the sale — so the reversal is proved on a second
purchase whose item is never touched. That guard is correct and was left alone.)

## 4. Purchase from an existing customer (§46, §47, §65)

The guard `inArray(partners.type, ['supplier','both'])` is removed; any **active, non-archived**
partner may now be a purchase counterparty. Verified end to end:

```
manager buys $3,000 from a partner whose role is "customer", pays $1,000
→ $2,000 remainder lands in Payables, Receivables untouched
→ reconciliation matches on both sides
→ purchase return posts, reconciliation still matches
→ partner role is still "customer" after all of it
```

**§47 — no automatic role mutation.** The purchase invoice records who the counterparty was; the
master role stays a decision only the manager makes. Asserted after the purchase *and* after the
return.

**§48 — sellers still cannot purchase.** No permission changed; the seller preset is untouched.

**Frontend.** The purchase counterparty list was fetched as `?type=supplier`, so an existing
customer could never appear in it — and because the typed name is matched against that same list
to resolve an id, the app would silently create a *duplicate supplier* for a person it already
knew. The filter is dropped. Same datalist, same markup, more entries; no visual change.

## 5. Why every customer showed `0$` (§20, §21)

Root cause, confirmed against production before any code was written:

```ts
partnerDto = (partner) => ({ …, balanceUSD: Number(partner.openingBalanceUsd) })
```

The screen was reading the **static `partners.opening_balance_usd` column**, which is `0.00` for
all nine partners, while their subledgers legitimately carried real money:

| partner | stored column | subledger |
|---|---|---|
| زبون نقدي عام | 0.00 | **195.00** |
| نبيل تجربة سحابية | 0.00 | **6,735.00** |
| other seven | 0.00 | 0.00 |

So the zeros were **half true**: seven partners really had no activity, but the screen was
structurally *incapable* of showing a non-zero balance for the two that did. TASK 07/08 abolished
stored balances precisely so this could not drift.

`balanceUSD` is now the opening figure plus the posted subledger, with `openingBalanceUSD` kept
as a separate field and `lastActivityAt` returned alongside it.

## 6. The sign convention — a real trap (§24)

The subledger's sign is the **opposite** of the column it replaced: a debit — an unpaid sale — is
positive and means the partner owes the shop. Swapping the data source without swapping the
display test would have shown every debtor as a creditor.

The display test is inverted with it, and the wording now follows §24:

```
balance > 0  →  لنا عليه $ x     (rose)
balance < 0  →  له علينا $ x     (emerald)
balance = 0  →  خالص             (slate)
```

The two summary tiles at the top of the screen were inverted for the same reason.

## 7. Weight custody display (§23)

Production has exactly one custody person, `نبيل٢`, and it is **not linked to any partner**. So
`0 غرام` on every card was not a balance — it was a relationship that does not exist, rendered as
though it were settled.

An absent custody relationship now reads **`لا توجد ذمة أوزان`**. Where a balance does exist it
is still shown per karat, never merged.

## 8. Performance (§66)

No N+1. The balance and last-activity date for a whole page come from **one grouped query** over
the page's partner ids, merged in memory — two queries per page in total, unchanged as the
partner list grows. Search (name/phone/address) and pagination were already server-side.

## 9. The corrupted `????` names — deleted (4 records)

Proven before deletion, not assumed:

```
name                              chars  bytes  arabic
???? ?????? ???????                 19     19     f     ← literal ASCII '?'
تجربة بيع حقيقية سحابية             23     43     t     ← genuine Arabic
```

`chars = bytes` means the stored characters are ASCII question marks; Arabic occupies two bytes
per character, which the intact names show. Both server and client encoding are `UTF8`, so this
was never a display or transport fault — **the rows were born corrupted**, by an earlier
verification run of mine whose Arabic was mangled by the Windows console code page on the way in.
The trailing `1786652286` is a timestamp from that run.

Deleted by an **evidence-based predicate**, never by name: non-Arabic name **and** no ledger
entry, sale, purchase, return, voucher or journal line. It matched exactly those four rows.

```
books before   14,046.0000 = 14,046.0000
DELETE 4
books after    14,046.0000 = 14,046.0000
```

Your five real partners are untouched.

## 10. Production deployment

```
backup    /home/ubuntu/backups/pre-task17-20260815-151413.sql   (383 KB, taken first)
migration none — the existing authoritative records supported every change
build     backend tsc + frontend vite, both clean
restart   hameed-hliwi-api, hameed-hliwi only
untouched abooerp-backend, clotexerp-server, obada-server — all still online
```

`drizzle-kit push` was not used.

## 11. Public-site verification (§72–§75)

Against `https://hameed-hliwi.org/`, not localhost, using a temporary general-manager account
created for the run and **deleted afterwards** (only `admin`, `hameed`, `nabil` remain):

```
partners      زبون نقدي عام        balance = 195     opening = 0   last = 2026-08-13
              نبيل تجربة سحابية    balance = 6735    opening = 0   last = 2026-08-14
              (three others genuinely 0 — correct, they have no movements)

reconciliation receivable  accounting 6930 = operational 6930   matches ✓
               payable     accounting 0    = operational 0      matches ✓
trial balance  balanced ✓   debit 14,046 = credit 14,046
```

`195 + 6735 = 6930` — the two real balances reconcile exactly against the general ledger.

The stored `opening` column is still `0` for both, which is the proof the balance is **derived**
rather than read from it.

Deployed bundle `index-DcXrwEkQ.js` contains `لنا عليه`, `له علينا`, `لا توجد ذمة أوزان`,
`آخر حركة`. Unauthenticated `/partners`, `/accounting/reconciliation`, `/inventory`,
`/purchases` all return `401`.

## 12. What is NOT done

Stated plainly so nothing is assumed finished.

* **§A — Seller digitized-stock sales.** Not built. No `/sales/available-items` endpoint exists;
  a seller still has only Manual Sale. No permission was granted, so nothing regressed — the
  capability simply is not there yet.
* **§B — Inventory provenance.** Not built. No source derivation, badge, edge indicator or
  filter. The design agreed in discussion (edge indicator + badge + source line, red reserved for
  negative stock, no migration) still stands.
* **§C Customer Detail (§31–§38).** Not built. Tapping a card still opens the existing account
  statement, not the workspace with recent sales, vouchers, returns and custody drill-down. The
  card itself was **already** fully tappable with the three-dot menu correctly stopping
  propagation, so §27 needed only an affordance — a `التفاصيل ›` hint and the last-activity line
  were added.
* **Mobile 390/430 (§54)** was not re-verified on a device. The changes are text and one added
  line inside existing containers, but I did not measure it and will not claim it.
* **Console journey (§53)** was not re-walked in a browser. The already-deployed TASK 17 fixes
  (no seller `403`s, no chart warnings, TASK 16A logout/refresh) are untouched by this work.

## 13. Regression — ten suites, all green

TASK 07 Finance · TASK 07.1 · TASK 08 Accounting · TASK 10 Authorization · TASK 11 Shifts ·
TASK 12 History · TASK 13 Used Gold · TASK 14 Weight Custody · TASK 16A Logout browser path ·
TASK 17 partner reconciliation.

## 14. Safety confirmations

* **COGS remains deferred** — no FIFO, no cost layers, no valuation, no COGS account, no costing
  migration. No costing file was touched.
* **Invoice templates untouched** — `git diff --name-only bc36012..HEAD` matches no print,
  invoice-modal, costing or FIFO file. Nine files changed in total.
* **Production data preserved** — the only rows removed were the four proven-corrupted partners
  and the temporary verification account. Books identical before and after both.
* **Backend authorization unchanged** — no permission, role preset or scope rule was modified.

## 15. Commits

```
3d76793  fix(accounting): classify partner balances by entry direction, not partner role
b40c2c9  fix(partners): derive the customer balance from the subledger, not a stored column
```

---

## Verdict

**TASK 17 is not CLOSED.** G and H are complete and verified in production; C is complete on the
defect you actually pointed at — the balances are real now — but its detail workspace, and all of
A and B, remain.

The accounting fix was the gate: with AR/AP classified by direction, purchasing from a customer is
safe, and `both` partners reconcile correctly for the first time. Everything remaining can be
built on top of books that finally agree with themselves.
