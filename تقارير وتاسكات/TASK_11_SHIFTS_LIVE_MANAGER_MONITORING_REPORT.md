# TASK 11 — Shifts, Seller Accountability & Live Manager Monitoring

**Hameed Hliwi Jewelry** · commit `a95fd5d` · migration `0014`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`, 35/35 production checks green.

---

## 1. Existing shifts audit

The audit came first, and the answer changed the size of the task: **there was no shift system
on the server at all.**

What existed was a browser toy. `WorkShift` in `types.ts` held `{ id, userId, userName,
startedAt, endedAt }` plus a couple of summary numbers; `StoreContext` created it with
`shift-${Date.now()}` and kept it in `localStorage`; `ShiftsView.tsx` was 26 lines that
filtered local invoices. There was no `shifts` table, no column referencing a shift anywhere in
the schema, no endpoint, no permission. `grep -ri shift backend/src` returned one line — an
unrelated navigation entry.

So nothing was migrated or preserved from it, because there was nothing durable to preserve. It
was deleted outright and replaced.

Production baseline before the migration: 2 users (`admin`, and `hameed` — an account Nabil
created himself through the Task 10 Users screen), 5 sales invoices, 0 returns, 4 vouchers,
9 journal entries, 1 gold transaction, 1 warehouse.

## 2. Schema

```
shifts
  shift_number (5001…) · seller_user_id · warehouse_id · status
  opened_at/by · closing_requested_at · closed_at/by · approved_at/by
  opening_custody_usd · opening_custody_syp
  expected_usd/syp · actual_usd/syp · difference_usd/syp
  seller_note · manager_note · closure_snapshot (jsonb) · idempotency_key · version

shift_activities
  shift_id · type · occurred_at · actor_user_id · description
  reference_number · amount_usd · sales_invoice_id · return_invoice_id · metadata

sales_invoices.shift_id   → shifts (nullable)
return_invoices.shift_id  → shifts (nullable)
```

The one-open-shift-per-seller rule lives in PostgreSQL, not in the service layer:

```sql
CREATE UNIQUE INDEX shifts_one_live_per_seller ON shifts (seller_user_id)
  WHERE status in ('open', 'closing_requested');
```

Two simultaneous requests cannot both win. The service catches the resulting `23505` only to
turn it into a readable Arabic message.

Shift numbers follow the General Manager's numbering rule from the earlier task: plain digits,
`5001` upward, defined in the same `DocumentNumberService` as every other document.

## 3. Shift lifecycle

```
open ──request──▶ closing_requested ──approve──▶ closed (snapshot frozen)
                        │
                        └──reject──▶ open
