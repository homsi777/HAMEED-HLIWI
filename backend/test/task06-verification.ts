import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 06 operational verification. Drives a real server exactly like the browser does:
// clean returns, sell, return partially, exhaust the remainder, reject the excess, buy,
// return to the supplier, block an unsafe return, restart, and re-read every fact.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3003;
const base = `http://127.0.0.1:${port}/api/v1`;
const token = crypto.randomUUID().slice(0, 8);
const step = (message: string) => console.log(`  ✓ ${message}`);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
const api = (path: string, cookie: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await (await fetch(`${base}/auth/login-warehouses`)).json() as Array<{ id: string }>;
    const loginResponse = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: warehouses[0]!.id }) }) as ResponseWithCookies;
    assert.equal(loginResponse.status, 201);
    const cookie = jar(loginResponse);
    const warehouseId = warehouses[0]!.id;

    console.log('\n[1] Returns section starts clean for this verification run');
    const before = await json(await api('/returns?page=1&limit=1', cookie, 'GET'));
    step(`returns endpoint reachable, existing returns in this database: ${before.meta.total}`);

    console.log('\n[2] Create a clean sale');
    const customer = await json(await api('/partners', cookie, 'POST', { name: `Verify Customer ${token}`, type: 'customer' }));
    const supplier = await json(await api('/partners', cookie, 'POST', { name: `Verify Supplier ${token}`, type: 'supplier' }));
    const stock = await json(await api('/inventory', cookie, 'POST', { code: `V6-${token}-AGG`, name: `Verify aggregate ${token}`, category: 'ذهب كسر', karat: '21', inventoryMode: 'aggregate', quantity: '10.000', grossWeightGrams: '100.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));
    const sale = await json(await api('/sales', cookie, 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: stock.id, quantity: '10.000', soldWeightGrams: '100.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: '6500.0000', idempotencyKey: crypto.randomUUID() }));
    step(`sale ${sale.invoiceNumber} posted for $${sale.finalTotalUSD} (10 pieces / 100.000 g)`);

    console.log('\n[3] Create a partial sales return (3 pieces / 30.000 g)');
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`, cookie));
    const line = returnable.lines[0];
    assert.equal(line.remainingQuantity, 10); assert.equal(line.remainingNetWeightGrams, 100);
    const firstReturn = await json(await api('/returns', cookie, 'POST', { type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: 'Verification partial return', exchangeRateSypPerUsd: '6500.0000', items: [{ sourceLineId: line.sourceLineId, quantity: '3.000', netWeightGrams: '30.000' }], refundUSD: '3000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    assert.equal(firstReturn.finalTotalUSD, 3000); assert.equal(firstReturn.status, 'posted');
    step(`return ${firstReturn.invoiceNumber} posted for $${firstReturn.finalTotalUSD}, refunded $${firstReturn.paidUSD} cash`);

    console.log('\n[4] Verify restored inventory quantity and weight');
    const afterFirst = await json(await api(`/inventory/${stock.id}`, cookie));
    assert.equal(afterFirst.quantity, 3); assert.equal(afterFirst.netWeightGrams, 30);
    step(`aggregate stock restored to ${afterFirst.quantity} pieces / ${afterFirst.netWeightGrams.toFixed(3)} g`);

    console.log('\n[5] Return the remaining allowed amount (7 pieces / 70.000 g)');
    const remaining = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`, cookie));
    assert.equal(remaining.lines[0].remainingQuantity, 7); assert.equal(remaining.lines[0].remainingNetWeightGrams, 70);
    const secondReturn = await json(await api('/returns', cookie, 'POST', { type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: 'Verification remaining return', exchangeRateSypPerUsd: '6500.0000', items: [{ sourceLineId: line.sourceLineId, quantity: '7.000', netWeightGrams: '70.000' }], idempotencyKey: crypto.randomUUID() }));
    assert.equal(secondReturn.finalTotalUSD, 7000);
    const afterSecond = await json(await api(`/inventory/${stock.id}`, cookie));
    assert.equal(afterSecond.quantity, 10); assert.equal(afterSecond.netWeightGrams, 100);
    step(`return ${secondReturn.invoiceNumber} posted; stock back to ${afterSecond.quantity} pieces / ${afterSecond.netWeightGrams.toFixed(3)} g`);

    console.log('\n[6] Attempt an excess return and confirm rejection');
    const excess = await api('/returns', cookie, 'POST', { type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: 'Verification excess return', exchangeRateSypPerUsd: '6500.0000', items: [{ sourceLineId: line.sourceLineId, quantity: '1.000', netWeightGrams: '1.000' }], idempotencyKey: crypto.randomUUID() });
    assert.equal(excess.status, 409);
    step(`excess return rejected with 409: ${(await json(excess)).message}`);

    console.log('\n[7] Create a purchase');
    const purchase = await json(await api('/purchases', cookie, 'POST', { warehouseId, supplierId: supplier.id, items: [{ itemName: `Verify purchase ${token}`, code: `V6-${token}-PUR`, category: 'متنوع', karat: '21', quantity: '10.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '80.0000', laborFeeUSDPerGram: '0.0000' }], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: '6500.0000', idempotencyKey: crypto.randomUUID() }));
    const purchasedItemId = purchase.items[0].itemId;
    step(`purchase ${purchase.invoiceNumber} posted for $${purchase.finalTotalUSD}, received item created`);

    console.log('\n[8] Create a purchase return (4 pieces / 20.000 g)');
    const purchaseReturnable = await json(await api(`/returns/returnable?type=purchase_return&invoiceId=${purchase.id}`, cookie));
    const purchaseLine = purchaseReturnable.lines[0];
    const purchaseReturn = await json(await api('/returns', cookie, 'POST', { type: 'purchase_return', originalInvoiceId: purchase.id, partnerId: supplier.id, reason: 'Verification supplier return', exchangeRateSypPerUsd: '6500.0000', items: [{ sourceLineId: purchaseLine.sourceLineId, quantity: '4.000', netWeightGrams: '20.000' }], idempotencyKey: crypto.randomUUID() }));
    assert.equal(purchaseReturn.finalTotalUSD, 1600);
    step(`return ${purchaseReturn.invoiceNumber} posted for $${purchaseReturn.finalTotalUSD}, supplier payable reduced by $${purchaseReturn.outstandingAdjustmentUSD}`);

    console.log('\n[9] Verify inventory reduction');
    const afterPurchaseReturn = await json(await api(`/inventory/${purchasedItemId}`, cookie));
    assert.equal(afterPurchaseReturn.quantity, 6); assert.equal(afterPurchaseReturn.netWeightGrams, 30);
    step(`received stock reduced to ${afterPurchaseReturn.quantity} pieces / ${afterPurchaseReturn.netWeightGrams.toFixed(3)} g`);

    console.log('\n[10-11] Sell the remaining purchased stock, then attempt an unsafe purchase return');
    const resale = await json(await api('/sales', cookie, 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: purchasedItemId, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: '6500.0000', idempotencyKey: crypto.randomUUID() }));
    assert.equal(resale.status, 'posted');
    const unsafe = await api('/returns', cookie, 'POST', { type: 'purchase_return', originalInvoiceId: purchase.id, partnerId: supplier.id, reason: 'Verification unsafe return', exchangeRateSypPerUsd: '6500.0000', items: [{ sourceLineId: purchaseLine.sourceLineId, quantity: '6.000', netWeightGrams: '30.000' }], idempotencyKey: crypto.randomUUID() });
    assert.equal(unsafe.status, 409);
    step(`unsafe purchase return rejected with 409: ${(await json(unsafe)).message}`);
    const unsafeCancel = await api(`/returns/${purchaseReturn.id}/cancel`, cookie, 'POST', { reason: 'Verification late reversal' });
    assert.equal(unsafeCancel.status, 409);
    step(`cancelling the earlier purchase return after the resale rejected with 409: ${(await json(unsafeCancel)).message}`);

    console.log('\n[12-14] Restart the backend and confirm persistence');
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
    app = await createApp(); await app.listen({ port, host: '127.0.0.1' });
    const persisted = await json(await api(`/returns/${firstReturn.id}`, cookie));
    assert.equal(persisted.status, 'posted'); assert.equal(persisted.finalTotalUSD, 3000); assert.equal(persisted.items.length, 1);
    const persistedList = await json(await api(`/returns?originalInvoiceNumber=${encodeURIComponent(sale.invoiceNumber)}`, cookie));
    assert.equal(persistedList.items.length, 2);
    step(`after restart, return ${persisted.invoiceNumber} still reads $${persisted.finalTotalUSD} and both returns are listed`);

    console.log('\n[15] Verify print data comes from the backend document');
    for (const field of ['invoiceNumber', 'originalInvoiceNumber', 'customerOrSupplierName', 'warehouseId', 'reason', 'date', 'createdBy']) assert.ok(persisted[field] !== undefined && persisted[field] !== null, `${field} missing from the printable return document`);
    assert.ok(persisted.items.every((item: any) => item.itemName && item.quantity > 0 && item.netWeightGrams > 0 && item.totalPriceUSD >= 0));
    step(`print payload complete: ${persisted.invoiceNumber} / original ${persisted.originalInvoiceNumber} / ${persisted.items.length} line(s) / $${persisted.finalTotalUSD} / by ${persisted.createdBy}`);

    console.log('\n[16] Verify audit trail and inventory movement history');
    const auditRows = await sql`select action from audit_logs where entity_id in (${firstReturn.id}, ${secondReturn.id}, ${purchaseReturn.id}) and module = 'returns'`;
    assert.equal(auditRows.filter(row => row.action === 'returns.create').length, 3);
    const movementRows = await sql`select type from inventory_movements where return_invoice_id in (${firstReturn.id}, ${secondReturn.id}, ${purchaseReturn.id})`;
    assert.equal(movementRows.filter(row => row.type === 'sales_return').length, 2);
    assert.equal(movementRows.filter(row => row.type === 'purchase_return').length, 1);
    step(`audit rows: ${auditRows.length}, immutable return movements: ${movementRows.length}`);

    console.log('\nTask 06 local operational verification passed.\n');
  } finally {
    await sql.end();
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
