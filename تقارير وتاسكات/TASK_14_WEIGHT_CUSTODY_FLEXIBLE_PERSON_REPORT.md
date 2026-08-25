# TASK 14 — Weight Custody / ذمم الأوزان: Flexible Person Assignment

**Hameed Hliwi Jewelry** · commit `4493d52` · migration `0017`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`, 33/33 production checks green.

---

## 1. Existing ذمم الأوزان audit

§3 required inspecting before designing, and the inspection answered the architecture question
in §56 rather than leaving it to assumption.

**Custody is not a separate module — it *is* the Task 09 gold ledger.** `ذمم الأوزان` reads
`gold_accounts` of `kind = 'partner'`, and the balance shown is derived from
`gold_ledger_entries` grouped per account and karat. Hand-out and receive are the gold module's
`payment` and `receipt` transactions.

**The Customer requirement was a database constraint, not a UI choice:**

```sql
check gold_accounts_scope_check:
  (kind = 'partner' AND partner_id IS NOT NULL)
  OR (kind = 'company' AND partner_id IS NULL)
```

A non-company gold account *had* to carry a `partner_id`. That is precisely why handing gold to
a polisher forced someone to create a commercial partner first.

**The finance and accounting boundaries already held.** `gold.service.ts` contains no reference
to vouchers, cash movements, journals or the accounting module — the gold ledger tracks metal
and nothing else. §36 and §37 therefore needed protecting, not building.

**Production custody records: zero.** No `kind='partner'` gold account existed, so §18 and §58
migration of partner-backed custody was a no-op. Nothing had to be remapped and nothing could
be lost.

## 2. Architecture decision

**Extend the existing model; do not build a second one.**

§56 warns against introducing a second gold posting model casually. Custody metal is the same
physical metal the gold ledger already tracks, with the same karat separation, the same derived
balances and the same locking. A parallel `weight_custody_movements` table would have been a
second version of the same truth, free to drift.

So only *who the counterparty may be* changed:

```
gold_accounts.kind:  partner  |  company  |  custody_person   ← new
```

with the constraint rewritten to admit exactly one of the three:

```sql
(kind='partner'        and partner_id is not null and custody_person_id is null)
or (kind='company'     and partner_id is null     and custody_person_id is null)
or (kind='custody_person' and custody_person_id is not null and partner_id is null)
```

The enum label is compared as text inside the constraint, because PostgreSQL refuses to resolve
an enum value added in the same transaction.

## 3. Person identity model

`weight_custody_people` — deliberately small:

| Field | Purpose |
|---|---|
| `display_name` / `normalized_name` | what was typed, and a trimmed/space-collapsed form for reuse |
| `phone` | optional (§24) |
| `note` | optional internal note (§25) |
| `partner_id` | **optional** identity reference only (§6) |
| `is_active` / `archived_at` | never hard-deleted |

No address, no tax number, no credit limit — custody has no commercial meaning, so it carries
no commercial fields.

## 4. Free-form person, and reuse without over-merging

Typing a name creates the person **and** the movement in one transaction, so a failed hand-out
never leaves an orphan identity (§47).

* **Reuse (§8, §53).** An identical normalized name resolves to the same person. Searching
  `أبو محمد` finds `أبو محمد الصائغ` for reuse.
* **No over-merging (§9).** `أبو محمد الصائغ` and `أبو محمد الصائغ الحلبي` are different
  strings and stay different people. Nothing is merged on similarity — only an exact match is
  treated as the same person, which is the honest reading of "the same name".

## 5. Existing partner linking

An existing partner may be chosen as an identity. The service reads the partner only for its
name and phone, **never for its role**, and never writes to it. Verified in production against a
real supplier: the hand-out was accepted and the partner was still `supplier` afterwards (§48,
§50).

## 6. No commercial pollution

This is the point of the task, so it is asserted from three directions:

* typing a name does not create a row in `partners` — the count is identical before and after;
* no partner exists by that name;
* the free person does not appear in the commercial gold ledger (`/gold/partners`), because
  that view filters `kind='partner'` and custody people are `kind='custody_person'` (§38, §49, §54).

## 7. Movements, balances and historical truth

Balances are derived from immutable ledger movements, never stored as an editable figure.
Per person **per karat**:

```
سلمنا له 26.510 · استلمنا منه 20.000 · المتبقي لنا 6.510
```

* **Karats never merge (§13, §52).** 21K = 15.000 g and 18K = 7.000 g are two rows, two
  obligations. There is no combined 22.000 g anywhere.
* **History is not rewritten (§17).** After returning 5.000 g against a 20.000 g hand-out, the
  original row still reads 20.000 and the return is a separate row.
* **Warehouse at transaction time (§20).** Each movement stamps the warehouse where the metal
  changed hands; the person themselves is not bound to a branch (§23).
* **Zero balance keeps the card (§29).** A fully returned custody is marked `مسدّدة` and keeps
  both movements.

## 8. Over-receipt, concurrency, idempotency

* **Over-receipt (§31).** The existing gold rule was inspected and **preserved**, not changed:
  receiving more than outstanding is refused with a message naming the real figure, unless the
  operator deliberately ticks *السماح باستلام أكثر من العهدة القائمة*. Negative custody remains
  possible only as an explicit choice.
* **Concurrency (§32).** The custody account row is `SELECT … FOR UPDATE` locked and the balance
  re-read inside the transaction, so two managers cannot both decide against a stale figure.
* **Idempotency (§33).** A retried hand-out returns the same movement; the balance does not
  double.

## 9. Authorization

Reuses Task 10's `AuthorizationScopeService` with the existing gold permissions — no new
permission was needed, because the existing ones already draw the line §21 asks for:

| Role | Custody |
|---|---|
| Seller | **none** — cannot read balances (`403`) and cannot record movements (`403`) |
| Warehouse Manager | full custody in assigned warehouses only |
| General Manager | global |

§22 was tested directly: a manager from another warehouse is refused a hand-out and sees an
empty movement list for a person whose activity happened elsewhere — the person record is
shared, the movements are scoped.

## 10. Finance, accounting and gold boundaries

Custody creates **no voucher, no cash movement, no receivable, no payable, no expense, no
revenue and no journal entry**. Verified by counting vouchers, cash movements, journal entries
and partner ledger entries before and after a full custody cycle: identical (§36, §37, §55).

The barter scrap holding from Task 13 was untouched throughout, and used-gold inventory was not
involved at all (§39). The commercial gold ledger stayed clean (§38).

## 11. UI

Inside `ذمم الأوزان`, above the existing content, without redesigning anything:

```
ذمم الأوزان — عهدة لدى أشخاص
[ تسليم وزن ]   [ استلام وزن ]