```

`cancelled` exists in the enum for an administrative forced close but is not reachable from the
normal flow. A **closed shift is never reopened**: the reject path is refused with `409` once
approval has happened, so history cannot be mutated after the fact.

## 4. Seller workflow

Login → the sales screen shows a shift bar → **فتح وردية** (opening custody in USD and SYP,
zero allowed) → sell → **طلب إغلاق الوردية** → enter what is physically being handed over →
explain any gap → wait for the manager.

Four fields and two buttons, all inside the screen the seller already works in.

## 5. Manager workflow

The `الورديات` module opens on **المفتوحة الآن**: one card per live seller carrying invoice
count, sales total, cash by currency, receivables and sold weight. Tapping a card opens the
full shift — totals, weight per karat, scrap per karat, custody, the invoice list, the return
list and the activity timeline — with **اعتماد الإغلاق** and **رفض وإعادة فتح** pinned to the
bottom of the sheet.

`طلبات الإغلاق` filters to shifts waiting on the manager. `سجل الورديات` is the historical
register with date range, difference-only and warehouse filters.

## 6. General Manager workflow

Identical screens, global scope: every warehouse, every seller, every shift, current and
historical. No warehouse assignment rows, and warehouses created later are included
automatically.

## 7. Authorization

No second authorization system was built. Everything routes through the Task 10
`AuthorizationScopeService`:

| Role | Shift scope |
|---|---|
| Seller (`own`) | own shifts only — list, detail and the module are all filtered server-side |
| Warehouse Manager | every shift in the assigned warehouses; refused outside them |
| General Manager (`global`) | every shift in every warehouse |

Permissions added: `shifts.view`, `shifts.open`, `shifts.close.request`, `shifts.approve`,
`shifts.manage`. The seller holds only the first three. A seller cannot approve any shift,
including their own (`403`), and holds no management privilege.

The `الورديات` navigation module requires `shifts.manage`, which the seller does not have — so
the seller keeps the invoices-only navigation Task 10 established, and their shift lives inside
the sales screen instead of adding a module.

## 8. Sales integration

`resolveShiftForDocument` runs inside the sale's own transaction, before any number is
reserved:

* a seller with no open shift → `409 يجب فتح وردية قبل إنشاء فاتورة بيع`;
* a seller whose shift is `closing_requested` → refused, so expected cash cannot move while the
  manager is reconciling;
* a manager or General Manager → **not** forced into a shift, but attributed to one if they
  happen to have it open;
* the resolved `shift_id` is written on the invoice row, and a `sale.created` entry is appended
  to the shift timeline in the same transaction.

Cancelling a sale appends `sale.cancelled` to the timeline of the shift that created it.

## 9. Returns integration

Sales returns raised by a seller carry the same `shift_id` and produce a `return.created`
timeline entry, so the manager reads net activity rather than sales alone. Purchase returns are
outside the seller flow and are unaffected.

## 10. Finance integration and cash custody

This is the design decision the task asked to make from the existing workflow rather than
assume, so it is stated plainly.

**Sales cash already reaches the company cashbox the moment the invoice posts.** Task 07 posts
the automatic voucher and cash movement inside the sale transaction. There is no step in this
business where cash sits with the seller and is later transferred into the cashbox as a
separate financial event.

Therefore:

* **Shift closing creates no voucher, no cash movement and no transfer.** Doing so would count
  the same money twice, which §35 forbids.
* Opening custody is stored as a **shift custody fact**, not a fabricated cashbox movement.
  No money is invented.
* A shift is an *accountability* record: what the seller started holding, what the documents
  say they should be holding, and what they actually handed back.

This was verified in production, not asserted: the full lifecycle ran and the voucher, cash
movement, journal and gold counts were **identical before and after**.

## 11. Expected vs actual

Computed on the server, per currency, never collapsed:

```
expected = opening custody + cash collected − cash refunded
```

Cash collected counts only `cash_usd` / `cash_syp` payments on **posted** invoices of that
shift; refunds likewise from posted returns. Cancelled documents count for nothing.

Automated proof (§55): opening 500 USD, cash sales 1000 USD, plus a 2,000,000 SYP payment
against a separate invoice, opening custody 2,000,000 SYP →
**expected 1,500 USD and 4,000,000 SYP**, asserted independently per currency.

## 12. Difference handling

The seller sees the gap live as they type, before submitting. If expected ≠ actual, a note is
**required** — the request is refused with `409` without one. Expected is never silently forced
to equal actual. The manager sees shortage or surplus, the currency, the amount and the
seller's explanation, colour-coded.

## 13. Manager approval

Approve → `closed`, with `approved_by_user_id`, `approved_at` and the manager note recorded.
Reject → back to `open` with a mandatory reason; the handover figures are cleared so the next
request recomputes them from the documents as they stand then. Approving twice is `409`.

## 14. Notifications and realtime

After each commit the backend emits `shift.opened`, `shift.closing_requested`, `shift.closed`
and `shift.updated` to the managers watching that warehouse (`warehouse-permission` room) and
to every global-scope user. The closing-request payload carries seller, shift number, expected,
actual and difference — enough to judge urgency without opening the shift.

Nothing is emitted before commit.

**Fallback (§25).** The production edge does not reliably upgrade WebSocket connections, and
the frontend has no socket.io client. Rather than block the task on that, live monitoring is
driven by a lightweight interval refresh (`useLiveRefresh`): 20 s on the manager screens, 15 s
inside an open shift, 30 s on the seller bar. It pauses while the tab is hidden and fires once
immediately when it returns, so a phone in a pocket costs nothing. The realtime events are in
place for whenever a socket client is added.

## 15. Weight and gold exchange summaries

Reported per karat and never merged. Automated proof (§56): selling 21K 12.000 g, 21K 8.250 g
and 18K 5.000 g yields exactly `21K = 20.250 g` and `18K = 5.000 g` — asserted as a deep
equality so a 25.250 g single total would fail.

Scrap taken in is a separate list (§57): a sale receiving 9.100 g of 21K scrap shows
`كسر مقايضة 21K = 9.100 g`, apart from sold weight, and creates no duplicate gold posting —
Task 09's posting path is untouched.

## 16. Query efficiency

`ShiftTotalsService` computes every metric in **six grouped queries across the whole set of
shifts at once**. A screen with twelve open shifts costs six queries, not seventy-two, and no
invoice is ever fetched into React to be summed there.

## 17. Concurrency and idempotency

* Two shifts at once — partial unique index in PostgreSQL.
* Closing while a sale posts — the shift row is `SELECT … FOR UPDATE` locked, and the sale path
  reads it under the same lock inside its own transaction.
* Double approval — guarded by `status` **and** `version` in the `WHERE` clause; the second
  request updates zero rows and raises `409`.
* Seller editing values after approval — the status guard refuses it.
* Duplicate opening from a double tap — `idempotency_key` is unique; a retry returns the same
  shift, verified by asserting both calls return the same id.

## 18. Audit

Recorded with actor, warehouse and before/after values: `shifts.open`,
`shifts.closing.request` (expected, actual, difference, note), `shifts.closing.reject`,
`shifts.closing.approve` (the full snapshot). No secrets are logged.

## 19. Immutable closure snapshot

On approval the shift freezes a complete summary into `closure_snapshot`, and every read of a
closed shift serves that snapshot rather than recomputing. Proven directly: after approval, a
new shift and a further sale were created for the same seller, and the closed shift's totals
were asserted **deep-equal to what they were before** — a closed shift cannot drift.

## 20. Historical data

The 5 sales that existed before this task keep `shift_id = NULL`. No shift was fabricated for
them and none was attached silently; they are simply documents from before the shifts module.
Verified in production: `sales_invoices WHERE shift_id IS NOT NULL` = 0.

## 21. Mobile

Both screens were built mobile-first for 390 px and 430 px.

**Seller** — the shift bar is a single card: status, start time, three summary tiles
(فواتيري / مبيعاتي / المتوقّع) and one full-width action button. Opening and closing rise from
the bottom as `92dvh` sheets with a fixed header, their own scrolling body and a sticky footer,
so the submit button is always reachable. Numeric fields use `inputMode="decimal"` and are
LTR-aligned with a monospace font. No horizontal scrolling anywhere.

**Manager** — open shifts are **cards on every screen size**, one column on a phone and a grid
from `md`. There is no wide desktop table to squeeze. Card metrics are two-up with truncation,
readable without zoom. The detail sheet is the same full-height pattern, and the approve/reject
buttons sit in a sticky footer as a two-button grid at full tap size.

## 22. Tests

**`backend/test/task11-shifts.spec.ts`** — 28 assertion groups, all passing, running the real
scenario: a General Manager, a branch manager and two sellers at one counter.

Seller: cannot sell without a shift · opens one · second open refused `409` · retried open
returns the same shift · sales linked to the shift · sees only their own shift · cannot read a
colleague's · closing request blocks new sales · cannot approve their own shift.
Manager: sees both sellers live · reads their shifts · refused the unassigned warehouse ·
rejects and reopens · approves · differences preserved.
General Manager: every warehouse, no warehouse rows.
Financial: expected per currency; approval creates no finance voucher.
Weight: per-karat totals; scrap reported separately.

**Regression (§37):** `task10-authorization`, `finance-cycle` (Task 07), `task071-regression`,
`accounting-core` (Task 08), `gold-accounts` (Task 09), `task091-regression` — all passing.

The Task 10 suite needed one honest update: its sellers now open a shift before selling,
because that is the new rule. Nothing was weakened to make a test pass.

## 23. Production migration

`pg_dump` backup → `backup_pre_task11_20260814_212*.sql`. Commit transferred as a git bundle.
Migration `0014` applied as the PostgreSQL owner in a **single transaction** with
`ON_ERROR_STOP=1`; `shifts`, `shift_activities` and the `shift_status` type reassigned to
`hameed_hliwi_app`; hash recorded in `drizzle.__drizzle_migrations` (id 15).
**`drizzle-kit push` was not used.**

## 24. Production deployment

Backend and frontend rebuilt on the server. **Only `hameed-hliwi-api` and `hameed-hliwi`
restarted.** No other VPS application touched.

## 25. Production verification

**35 checks, 35 passed, 0 failed**, against the live public URL.

General Manager sees the shifts module · admin access intact · temporary seller created through
the users API · seller navigation stays invoices-only · **sale refused before a shift is
opened, with the business message** · shift opens bound to the seller's warehouse · expected
equals opening custody · second open refused · the shift appears live on the manager screen
with the seller's name · unexplained difference refused · difference computed per currency
(−10 USD, 0 SYP) · new sale refused while awaiting approval · seller cannot approve their own
shift · manager rejects and reopens · manager approves · snapshot frozen · double approval
refused · closed shift cannot be reopened · all nine previous modules still return 200.

The verification deliberately **posted no sale, return or voucher**. The seller-cannot-sell rule
was verified by its refusal, which writes nothing, and sale-to-shift linkage is covered by the
automated suite. Nabil's books were confirmed byte-identical before and after:

```
before → sales=5 returns=0 vouchers=4 journals=9 gold=1 cash=4
after  → sales=5 returns=0 vouchers=4 journals=9 gold=1 cash=4
trial balance still balances · historical sales with a shift: 0
```

Both temporary accounts and their shifts were removed. Remaining users: `admin`, `hameed` —
`hameed` is the account Nabil created himself and was never touched. No real seller accounts
were created (§59).

---

## 26. Remaining risks and notes for Nabil

1. **Visual check on your phone.** Both screens were built and reasoned for 390/430 px but I
   have not seen them on your device — worth one look at the seller bar and the manager cards.
2. **No sellers exist in production yet.** The module is deployed and proven; creating the real
   sellers is your decision. The moment you do, that seller must open a shift before selling.
3. **You and `hameed` are General Managers, so you are not forced into a shift** and can keep
   selling exactly as before. If you ever want the owner's own sales inside a shift too, that is
   a one-line policy change.
4. **Closing does not move money.** This is deliberate and is the correct reading of your
   current workflow: the cash is already in the cashbox from the sale. If the business ever
   changes so that a seller physically hands a bag of cash to the office as a separate event,
   that becomes a real cashbox transfer and would be a small addition — the shift already holds
   the actual handover figures it would need.
5. **Live monitoring is interval-based, not push.** It refreshes every 20 seconds on the manager
   screen. If the Cloudflare WebSocket limitation is ever lifted, the backend events are already
   being emitted and a socket client would make it instant.
6. **A closed shift is final.** By design there is no reopen. If a closed shift turns out to be
   wrong, the correction is a new shift or a corrective document, so history stays auditable.

**TASK 11 = CLOSED / PASSED.**
