# TASK 08 — Accounting Core, Double-Entry Posting & General Ledger

Status: **TASK 08 = CLOSED / PASSED** — the chain `Business Document → Operational Finance → Accounting Journal → General Ledger → Trial Balance` is live and reconciled on `https://hameed-hliwi.org/`. Every posted journal balances, every automatic posting is source-linked and idempotent.

## Data Cleanup

No fake accounting data existed to remove: there was no chart of accounts, no journal model and no local accounting arrays before this task. The existing "دفتر اليومية العام" screen rendered cash movements, not accounting entries, and now sits beside the real journal screens.

Production business data was untouched. A `pg_dump` was taken before the migration and retained at `~/backups/hh_pre_task08.dump`. Counts after deployment: 2 sales, 0 purchases, 0 returns, 3 vouchers, 6 inventory items, 9 partners — unchanged by this task except for the accounting entries derived from them.

## Chart of Accounts

Hierarchical, PostgreSQL-backed, seeded by migration `0009_groovy_sentry.sql`:

```
1    الأصول
  11   النقدية والصناديق
    111  نقدية بالدولار      → 111001 صندوق فرع الفرقان - دولار
    112  نقدية بالليرة       → 112001 صندوق فرع الفرقان - ليرة سورية
  12   ذمم العملاء المدينة        (accounts_receivable)
  13   المخزون والمشتريات         (inventory)
2    الخصوم
  21   ذمم الموردين الدائنة       (accounts_payable)
3    حقوق الملكية
  31   الأرصدة الافتتاحية         (opening_equity)
4    الإيرادات
  41   إيرادات المبيعات           (sales_revenue)
  42   مردودات المبيعات           (sales_returns, contra-revenue)
5    المصاريف
  51   المصاريف التشغيلية         (operating_expenses)
```

Accounts carry a UUID, unique code, Arabic and optional English name, parent, class, normal balance, active flag, posting-allowed flag, system flag, optional warehouse and currency, notes and a version. Headings do not allow posting.

## System Accounts

Ten accounts are marked `is_system` and carry a stable `system_key`. They may be renamed but **cannot** be deactivated, archived or turned into headings — the API rejects it with a clear message, verified by test. Cash leaf accounts are also system accounts, created per cashbox.

## Account Mappings

Nothing in application source hardcodes an account id. Two resolution mechanisms:

* `accounts.system_key` for the fixed accounts the posting rules name;
* `account_mappings` (`mapping_key → account`) for per-entity mapping — `cashbox:<uuid>` and `expense_category:<name>`.

A cashbox gets its leaf account and mapping the moment it is created, inside the same transaction, with the code derived from its currency's parent. An expense category gets a child account under operating expenses on first use. Resolution is otherwise strict: a missing system account or mapping fails posting with a configuration error rather than guessing.

## Journal Schema

* `journal_entries` — UUID, `JRN-YYYY-NNNNNN` number, year/sequence, date, status (`posted` | `reversed`), source type, source id, source number, posting event, description, warehouse, partner, total debit, total credit, reversal links, created/posted by, timestamps.
* `journal_entry_lines` — entry, line number, account, debit, credit, currency, original amount, exchange rate, partner, cashbox, warehouse, memo and the source document references.
* `journal_sequences` — concurrency-safe annual numbering, allocated in the database.

Database constraints enforce the model: a header must have `total_debit = total_credit > 0`; a line may not carry both a debit and a credit, and must have a positive amount and rate.

## Posting Engine

`AccountingPostingService` is the only writer of accounting entries. It resolves accounts, validates, numbers and persists. Validation before any write: at least two effective lines, debits equal credits within 0.00005, every account active and posting-allowed, positive amounts, and the source event not already posted.

`AccountingDocumentsService` turns each document into the journal the model prescribes, so no operational module invents its own debit/credit logic.

## Posting Model

One model, applied everywhere and never mixed — the subledger model §43 recommends:

| Event | Entry |
| --- | --- |
| Sale | Dr ذمم العملاء · Cr إيرادات المبيعات |
| Receipt voucher | Dr نقدية · Cr ذمم العملاء |
| Purchase | Dr المخزون والمشتريات · Cr ذمم الموردين |
| Payment voucher | Dr ذمم الموردين · Cr نقدية |
| Sales return | Dr مردودات المبيعات · Cr ذمم العملاء |
| Refund to customer | Dr ذمم العملاء · Cr نقدية |
| Purchase return | Dr ذمم الموردين · Cr المخزون |
| Cash back from supplier | Dr نقدية · Cr ذمم الموردين |
| Expense | Dr حساب المصروف · Cr نقدية |
| Cashbox transfer | Dr صندوق الوجهة · Cr صندوق المصدر |

**An invoice recognises revenue and the receivable; a voucher settles it.** A payment is therefore accounted exactly once, whichever document the user started from — this is what prevents the double-accounting §42 warns about.

Which control account a voucher settles is decided by the document it belongs to, and for a manual voucher by the partner's type — never by the direction of the cash. A customer keeps their whole relationship in Receivables and a supplier in Payables, whatever the sign, which is what lets the ledger reconcile partner by partner.

