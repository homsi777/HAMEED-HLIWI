# TASK 17 — Operational Completion & Console Cleanup

**Hameed Hliwi Jewelry** · commits `b3d356b`, `bc36012`
**Status: PARTIAL — 2 of 4 areas shipped and verified. 1 area implemented then reverted on a
real finding. Deployed and verified on `https://hameed-hliwi.org/`, 15/15 live checks green.**

**No database migration.** TASK 16 Costing remains deferred. **Seller was not given Purchase
access.** Invoice templates untouched.

---

## 1. Seller `403` spam — fixed

**Root cause.** `InvoicesView` fetched customers, suppliers and operational stock
unconditionally on mount:

```ts
useEffect(() => { refreshCustomers(); refreshSuppliers(); refreshOperationalStock(); }, []);
```

A seller holds neither `suppliers.view` nor `inventory.view`, so two of those three always
returned `403`. Worse, the inventory failure ran `setPurchasesError(...)`, so a seller could be
shown a **purchase error banner on a screen they cannot even use** (§10).

**Fix.** The guard lives inside the fetchers themselves, so every call site is covered — not
just the mount effect — and `App` passes the **real permission codes** from the session rather
than the coarser module list, because selling is not the same capability as managing inventory
(§5, §7).

**Backend untouched (§4, §39).** Verified live: a seller is still refused `/inventory`,
`/partners?type=supplier`, `/purchases`, `/users` and `/finance/cashboxes` with `403`, while
still reading `/partners?type=customer` and `/sales` normally. The console is clean because the
app *stops asking*, not because the API opened.

## 2. Chart warnings — fixed

**Root cause.** The chart section's wrapper is `hidden grid-cols-1 gap-6 lg:grid-cols-3` — it
carries `hidden` with **no `lg:grid` to reveal it**. No user has ever seen these charts, yet
React still mounted Recharts into a `display:none` subtree, where it measured 0×0 and logged
`width(0) and height(0)` on every render.

**Fix.** Rendering is gated behind a flag the future dashboard task turns on. Visual behaviour is
unchanged — the section was invisible before and is invisible now (§26, §27). In the shipped
bundle the dead branch is eliminated entirely, so the chart code is no longer even downloaded.

## 3. Purchase counterparty — implemented, then reverted

This is the substantive finding, and §21 anticipated it exactly.

Allowing a `customer` partner as a purchase counterparty worked, and its nine-group suite
passed — but `accounting-core` then failed by **exactly the purchase value**. The cause is in
`accounting.service.ts`:

```ts
if (partner.type === 'supplier') operationalPayable += -net; else operationalReceivable += net;
```

**The reconciliation classifies a balance by the partner's role, not by the direction of the
balance.** Buying from a customer on credit posts to accounts **payable** in the GL while the
reconciliation still counts that partner as **receivable**, so the two stop agreeing.

I reverted it rather than ship a change that silently breaks AR/AP reconciliation. The reasoning
is recorded in `purchases.service.ts` at the guard itself.

**The correct fix is in the reconciliation, not in purchases:** classify by balance direction.
That would also correct `both` partners, who have this problem today. It is a Task 08 change and
belongs to its own task with its own verification.

Verified live: the customer counterparty is still refused, so the unshipped feature is genuinely
absent.

## 4. Authentication — no regression

The TASK 16A empty-body fix still holds on the browser path: `POST /auth/logout` with
`Content-Type: application/json` returns `201` on the live site.

## 5. Not done

* **§13–§24 purchase counterparty** — reverted, see §3 above.
* **§17 quick-person purchase** — not attempted. `purchase_invoices.supplier_partner_id` is a
  NOT NULL FK to `partners` and the finance subledger keys off `partner_id`, so a non-partner
  counterparty would break AP, the partner ledger, voucher allocation and purchase returns.
  §21 explicitly permits deferring this rather than forcing a dangerous shortcut.
* **Full regression sweep** — the local development database has accumulated test residue from
  this session, so `accounting-core`, `gold-accounts` and `task091` are currently unreliable
  *locally*. The suites that matter for what shipped were run and pass:
  `task16a-logout-browser-path`, `task10-authorization`, `finance-cycle`. Since the deployed
  backend is byte-identical to the previously verified release, this does not affect production.

## 6. Production verification — 15/15

Shipped bundle carries the permission-aware fetch; chart code eliminated · seller refused all
five protected endpoints, still reads customers and sales · General Manager still reads
inventory, suppliers and purchases · logout `201` on the browser path · customer counterparty
still refused · books identical before and after · trial balance balanced · temporary accounts
removed, leaving `admin`, `hameed`, `nabil`.

## 7. Remaining risks

1. **Console verification is mine only at the API level.** I confirmed the app no longer *makes*
   the forbidden requests; seeing an actually clean console on your phone is still worth doing.
2. **Sellers cannot sell from digitised stock.** Because a seller has no `inventory.view`, the
   stock picker has never loaded for them — they can only record manual sales. This predates
   this task and is unchanged by it, but it is worth an explicit decision: either a scoped
   sellable-stock lookup endpoint, or accepting manual-only selling.
3. **The reconciliation flaw is live today** for `both` partners, independently of this task.
