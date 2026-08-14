# TASK 09 — Gold Weight Accounts & Gold Settlement

**Status:** implemented, tested, deployed, verified in production
**Commit:** `d369130` — *feat: make gold weight obligations a first-class ledger*
**Migration:** `0010_quick_zombie.sql`, recorded in `drizzle.__drizzle_migrations` as id **11**
**Deployed:** 2026-08-14 — https://hameed-hliwi.org

---

## 1. What this task changed

Gold obligations used to live in the browser: a name, an item name, a weight, a direction —
**with no karat at all**, and no link to a partner or to any invoice. A weight without a
karat cannot be settled honestly, because 10 g of 21K and 10 g of 18K are not the same
thing.

Gold is now a first-class, auditable business fact with the required chain:

```
Business Document → Gold Transaction → Gold Weight Ledger → Partner Gold Balance → Statement → Reconciliation
```

Two rules hold everywhere:

- **Gold never touches cash.** No gold movement writes a cash movement, a voucher, or a
  cashbox balance. The money side of a scrap exchange was already settled by the invoice.
- **Karats are never merged.** A balance is always a list, one line per karat. The
  pure-gold equivalent is offered *beside* the per-karat figures, never instead of them.

---

## 2. Data model (migration 0010)

| Table | Purpose |
| --- | --- |
| `gold_accounts` | one account per partner, one per branch for the shop's own metal, plus system accounts (`sales_settlement`, `opening_gold`) |
| `gold_transactions` | the document-level record: number, type, status, source, posting event |
| `gold_transaction_sequences` | per-year, per-type numbering (`GSX-2026-001`, `GPM-2026-013`, …) |
| `gold_ledger_entries` | the immutable ledger: one row per side, karat, debit/credit grams, pure-gold grams |

Guarantees enforced by the database, not by convention:

- `karat` is constrained to `('24','22','21','18','14')`.
- A ledger line is debit **or** credit, never both.
- `pure_gold_grams` is computed by PostgreSQL numeric arithmetic at write time
  (`round(weight * karat / 24, 4)`), so the browser can never disagree with the ledger.
- A partial unique index on `(source_type, source_id, source_line_id, posting_event)`
  makes a repeated post of the same source event impossible.
- `gold_accounts.system_code` is unique when not null; a partner account is unique per
  partner.

### Sign convention

> **Positive partner balance = the partner owes the shop gold.**
> **Negative = the shop owes the partner.**
> **Positive company balance = metal the shop physically holds.**

---

## 3. The posting model

`GoldPostingService` is the **only** writer of gold movements. Every transaction must
balance **in pure gold** — that is precisely what makes a karat conversion expressible
while still refusing to add grams of different purities together.

| Event | Debit | Credit | Effect |
| --- | --- | --- | --- |
| Sale takes scrap | branch holding, W @ karat | `sales_settlement`, W | metal in; its value was already credited on the invoice, so the customer is left at **zero** |
| Sales return on such a sale | `sales_settlement`, W′ | partner, W′ | no metal moves; the shop now **owes** the customer W′ at the original karat |
| Manual receipt | branch holding | partner | reduces what the partner owes |
| Manual payment | partner | branch holding | reduces what the shop owes |
| Conversion | see below | see below | restates an obligation from one karat to another |
| Opening balance | partner or `opening_gold` | the other side | an explicit, dated opening obligation |

**Why a settlement account.** A naïve model (`Dr holding W / Cr partner W`) would say the
customer is owed 5 g *and* had the money credited — the shop would pay twice. Routing the
scrap through `sales_settlement` records both that the metal arrived and that its value was
consumed by the invoice. When part of the sale comes back, exactly that share of the
settlement is undone, and that is what the customer is owed.

**Return share.** `scrapCreditAllocatedUsd / originalScrapValue`, applied to each original
scrap line at **its own karat** — so a partial return owes a proportional weight of the
same karat, never a converted or averaged one.

**Conversion direction.** A conversion restates an obligation that already exists, so it
moves in the direction that closes it: an amount the partner owes is closed by a credit,
an amount the shop owes by a debit. Converting a karat with no balance is refused rather
than silently creating one.

---

## 4. API (`/api/v1/gold`)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/karats`, `/accounts`, `/partners`, `/partners/:id`, `/partners/:id/statement`, `/transactions`, `/transactions/:id`, `/reconciliation` | `gold_accounts.view` |
| POST | `/receipt`, `/payment` | `gold_accounts.transaction.create` |
| POST | `/opening` | `gold_accounts.adjust` |
| POST | `/conversion` | `gold_accounts.convert` |
| POST | `/transactions/:id/reverse` | `gold_accounts.reverse` |

Safeguards:

- **Over-settlement guard** — handing over or taking in more than the open balance is
  refused (409) unless the caller explicitly passes `allowReverseBalance`.
- **Concurrency** — the partner's account row is locked `FOR UPDATE` before the balance is
  read, so two cashiers settling the same obligation cannot both succeed.
- **Idempotency** — every manual movement carries an `idempotencyKey`; a replay returns
  the original transaction instead of moving metal twice.
- **Reversal** — a correction is always a new, opposite transaction; the original is
  marked `reversed` and never rewritten. Document-sourced movements refuse manual reversal
  (409) and are reversed by cancelling their source document.