## Currency Strategy

USD is the reporting currency, matching every existing module. Each line stores its currency, original amount and the exchange rate used at the time alongside the USD value. A 1,300,000 SYP receipt at 6,500 is stored as exactly that plus its $200 accounting value. Historical journals are never revalued: a reversal copies the original line's rate.

Cross-currency transfers post both legs at the value that actually left the source box and keep the destination's own amount and currency on its line. **No foreign-exchange gain or loss is invented** — that remains an explicit boundary.

## Opening Balances

Opening balances are journals, never written-in numbers.

* **Partner** — `Dr ذمم العملاء · Cr الأرصدة الافتتاحية` for a customer (reversed for a credit balance), and the mirror for a supplier. Posted in the same transaction the partner is created, and by the backfill for partners that already existed, including archived ones whose balances are still part of the books.
* **Cashbox** — `Dr نقدية · Cr الأرصدة الافتتاحية`, posted when the cashbox is created.

Nothing is double counted: the operational outstanding calculation already treats the opening balance as its starting point, and the accounting side posts it once as its own identifiable entry.

## Inventory Opening Value Boundary

**Not posted, deliberately.** Inventory tracks quantity and weight but carries no reliable historical cost for stock that predates the system, so no opening inventory value was fabricated. The Inventory account therefore reflects only purchases and purchase returns recorded since Task 05. This is documented as a migration boundary.

## Gold and Scrap Boundary

Unchanged from Tasks 06 and 07: scrap gold is never forced into a cash account. A sale's revenue is recognised at its net economic value, with the exchange share already netted by the Task 06 rule, and the physical gold obligation remains an explicit settlement boundary awaiting the Gold Weight Accounts module.

## Reversals

Posted journals are immutable — there is no edit endpoint. A correction is always a new, opposite journal linked by `reversal_of_journal_id` / `reversed_by_journal_id`, and the original is retained and marked `reversed`.

Cancelling a sale, purchase or return reverses its own journal; the vouchers that settled it are offset by the compensating vouchers Task 07 already creates, each posting its own opposite journal. Verified end to end: a cancelled paid sale leaves **zero** residue on every account it touched.

## Manual Journals

Authorised users may post manual journals with a description and two or more balanced lines. They are held to identical rules — unbalanced, single-line, heading-account and both-sided entries are all rejected — and become immutable once posted, correctable only by reversal. Automatic journals cannot be reversed directly; their source document must be cancelled, which keeps accounting and operations in step.

## Permissions

`accounting.view`, `accounting.accounts.manage`, `accounting.journal.create`, `accounting.journal.post`, `accounting.journal.reverse`, granted to the administrator role, with `accounting.view` also to warehouse managers. A sales user is refused account and journal creation — verified.

## General Ledger

`GET /api/v1/accounting/general-ledger` filters by account, date range, warehouse, partner, source type and currency, with server pagination. Each row carries date, journal number, description, source document, debit, credit and a running balance, on top of a period opening balance computed from everything before the range. Warehouse scope is enforced.

## Trial Balance

Computed from journal lines for every posting account: opening balance for the period, period debit, period credit and closing balance, with totals and a `balanced` flag. Verified balanced locally over 43 accounts and in production.

## Backfill

`npm run db:backfill:accounting` — dry run by default, `--apply` to write. It enumerates every eligible source, reports the expected debit and credit before writing, and posts through the same services the live code uses, so there is one posting model rather than two. Idempotency comes from the unique `(source_type, source_id, posting_event)` index, so a second run posts nothing.

Production run: 5 journals created from 2 sales and 3 vouchers, total debit = total credit = **$7,818.00**. A repeat run created **0**.

## Duplicate Prevention

* A partial unique index on `(source_type, source_id, posting_event)` makes two journals for one source event structurally impossible.
* The posting service returns the existing entry instead of raising, so a retry is safe.
* Transfer vouchers are deliberately not posted individually — the transfer posts one balanced entry for both legs.
* Verified in production: **0 duplicate source postings**.

## Reconciliation

`GET /api/v1/accounting/reconciliation` compares accounting against the operational modules and reports rather than absorbs any gap:

* **Cash** — per cashbox, compared in the cashbox's own currency, because a SYP account holds USD at historical rates and would never equal a converted balance.
* **Receivables and payables** — compared signed and by partner type, the way the entries were posted. Any part of a control account that came from a manual journal is measured separately as `manualAdjustmentUSD`, leaving `unexplainedUSD`, which must be zero.

Known differences are stated in the response: cash compared in its own currency, inventory opening value not posted, and gold settlement outside cash.

**Building this reconciliation surfaced four real defects, all fixed:** a reversal voucher settled the wrong control account; a cancelled document kept its own entry in the partner subledger forever (a latent Task 07 bug that inflated partner balances); cancelling a manual voucher removed the same cash twice in accounting; and a partner's opening balance never reached the ledger unless the maintenance script ran.

## Automated Tests

`npm run test:accounting` (`backend/test/accounting-core.spec.ts`) — all pass:

