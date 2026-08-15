# TASK 17 — Seller Purchase Invoices & Console Error Cleanup

**Hameed Hliwi Jewelry** · drafted from live production observation on 2026-08-15
**Status: SPECIFICATION — not started.**

TASK 16 Costing/COGS remains **deferred**. This task does not touch it.

---

## Background — the real business need

A seller does not only sell. Standing at the counter they also **buy gold from customers**:
someone walks in with old jewellery and sells it to the shop. Today a seller account cannot
create a purchase invoice at all, so that transaction cannot be recorded by the person actually
doing it.

TASK 10 deliberately gave the seller a sales-only role. That was correct for what was known
then; the counter reality is wider. This task widens it deliberately, without loosening the
isolation rules TASK 10 established.

---

# PART A — Seller purchase capability

## 1. Business goal

A seller must be able to create a **purchase invoice** for gold bought from a walk-in customer,
inside their own warehouse and their own shift, and see only their own purchases.

Selling behaviour is unchanged.

## 2. Current state (verified)

```
SELLER_PERMISSIONS = sales.view · sales.create · returns.view · returns.create
                     customers.view · customers.create · warehouses.view
                     shifts.view · shifts.open · shifts.close.request · data.scope.own
```

There is no `purchases.*`, no `suppliers.*` and no `inventory.view`. The purchase tab is hidden
by `canPurchase` (TASK 10), and the API would refuse the call anyway.

## 3. Permissions to add to the seller preset

At minimum:

* `purchases.view`
* `purchases.create`

And whatever the purchase flow genuinely requires — to be confirmed by inspection, not assumed:

* supplier/partner access, since a purchase needs a counterparty
* inventory visibility, since a purchase creates stock

**Do not grant more than the purchase flow needs.** In particular a seller must still not reach
finance, accounting, gold management, users or settings.

## 4. Buying from a customer, not a supplier

Inspect how `purchases.service.ts` resolves the counterparty. It currently requires a partner of
type `supplier` or `both`.

A walk-in customer selling their gold is **not** a supplier in the commercial sense. Decide and
document one of:

* allow a purchase counterparty of any active partner type; or
* let the seller create the person quickly, the way TASK 14 solved the same problem for weight
  custody.

**Do not silently convert a customer into a supplier.** TASK 10 §48 and TASK 14 §20 both
established that a partner's commercial role is never rewritten as a side effect.

## 5. Own-scope isolation must extend to purchases

This is mandatory and is the main risk in this task.

`purchases.service.ts` must receive the same treatment `sales.service.ts` got in TASK 10:

* list filtered by `ownerCondition` on `created_by_user_id`
* direct fetch by id refused for another seller's purchase
* cancellation refused
* purchase returns refused
* a client-supplied `sellerId` may narrow a manager's view, never widen a seller's

Seller A must not see Seller B's purchase by list, by search, or by direct id.

## 6. Shift integration

A seller's purchase should behave like their sale (TASK 11):

* require an open shift for an own-scope user
* refuse while the shift is `closing_requested`
* persist `shift_id` on the purchase
* appear on the shift timeline

Decide whether purchases affect shift **cash custody**: buying gold pays money *out*. If so,
expected custody must subtract it — otherwise the seller's drawer will never reconcile. Inspect
`shift-totals.service.ts` and state the decision explicitly.

## 7. Navigation

Once permitted, the purchase button and the purchase filter tab appear for the seller through the
existing `canPurchase` mechanism — no new UI wiring should be needed.

## 8. History

TASK 12 already supports purchases as a document type only for sales/sales-returns. Confirm
whether seller purchases should appear in سجل الفواتير, and if so extend the union — scoped by
the same ownership rule.

---

# PART B — Console cleanup

Three distinct causes were observed in production. They are unrelated to each other.

## 9. `403` on `/inventory?status=all` — real defect

`InvoicesView` calls `refreshOperationalStock()` unconditionally on mount:

```ts
useEffect(() => { void refreshCustomers(); void refreshSuppliers(); void refreshOperationalStock(); }, []);
```

A seller has no `inventory.view`, so this always fails with `403`. Worse, its `catch` sets
`purchasesError`, so a seller can be shown an error banner for a screen they are not meant to use.

**Fix:** fetch only what the session is permitted to fetch, driven by the modules already
returned by `/auth/me`. After PART A the seller may gain inventory access anyway, but the
conditional fetch is still correct and must not be skipped.

## 10. `403` on `/partners?type=supplier` — same cause

`refreshSuppliers()` is likewise unconditional. The seller holds `customers.view` but not
`suppliers.view`.

Same fix. Note PART A may change which of these the seller is allowed.

## 11. Chart warnings — cosmetic, separate

```
The width(0) and height(0) of chart should be greater than 0
```

`ResponsiveContainer` is used only in `DashboardView.tsx`. It renders inside a container that has
zero size at that moment. Harmless — no functional impact — but it floods the console and hides
real errors.

**Fix options:** give the chart container an explicit `minHeight`, or render the chart only once
its container has measurable size. Keep it to a small contained change; **Dashboard development
itself remains a later task.**

## 12. `401` on `/auth/me` and `/auth/refresh` — not an error

These occur before login, while the app is deciding whether a session exists. They are the
correct answer to "is anyone logged in?" and should be left alone. They may optionally be made
quieter, but must not be suppressed in a way that hides genuine auth failures.

---

# Testing

## 13. Seller purchase tests

* seller with an open shift creates a purchase → accepted, stock created, `shift_id` persisted
* seller without an open shift → refused with the business message
* seller during `closing_requested` → refused
* purchase counterparty who is a customer → accepted, and the partner's type is **unchanged**
* Seller A cannot see Seller B's purchase by list, search, direct id, cancel, or return
* branch manager sees both sellers' purchases in the warehouse; another warehouse is refused
* General Manager sees all

## 14. Console tests

* a seller session issues **no** request that returns `403`
* an authorized manager still loads inventory and suppliers normally
* the dashboard renders without chart warnings

## 15. Regression

TASK 07 Finance · TASK 08 Accounting · TASK 09 Gold · TASK 09.1 · TASK 10 Authorization ·
TASK 11 Shifts · TASK 12 History · TASK 13 Used Gold · TASK 14 Weight Custody · TASK 15 ·
TASK 16A logout browser path.

Particular attention: the TASK 10 suite asserts the seller's exact module list and will need an
honest update once purchases are added — the isolation guarantees themselves must not weaken.

---

# Constraints

* The approved Sales/Purchase invoice template stays visually unchanged.
* TASK 16 Costing stays deferred.
* Existing production data is not modified for acceptance; temporary records are removed.
* Backup before any migration; no `drizzle-kit push`.
* Restart only `hameed-hliwi-api` and `hameed-hliwi`.

# Final acceptance

A seller can record a gold purchase from a walk-in customer, inside their own shift and
warehouse, and sees only their own purchases. A seller session produces no `403` in the console.
The chart warnings are gone. Every TASK 10 isolation guarantee still holds.