---

## 5. Frontend

**No layout, palette, or component structure was changed.** The screens keep their design;
what changed is where the numbers come from.

- **ذمم الأوزان** — migrated off localStorage entirely. Same card grid and modal, now
  showing per-karat balances from the ledger, a full statement with a per-karat running
  balance, a print view, and the four actions (receipt, payment, conversion, opening).
- **العملاء والموردون** — the gold column now shows real per-karat obligations from the
  ledger instead of the single opening `21K` figure; the summary card states the total in
  fine gold, because grams of different karats cannot be summed. The WhatsApp statement
  text follows the same data.
- **المرتجعات** — before saving, the return screen states the weight the shop will owe
  back (`سيصبح المحل مديناً بوزن: 5.000 غ عيار 21`), so the cashier is not surprised by an
  obligation that money alone does not show.
- **طباعة الفاتورة** — already printed the scrap karat and weight; unchanged.

---

## 6. Backfill

`npm run db:backfill:gold` (dry run by default, `--apply` to write). It replays the live
posting path, so it is idempotent by construction.

Production had exactly one gold fact to migrate:

```
INV-2026-002 [posted] — 1 exchange line, 9.100 g of 21K
Backfill complete. Gold transactions created: 1. Reversals for cancelled documents: 0.
  21K — debit 9.100 g · credit 9.100 g · net pure 0.0000 g
```

**Deliberately not migrated:** the old browser-only weight entries. They carry no karat,
and a karat cannot be inferred without inventing a fact. This is reported in the
reconciliation notes rather than hidden.

---

## 7. Tests

`npm run test:gold` — 12 checks covering access control, sale exchange, return obligation,
over-settlement and wrong-karat refusal, idempotent replay, **concurrent settlement**
(exactly one writer admitted), conversion equivalence, statement running balance, reversal,
cancellation, and reconciliation. Every phase re-asserts that **all** gold transactions
still balance in pure gold and that every stored `pure_gold_grams` matches its karat.

`npm run test:task09` — the required end-to-end scenario on a live server:

```
[1] ✓ INV-2026-320 → GSX-2026-034: 8.000 g of 21K into the shop, customer balance flat
[2] ✓ RET-2026-163: shop owes 8.000 g of 21K, no cash moved
[3] ✓ 3.000 g handed over, 5.000 g still owed, over-settlement refused
[4] ✓ statement: GSR-2026-010 -8 → GPM-2026-013 -5
[5] ✓ 12.000 g of 22K converted to 12.571 g of 21K, fine gold preserved
[6] ✓ trader settled in full, no karat left open
[7] ✓ 3 transactions / 6 immutable ledger entries for the trader
[8] ✓ 34/34 scrap exchanges posted · 105 transactions balanced · net fine gold 0.001 g
[9] ✓ customer balance still -5 g of 21K after restart
```

Regression suites re-run and passing: `test:task06` (returns), `test:finance` (Task 07),
`test:accounting` (Task 08).

---

## 8. Two corrections found while building

Both were found by the tests, not guessed at:

1. **Conversion posted in the wrong direction.** It debited the source karat unconditionally,
   which doubled a partner-owes balance instead of closing it. Fixed by deciding the
   direction from the existing balance, and refusing a conversion when there is nothing to
   convert.
2. **Reconciliation reported every scrap exchange as unposted.** Drizzle renders a
   correlated subquery without its outer reference — the same trap that produced zero
   cashbox balances in Task 07. Replaced with an explicit left join.

A third point of honesty: per-karat gram totals do **not** balance once conversions exist,
because a conversion moves weight between karats by design. The reconciliation now states
the same-karat balance separately from `conversionNetGrams`, and adds the one global
invariant that does hold — the whole ledger nets to zero fine gold.

---

## 9. Deployment

1. `pg_dump` backup → `/home/ubuntu/backup_pre_task09_20260814_155713.sql` (278 KB)
2. Commit `d369130` transferred as a git bundle and pulled on the server
3. `0010_quick_zombie.sql` applied as the PostgreSQL owner in a single transaction
4. New tables and enums handed to `hameed_hliwi_app`; all four tables verified owned
5. Migration recorded in `drizzle.__drizzle_migrations` (id 11, hash `33f098c763932c00…`)
6. Gold permissions granted — production has one role, `system_admin`, which holds all five
7. Backend and frontend rebuilt; only `hameed-hliwi-api` and `hameed-hliwi` restarted
8. Backfill applied (1 transaction)

### Live verification

```
site: 200 · api health: {"status":"ok","database":"ok"} · /gold/accounts unauthenticated: 401
GSX-2026-001 | sale_exchange | posted | INV-2026-002
  ذهب المحل — فرع الفرقان حميد حليوي  21K  +9.100 g  (7.9625 g fine)
  ذهب محتسب ضمن الفواتير              21K  −9.100 g  (7.9625 g fine)
sales_gold_exchanges: 1 total, 1 posted
```

The served `index.html` references the freshly built bundle (`index-E2bOdc6U.js`), which
carries the gold client.

---

## 10. Out of scope, as instructed

COGS, gold valuation reporting, and advanced gold analytics were **not** implemented.
TASK 10 was not started.

**TASK 09 = CLOSED / PASSED**