* **journal core** — balanced accepted; unbalanced, single-line, heading-account and both-sided rejected; reversal created with the original retained; repeat reversal rejected;
* **sales** — credit sale, fully paid sale (invoice and receipt posted separately, payment accounted once), partial payment, manual receipt settlement;
* **purchases** — credit purchase, partial payment, later supplier payment;
* **returns** — sales return with cash refund, credit-only sales return (no cash entry), purchase return with cash recovered;
* **expenses** — posts to a category account under operating expenses;
* **transfers** — two cash legs only, no revenue or expense;
* **cancellation** — reversal journal, original retained, revenue back to its pre-sale value, and **zero residue on every account**;
* **currency** — USD and SYP with the historical rate preserved;
* **idempotency** — no duplicate source postings;
* **trial balance** — debits equal credits, checked after every phase including that each journal's lines sum to its header;
* **reconciliation** — cash equals cashbox, receivable and payable equal the operational subledger with no unexplained remainder;
* **security** — unauthenticated `401`, sales role `403`;
* **persistence** — a restart neither creates nor loses journals.

Tasks 01–07.1 suites (`test:integration`, `test:finance`, `test:task07`, `test:task071`) all still pass unchanged.

## Local Verification

`npm run test:task08` walks the required 27-step cycle on a live server; every step passed — chart and mappings, credit sale and its journal, receipt settlement with the customer balance agreeing in both ledgers, purchase and supplier payment, expense, sales and purchase returns, cashbox transfer, general ledger, trial balance balanced at $932,569.50, all 42 cashboxes reconciling with no unexplained receivable or payable remainder, and a restart leaving 828 journals with no duplicates.

**No browser automation was available, so no visual verification is claimed.** The frontend was verified by typecheck, production build, and by confirming the deployed bundle serves the accounting screens.

## Production Migration

* Commits `13668a0` and `d70a894` pushed and pulled on the VPS.
* `pg_dump` taken before the migration and retained.
* Migration `0009` applied as the PostgreSQL owner in a single transaction; the five new tables and four new enums assigned to the application role; **no application database permission was broadened**.
* Recorded in `drizzle.__drizzle_migrations` as row 10 with hash `0706ab49…b998b`, matching the file on disk. `drizzle-kit push` was not used.
* Backend and frontend rebuilt; only `hameed-hliwi-api` and `hameed-hliwi` restarted. `abooerp-backend`, `clotexerp-server` and `obada-server` untouched.

## Production Verification

| Check | Result |
| --- | --- |
| Frontend root | `200`, serving `index-DIpXMLTc.js` containing the accounting screens |
| Health API | `200`, `{"status":"ok","database":"ok"}` |
| Accounting routes unauthenticated | accounts, mappings, journals, general-ledger, trial-balance, reconciliation all `401` |
| Chart of accounts | 17 accounts with full hierarchy, all system keys resolved |
| Mappings | both real cashboxes mapped to `111001` and `112001` |
| Backfill | 5 journals from 2 sales and 3 vouchers; a second run created 0 |
| Journals | `INV-2026-001` $3,195 · `INV-2026-002` $1,113 · receipts `RCV-2026-001/002/003` — each source-linked |
| Unbalanced journals | **0** |
| Duplicate source postings | **0** |
| Trial balance | debit $7,818.00 = credit $7,818.00 |
| Cash reconciliation | USD $3,500.00 and SYP 132,000 — both **match** Finance exactly |
| Receivable reconciliation | accounting $798.00 = operational $798.00 — **match** |
| Payable reconciliation | accounting $0.00 = operational $0.00 — **match** |
| Existing modules | Sales, Purchases, Returns, Inventory, Partners, Finance all still `401` unauthenticated and operational |
| Backend logs | started cleanly; accounting requests served |

The figures are Nabil's real records: two sales totalling $4,308, three receipts totalling $3,510, leaving $798 receivable — reflected identically in the operational subledger and the general ledger.

## Remaining Accounting Boundaries

1. **Inventory opening value is not posted.** No reliable historical cost exists for pre-system stock, so none was fabricated. The Inventory account reflects only movements recorded since Task 05.
2. **No cost of goods sold.** The project has no cost model yet, so a sale recognises revenue and a receivable but does not relieve inventory at cost. Gross profit therefore cannot be read from these accounts yet.
3. **Gold and scrap settlement stays outside cash**, awaiting the Gold Weight Accounts module.
4. **No foreign-exchange gain or loss.** Cross-currency transfers post at the source value; the SYP cash account carries historical USD values, which is why cash reconciliation compares in the cashbox's own currency.
5. **Opening equity is a single account.** It absorbs partner and cashbox opening balances; a fuller equity structure belongs to a later task.
6. **Manual journals can touch control accounts.** This is legitimate but measured separately in reconciliation as `manualAdjustmentUSD` so it can never silently hide a real difference.
7. **Reports remain out of scope** — no Profit & Loss, Balance Sheet or Cash Flow was implemented, by instruction. They now have a stable core to build on.

## Scope Discipline

No Profit & Loss, Balance Sheet, Cash Flow, advanced reports or Gold Weight Accounts were implemented. Tasks 01–07.1 behaviour is preserved and their full test suites still pass.
