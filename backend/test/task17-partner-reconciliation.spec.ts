import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 17 §42–§45: partner balances must reconcile by the direction of the entries, not by
// the partner's master role.
//
// `accounting-documents.service.ts` always posts a sale to Receivables and a purchase to
// Payables, whoever the counterparty is. The reconciliation used to fold a partner's whole
// subledger into one account chosen by `partners.type`, so a partner active in both
// directions was compared against journals that had split the same money across two
// accounts. The two sides then disagreed by exactly the value of the purchase.
//
// A `both` partner is that defect in permanent form, so it is the case exercised here.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3017;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const round = (value: number) => Number(value.toFixed(4));

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

    // The dev database is shared and carries residue from earlier runs, so every assertion
    // below is a delta from a captured baseline rather than an absolute.
    const before = await json(await api('/accounting/reconciliation'));
    assert.equal(before.receivable.matches, true, `baseline receivable already mismatched: ${JSON.stringify(before.receivable)}`);
    assert.equal(before.payable.matches, true, `baseline payable already mismatched: ${JSON.stringify(before.payable)}`);
    step(`baseline reconciled — receivable $${before.receivable.accountingUSD}, payable $${before.payable.accountingUSD}`);

    // ---------------------------------------------------------------- §45 a `both` partner
    const partner = await ok(await api('/partners', 'POST', { name: `شريك اتجاهين ${token}`, type: 'both' }));
    assert.equal(partner.type, 'both');

    const code = `T17REC-${token}`;
    const purchase = await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: partner.id,
      items: [{ itemName: `صنف تسوية ${token}`, code, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const purchaseTotal = Number(purchase.finalTotalUSD ?? purchase.finalTotalUsd);
    assert.equal(purchaseTotal, 5000, `expected a $5000 purchase, got ${purchaseTotal}`);

    const [item] = await sql`select id from inventory_items where code = ${code} limit 1`;
    assert.ok(item, 'the purchase must have created the inventory item');

    const sale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: partner.id,
      items: [{ inventoryItemId: item.id, pricePerGramUSD: '120.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const saleTotal = Number(sale.finalTotalUSD ?? sale.finalTotalUsd);
    assert.ok(saleTotal > 0, 'the sale must have a value');
    step(`§45 partner "both": purchase on credit $${purchaseTotal}, sale on credit $${saleTotal}`);

    // ---------------------------------------------------------------- §43/§44 both sides agree
    const after = await json(await api('/accounting/reconciliation'));
    assert.equal(after.receivable.matches, true, `receivable mismatch: accounting ${after.receivable.accountingUSD} vs operational ${after.receivable.operationalUSD} (unexplained ${after.receivable.unexplainedUSD})`);
    assert.equal(after.payable.matches, true, `payable mismatch: accounting ${after.payable.accountingUSD} vs operational ${after.payable.operationalUSD} (unexplained ${after.payable.unexplainedUSD})`);

    const receivableDelta = round(after.receivable.operationalUSD - before.receivable.operationalUSD);
    const payableDelta = round(after.payable.operationalUSD - before.payable.operationalUSD);
    assert.equal(receivableDelta, round(saleTotal), `the sale must land in Receivables — expected +${saleTotal}, got ${receivableDelta}`);
    // This is the assertion the old code could never satisfy: it classified the whole of a
    // non-supplier partner into Receivables, so the payable side moved by exactly 0 here.
    assert.equal(payableDelta, round(purchaseTotal), `the purchase must land in Payables even though the partner is not a supplier — expected +${purchaseTotal}, got ${payableDelta} (0 is the old role-based behaviour)`);
    step(`§43 receivable +$${receivableDelta} and payable +$${payableDelta} — the same partner sits on both accounts at once`);

    const trial = await json(await api('/accounting/trial-balance'));
    assert.equal(trial.balanced, true, `trial balance broke: ${trial.totalDebitUSD} vs ${trial.totalCreditUSD}`);
    step(`§44 trial balance still balanced — debit $${trial.totalDebitUSD.toFixed(2)} = credit $${trial.totalCreditUSD.toFixed(2)}`);

    // ---------------------------------------------------------------- reversals classify too
    // Cancelling posts reversing entries that carry the original document links, which is
    // what lets the same rule classify them without following `reversal_of_entry_id`.
    //
    // The first purchase cannot be cancelled — its stock was consumed by the sale, and the
    // service refuses that as unsafe. That guard is correct, so the payable reversal is
    // proved on a second purchase whose item is never touched.
    await ok(await api(`/sales/${sale.id}/cancel`, 'POST', { reason: `تحقق ${token}` }));
    const spare = await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: partner.id,
      items: [{ itemName: `صنف عكس ${token}`, code: `T17REV-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    await ok(await api(`/purchases/${spare.id}/cancel`, 'POST', { reason: `تحقق ${token}` }));

    const restored = await json(await api('/accounting/reconciliation'));
    assert.equal(restored.receivable.matches, true, `receivable mismatch after cancellation: ${JSON.stringify(restored.receivable)}`);
    assert.equal(restored.payable.matches, true, `payable mismatch after cancellation: ${JSON.stringify(restored.payable)}`);
    assert.equal(round(restored.receivable.operationalUSD - before.receivable.operationalUSD), 0, 'cancelling the sale must return Receivables to the baseline');
    assert.equal(round(restored.payable.operationalUSD - before.payable.operationalUSD), round(purchaseTotal), 'the cancelled second purchase must net out, leaving only the outstanding first purchase in Payables');
    assert.equal((await json(await api('/accounting/trial-balance'))).balanced, true);
    step('reversals are classified by the same rule — the sale unwound to the baseline and the cancelled purchase netted out');

    // ---------------------------------------------------------------- §47 role is never rewritten
    const reloaded = await json(await api(`/partners/${partner.id}`));
    assert.equal(reloaded.type, 'both', 'trading in both directions must not rewrite the partner role');
    step('§47 the partner role was not mutated by the transactions');

    // ---------------------------------------------------------------- §46/§47 buy from a customer
    // A walk-in selling their old gold is a genuine purchase counterparty without being a
    // supplier. This is the workflow that was reverted before the classification was fixed.
    const walkIn = await ok(await api('/partners', 'POST', { name: `زبون يبيع ذهبه ${token}`, type: 'customer' }));
    assert.equal(walkIn.type, 'customer');
    const beforeWalkIn = await json(await api('/accounting/reconciliation'));

    const fromCustomer = await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: walkIn.id,
      items: [{ itemName: `ذهب مستعمل ${token}`, code: `T17CUS-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '30.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '1000.0000', paidSYP: '0', paymentMethod: 'mixed', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const customerPurchaseTotal = Number(fromCustomer.finalTotalUSD ?? fromCustomer.finalTotalUsd);
    assert.equal(customerPurchaseTotal, 3000, `expected a $3000 purchase, got ${customerPurchaseTotal}`);
    step(`§46 the manager bought $${customerPurchaseTotal} from a partner whose role is "customer", paying $1000 now`);

    // §47 is the guarantee that matters most here: the transaction records the counterparty,
    // the master role stays a decision only the manager makes.
    assert.equal((await json(await api(`/partners/${walkIn.id}`))).type, 'customer', 'a purchase must never silently convert a customer into a supplier');
    step('§47 the partner is still a customer after being bought from');

    const afterWalkIn = await json(await api('/accounting/reconciliation'));
    assert.equal(afterWalkIn.receivable.matches, true, `receivable mismatch after buying from a customer: ${JSON.stringify(afterWalkIn.receivable)}`);
    assert.equal(afterWalkIn.payable.matches, true, `payable mismatch after buying from a customer: ${JSON.stringify(afterWalkIn.payable)}`);
    // $3000 purchase less the $1000 paid at the counter leaves $2000 owed to a *customer*.
    assert.equal(round(afterWalkIn.payable.operationalUSD - beforeWalkIn.payable.operationalUSD), 2000, 'the unpaid remainder must sit in Payables');
    assert.equal(round(afterWalkIn.receivable.operationalUSD - beforeWalkIn.receivable.operationalUSD), 0, 'buying from a customer must not touch Receivables');
    step('§43 the $2000 remainder went to Payables and Receivables was untouched — this is the exact case that used to break reconciliation');

    const returnable = await json(await api(`/returns/returnable?type=purchase_return&invoiceId=${fromCustomer.id}`));
    const purchaseReturn = await ok(await api('/returns', 'POST', {
      type: 'purchase_return', originalInvoiceId: fromCustomer.id, partnerId: walkIn.id, reason: `رد ${token}`, exchangeRateSypPerUsd: RATE,
      items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '30.000' }],
      refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
    }));
    assert.ok(purchaseReturn.id, 'the purchase return must be accepted for a customer counterparty');

    const afterReturn = await json(await api('/accounting/reconciliation'));
    assert.equal(afterReturn.receivable.matches, true, `receivable mismatch after the purchase return: ${JSON.stringify(afterReturn.receivable)}`);
    assert.equal(afterReturn.payable.matches, true, `payable mismatch after the purchase return: ${JSON.stringify(afterReturn.payable)}`);
    assert.equal((await json(await api(`/partners/${walkIn.id}`))).type, 'customer', 'the return must not rewrite the role either');
    assert.equal((await json(await api('/accounting/trial-balance'))).balanced, true);
    step('§65 the purchase return posted, reconciliation held, the role stayed "customer" and the trial balance still balances');

    // ---------------------------------------------------------------- §21 the balance is derived
    // The management screen used to read `partners.opening_balance_usd`, which is zero for every
    // partner in production while their subledgers legitimately held $195 and $6,735. The API now
    // returns the opening figure plus the subledger, and the sign follows the ledger: a debit —
    // an unpaid sale — is positive and means the partner owes the shop.
    const owing = await ok(await api('/partners', 'POST', { name: `رصيد مشتق ${token}`, type: 'customer' }));
    assert.equal((await json(await api(`/partners/${owing.id}`))).balanceUSD, 0, 'a partner with no history is خالص');

    const stock = await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: partner.id,
      items: [{ itemName: `صنف رصيد ${token}`, code: `T17BAL-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', pricePerGramUSD: '50.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const [balanceItem] = await sql`select id from inventory_items where code = ${`T17BAL-${token}`} limit 1`;

    // §61: a $1,000 sale settled by $300 leaves $700 owed to the shop.
    await ok(await api('/sales', 'POST', {
      warehouseId, customerId: owing.id,
      items: [{ inventoryItemId: balanceItem.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '300.0000', paidSYP: '0', paymentMethod: 'mixed',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const owingDto = await json(await api(`/partners/${owing.id}`));
    assert.equal(owingDto.balanceUSD, 700, `§61 expected لنا عليه $700 from the subledger, got ${owingDto.balanceUSD}`);
    assert.equal(owingDto.openingBalanceUSD, 0, 'the stored opening column must still be zero — proving the balance is derived, not read from it');
    assert.ok(owingDto.lastActivityAt, '§29 the last activity date must be returned with the partner');
    step(`§21/§61 balance derived from the subledger: $${owingDto.balanceUSD} owed while the stored column is $${owingDto.openingBalanceUSD}`);

    // §29/§66: the list carries the same derived balance, so the screen needs no per-row request.
    const listed = await json(await api(`/partners?search=${encodeURIComponent(owing.name)}&page=1&limit=10`));
    const listedRow = listed.items.find((row: any) => row.id === owing.id);
    assert.ok(listedRow, 'the search must find the partner by name');
    assert.equal(listedRow.balanceUSD, 700, `the list must carry the derived balance too, got ${listedRow.balanceUSD}`);
    step('§66 the paginated list returns the derived balance in the page itself — no per-customer request');

    // ---------------------------------------------------------------- §31–§37 customer workspace
    const workspace = await json(await api(`/partners/${owing.id}/workspace`));
    assert.equal(workspace.partner.id, owing.id);
    assert.equal(workspace.financial.balanceUSD, 700, 'the workspace headline must be the subledger balance');
    assert.equal(workspace.sales.length, 1, 'the sale must appear in recent sales');
    assert.equal(workspace.sales[0].remainingUSD, 700, 'the outstanding remainder must be visible on the row');
    assert.ok(Array.isArray(workspace.vouchers) && workspace.vouchers.length >= 1, '§36 the automatic receipt for the $300 paid must be listed');
    assert.ok(workspace.movements.length >= 1, '§31 recent account movements must be present');
    // §32/§34: a workspace, not a report — nothing here may carry cost or profit.
    const serialised = JSON.stringify(workspace);
    for (const forbidden of ['cost', 'Cost', 'profit', 'Profit', 'margin', 'Margin']) {
      assert.ok(!serialised.includes(forbidden), `the workspace must not expose "${forbidden}"`);
    }
    step(`§31–§37 workspace: balance $${workspace.financial.balanceUSD}, ${workspace.sales.length} sale(s), ${workspace.vouchers.length} voucher(s), ${workspace.movements.length} movement(s), no cost or profit`);

    // §49: a seller must not be able to read a partner workspace they have no business seeing.
    assert.equal((await fetch(`${base}/partners/${owing.id}/workspace`)).status, 401, 'the workspace must refuse unauthenticated callers');
    step('§49 the workspace endpoint refuses unauthenticated callers');

    console.log('\nTASK 17 partner reconciliation suite passed.');
  } finally {
    await sql.end();
    await app.close();
  }
}

await main();