أبو محمد الصائغ                     عهدة قائمة
عيار 21                              6.750 غ
  سلمنا له 11.000   استلمنا منه 4.250
المتبقي لنا
```

The person picker is one field. Type two characters and it searches custody people **and**
partners of any role; if nothing matches, a single tap turns what was typed into the person:

```
+ استخدام «أبو حسن» كشخص جديد
```

No wizard, no navigation away, no Customer (§10, §11, §41).

**Mobile (390/430 px):** the form is a bottom sheet with a fixed header, its own scrolling body
and a sticky submit button; karat is a five-button row rather than a dropdown; numeric fields
use `inputMode="decimal"`. Cards stack one per row on a phone and become a grid from `sm`. No
horizontal scrolling, and no general UI cleanup was attempted (§42, §43).

The approved invoice template was not touched — no invoice file changed in this task (§45).

## 12. Tests

**`backend/test/task14-weight-custody.spec.ts`** — 15 assertion groups, all passing:

supplier-only partner accepted and left a supplier · 26.510 − 20.000 = 6.510 · typed person
created with partners table unchanged · 10.000 − 4.250 = 5.750 · partial search finds the person
and re-typing reuses them · a longer similar name stays separate · 21K = 15.000 and 18K = 7.000
reported apart · original hand-out preserved beside its return, with warehouse · over-receipt
refused · retried hand-out creates one movement · settled card kept with both movements · no
voucher/cash/journal/ledger entry · free people absent from the commercial gold ledger · seller
refused entirely · cross-warehouse manager sees nothing.

**Regression (§59):** Task 09 Gold, Task 09.1, Task 10 Authorization, Task 11 Shifts, Task 12
History, Task 13 Used Gold, Finance (Task 07), Accounting (Task 08), Task 07.1 — **all nine
passing.**

## 13. Migration and deployment

`pg_dump` backup → `backup_pre_task14_*.sql`. Migration `0017` adds `weight_custody_people`, the
`custody_person` enum value, `gold_accounts.custody_person_id`, and the relaxed scope
constraint. Applied as the PostgreSQL owner in a single transaction with `ON_ERROR_STOP=1`,
table ownership reassigned to `hameed_hliwi_app`, hash recorded in the Drizzle ledger (id 18).
**`drizzle-kit push` was not used.** Only `hameed-hliwi-api` and `hameed-hliwi` were restarted.

Immediately after migration: `partners = 9` (unchanged), `custody_people = 0`,
`partner_gold_accounts = 0` — deploying converted and invented nothing.

## 14. Production verification

**33 checks, 33 passed.** Against the live URL, using temporary custody data removed afterwards:

existing custody intact and nothing invented by deploying · a real **supplier** received
26.510 g and stayed a supplier · 6.510 g remaining · a typed name accepted immediately with
**partners still 9** and no partner by that name · 5.750 g remaining · partial search found the
person and re-typing reused them · 21K 6.750 g and 18K 7.000 g as two separate rows · original
10.000 g hand-out and 4.250 g return both preserved with their warehouse · over-receipt refused
and the balance survived · seller refused reading and writing · finance, accounting, trial
balance and the 9.100 g barter scrap all unchanged · custody people absent from the commercial
gold ledger.

Final state, matching the baseline exactly:

```
users admin, hameed · partners 9 · sales 5 · inventory 10
custody people 0 · gold accounts 2 · vouchers 4 · journals 9 · trial balance balanced
gold ledger net pure gold 0.000 · real 21K barter scrap 9.100 g
```

**One mistake, recorded rather than hidden.** My first cleanup script deleted only the custody
side of each double-entry movement and left the company side behind, which briefly left the
production gold ledger out of balance by −16.85 g of pure gold. I found it in the verification's
own final check, repaired it immediately by deleting both sides by transaction, corrected the
script, and re-ran the whole verification end to end for the clean 33/33 above. The ledger is
back to exactly 0.000 and no business record was affected — the error was confined to the
temporary custody rows the test itself created.

---

## 15. Remaining risks and notes for Nabil

1. **Visual check on your phone.** The panel and the person picker were built for 390/430 px but
   I have not seen them on your device.
2. **Custody is empty in production**, which is correct — nothing was invented. The first real
   hand-out will create the first person.
3. **Identical names are treated as the same person.** If you ever have two different craftsmen
   both called exactly `أبو محمد`, add a distinguishing word to the second. Anything less than
   an exact match already stays separate.
4. **Linking to a partner is one-way and optional.** It borrows the name; it never changes that
   partner's role, and it never turns a supplier into a customer.
5. **Over-receipt stays refused by default.** I preserved the existing rule rather than changing
   it, since §31 asked me to inspect first. The override checkbox is there when a real reverse
   balance is intended.
6. **Custody and commercial gold now share one ledger but never one view.** If you ever want a
   craftsman's custody and a supplier's commercial gold on the same screen, that is a reporting
   question for a later task — the data supports it and the two remain distinguishable by
   account kind.

**TASK 14 = CLOSED / PASSED.**
