import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Task 12: permanent invoice history and sold-weight history.
//
// Both screens are derived reads over the snapshots the sale already persists, so the tests
// assert two things above all: the numbers match the documents exactly, and the Task 10/11
// scope rules still refuse everything they refused before.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3012;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);
const SECRET = 'Passw0rd!Task12';

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
const json = async (response: Response) => response.json() as Promise<any>;
const step = (message: string) => console.log(`  ✓ ${message}`);

let adminCookie = '';
const api = (path: string, method = 'GET', body?: unknown, auth = adminCookie) =>
  fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected} but got ${response.status}: ${JSON.stringify(body)}`); return body; };
const status = async (response: Response) => { const value = response.status; await response.text().catch(() => undefined); return value; };
const login = async (username: string, warehouseId: string) => {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: SECRET, warehouseId }) }) as ResponseWithCookies;
  assert.equal(response.status, 201, `login failed for ${username}: ${await response.text()}`);
  return jar(response);
};
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.005, `${label}: expected ${expected} but got ${actual}`);
const karat = (summary: any, value: string) => summary.byKarat.find((row: any) => row.karat === value);

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    const loginWarehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const furqanId = loginWarehouses[0].id;
    const otherId = loginWarehouses.find((row: any) => row.id !== furqanId)!.id;
    const adminLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: furqanId }) }) as ResponseWithCookies;
    adminCookie = jar(adminLogin);
    const customer = await ok(await api('/partners', 'POST', { name: `عميل سجل ${token}`, type: 'customer', phone: `07${token.replace(/\D/g, '').padEnd(8, '3').slice(0, 8)}` }));

    // ---------------------------------------------------------------- §63 cast
    const createUser = async (suffix: string, fullName: string, roleName: string, warehouseIds: string[]) =>
      ok(await api('/users', 'POST', { username: `t12_${suffix}_${token}`, fullName, password: SECRET, roleName, warehouseIds }));
    const gm = await createUser('gm', 'GM History', 'general_manager', []);
    const manager = await createUser('mgr', 'Manager Furqan', 'warehouse_manager', [furqanId]);
    const sellerA = await createUser('a', 'Seller A', 'sales', [furqanId]);
    const sellerB = await createUser('b', 'Seller B', 'sales', [furqanId]);
    const gmCookie = await login(`t12_gm_${token}`, furqanId);
    const managerCookie = await login(`t12_mgr_${token}`, furqanId);
    const cookieA = await login(`t12_a_${token}`, furqanId);
    const cookieB = await login(`t12_b_${token}`, furqanId);
    const shiftA = await ok(await api('/shifts', 'POST', { openingCustodyUSD: '0', openingCustodySYP: '0', idempotencyKey: crypto.randomUUID() }, cookieA));
    await ok(await api('/shifts', 'POST', { openingCustodyUSD: '0', openingCustodySYP: '0', idempotencyKey: crypto.randomUUID() }, cookieB));
    step('§63 general manager, branch manager and two sellers with open shifts');

    // ---------------------------------------------------------------- §60 sale under test
    // One invoice, three lines: 21K stock 12.000 g · 21K manual 8.250 g · 18K 2 pieces 5.000 g.
    const stock = await ok(await api('/inventory', 'POST', { code: `T12-${token}`, name: 'اسوارة برم حلبية', category: 'أساور ومبارم', karat: '21', grossWeightGrams: '12.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId: furqanId }));
    // An aggregate 18K holding of 400 g: the sale takes 2 pieces weighing 5.000 g from it, so
    // sold-weight history must report 5.000 g and never the holding's full weight (§23).
    const bulk = await ok(await api('/inventory', 'POST', { code: `T12B-${token}`, name: 'أقراط سائبة', category: 'أقراط', karat: '18', inventoryMode: 'aggregate', grossWeightGrams: '400.000', stoneWeightGrams: '0.000', quantity: '80', laborFeeUSDPerGram: '0.0000', warehouseId: furqanId }));
    const saleA = await ok(await api('/sales', 'POST', {
      warehouseId: furqanId, customerId: customer.id,
      items: [
        { inventoryItemId: stock.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
        { itemName: 'خاتم تاريخي', category: 'خواتم ومحابس', karat: '21', grossWeightGrams: '8.250', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
        { inventoryItemId: bulk.id, soldWeightGrams: '5.000', quantity: '2', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
      ],
      scrapGoldItems: [{ karat: '21', weightGrams: '9.100', pricePerGramUSD: '1.0000' }],
      discountUSD: '0', paidUSD: '500.0000', paidSYP: '0', paymentMethod: 'cash_usd', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, cookieA));
    const saleB = await ok(await api('/sales', 'POST', {
      warehouseId: furqanId, customerId: customer.id,
      items: [{ itemName: 'سلسلة', category: 'قلائد وسلاسل', karat: '21', grossWeightGrams: '4.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '400.0000', paidSYP: '0', paymentMethod: 'cash_usd', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, cookieB));
    step(`§60 Seller A posted ${saleA.invoiceNumber} (3 lines), Seller B posted ${saleB.invoiceNumber}`);

    // ---------------------------------------------------------------- §59 invoice history
    const historyA = await ok(await api('/history/invoices?limit=100', 'GET', undefined, cookieA), 200);
    assert.ok(historyA.items.some((row: any) => row.id === saleA.id));
    assert.ok(!historyA.items.some((row: any) => row.id === saleB.id), 'Seller A must not see Seller B in history.');
    step('§14/§59 invoice history is scoped to the seller');

    const exact = await ok(await api(`/history/invoices?invoiceNumber=${saleA.invoiceNumber}`, 'GET', undefined, cookieA), 200);
    assert.equal(exact.items.length, 1);
    assert.equal(exact.items[0].invoiceNumber, saleA.invoiceNumber);
    assert.equal(exact.items[0].shiftNumber, shiftA.shiftNumber, '§9 the shift number travels with the invoice.');
    assert.equal(exact.items[0].paymentState, 'partial', 'Paid 500 of 2525 is partial.');
    assert.equal(exact.items[0].lineCount, 3);
    assert.equal(exact.items[0].manualLineCount, 1);
    step('§10/§13 exact number search, derived payment state and line composition');

    // §50 — a seller cannot discover a colleague's invoice by its exact number.
    const leak = await ok(await api(`/history/invoices?invoiceNumber=${saleB.invoiceNumber}`, 'GET', undefined, cookieA), 200);
    assert.equal(leak.items.length, 0);
    assert.equal(leak.meta.total, 0, 'The total must not leak a hidden row either.');
    const spoof = await ok(await api(`/history/invoices?sellerId=${sellerB.id}&limit=100`, 'GET', undefined, cookieA), 200);
    assert.ok(!spoof.items.some((row: any) => row.id === saleB.id), 'A forged sellerId must not widen an own-scope view.');
    step('§50 no leak by exact number, by count, or by a forged sellerId');

    // ---------------------------------------------------------------- §54 pre-shift invoices
    const gmHistory = await ok(await api('/history/invoices?limit=100', 'GET', undefined, gmCookie), 200);
    assert.ok(gmHistory.items.some((row: any) => row.shiftId === null), '§11/§54 invoices from before the shifts module must still appear.');
    assert.ok(gmHistory.items.some((row: any) => row.id === saleA.id) && gmHistory.items.some((row: any) => row.id === saleB.id));
    step('§54 pre-shift invoices appear with no shift, alongside current ones');

    const managerHistory = await ok(await api('/history/invoices?limit=100', 'GET', undefined, managerCookie), 200);
    assert.ok(managerHistory.items.some((row: any) => row.id === saleA.id) && managerHistory.items.some((row: any) => row.id === saleB.id));
    assert.equal(await status(await api(`/history/invoices?warehouseId=${otherId}`, 'GET', undefined, managerCookie)), 403);
    assert.equal(await status(await api(`/history/invoices?warehouseId=${otherId}`, 'GET', undefined, gmCookie)), 200);
    step('§14 manager sees both sellers in the warehouse and is refused outside it; GM is global');

    // ---------------------------------------------------------------- §12 filters and §17 paging
    const byShift = await ok(await api(`/history/invoices?shiftId=${shiftA.id}&limit=100`, 'GET', undefined, managerCookie), 200);
    assert.deepEqual(byShift.items.map((row: any) => row.id), [saleA.id], '§15/§64 shift filter returns exactly that shift.');
    const byCustomer = await ok(await api(`/history/invoices?customerId=${customer.id}&limit=100`, 'GET', undefined, gmCookie), 200);
    assert.ok(byCustomer.items.length >= 2);
    const paged = await ok(await api('/history/invoices?limit=1&page=1', 'GET', undefined, gmCookie), 200);
    assert.equal(paged.items.length, 1);
    assert.ok(paged.meta.total > 1, 'Pagination reports the real total, not the page size.');
    const future = await ok(await api('/history/invoices?dateFrom=2099-01-01', 'GET', undefined, gmCookie), 200);
    assert.equal(future.items.length, 0);
    step('§12/§17 shift, customer, date and pagination filters all compose server-side');

    // ---------------------------------------------------------------- §60 sold weight history
    const weightsA = await ok(await api('/history/sold-weights?limit=100', 'GET', undefined, cookieA), 200);
    const mine = weightsA.items.filter((row: any) => row.invoiceId === saleA.id);
    assert.equal(mine.length, 3, 'One row per sold line.');
    const stockLine = mine.find((row: any) => row.source === 'stock');
    const manualLine = mine.find((row: any) => row.itemName === 'خاتم تاريخي');
    assert.equal(stockLine.itemName, 'اسوارة برم حلبية', '§6 the line carries the item name snapshot.');
    assert.equal(stockLine.itemCode, `T12-${token}`);
    near(stockLine.netWeightGrams, 12, 'stock line weight');
    assert.equal(manualLine.source, 'manual', '§22 a manual sale is marked, not treated as an error.');
    const bulkLine = mine.find((row: any) => row.karat === '18');
    near(bulkLine.netWeightGrams, 5, '§23 the aggregate line reports the sold weight, not the 400 g holding');
    near(bulkLine.quantity, 2, '§20 quantity and weight are both preserved');
    assert.equal(mine.every((row: any) => row.shiftNumber === shiftA.shiftNumber), true);
    step('§20/§21/§22 one row per sold line with snapshot name, code, karat, source and shift');

    const summaryA = await ok(await api('/history/sold-weights/summary', 'GET', undefined, cookieA), 200);
    near(karat(summaryA, '21').soldWeightGrams, 20.25, '21K sold');
    near(karat(summaryA, '18').soldWeightGrams, 5, '18K sold');
    near(summaryA.pieceCount, 4, 'piece count');
    assert.equal(summaryA.byKarat.length, 2, '§28 karats are reported separately, never merged.');
    step('§28/§31 summary over the whole filtered set: 21K = 20.250 g, 18K = 5.000 g, 4 pieces');

    // §4/§40 — scrap received is not sold jewellery and must never enter this total.
    assert.ok(!summaryA.byKarat.some((row: any) => Math.abs(row.soldWeightGrams - 29.35) < 0.005), 'Scrap must not be added to sold weight.');
    step('§4/§40 the 9.100 g of scrap taken in is absent from sold weight');

    // ---------------------------------------------------------------- §61 returns
    // The aggregate 18K line supports a partial return; an individual piece must come back whole.
    const returnable = await ok(await api(`/returns/returnable?type=sales_return&invoiceId=${saleA.id}`, 'GET', undefined, cookieA), 200);
    const bulkSource = returnable.lines.find((line: any) => line.karat === '18');
    await ok(await api('/returns', 'POST', {
      type: 'sales_return', originalInvoiceId: saleA.id, reason: 'إرجاع جزئي للاختبار',
      items: [{ sourceLineId: bulkSource.sourceLineId, quantity: 1, netWeightGrams: 2 }],
      refundUSD: '0', refundSYP: '0', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, cookieA));

    const afterReturn = await ok(await api(`/history/sold-weights?invoiceNumber=${saleA.invoiceNumber}&limit=100`, 'GET', undefined, cookieA), 200);
    const returnedLine = afterReturn.items.find((row: any) => row.karat === '18');
    near(returnedLine.netWeightGrams, 5, '§61 the original sold weight is preserved');
    near(returnedLine.returnedWeightGrams, 2, 'returned weight is reported beside it');
    near(returnedLine.netAfterReturnsGrams, 3, 'net after returns');
    step('§25/§61 the original 5.000 g is untouched; returned 2.000 g and net 3.000 g shown beside it');

    const summaryAfterReturn = await ok(await api('/history/sold-weights/summary', 'GET', undefined, cookieA), 200);
    near(karat(summaryAfterReturn, '18').soldWeightGrams, 5, 'sold stays 5.000');
    near(karat(summaryAfterReturn, '18').returnedWeightGrams, 2, 'returned 2.000');
    near(karat(summaryAfterReturn, '18').netWeightGrams, 3, 'net 3.000');
    near(karat(summaryAfterReturn, '21').soldWeightGrams, 20.25, '21K is untouched by an 18K return');
    near(karat(summaryAfterReturn, '21').netWeightGrams, 20.25, '21K net unchanged');
    step('§26/§28 partial return keeps 18K sold 5.000 / returned 2.000 / net 3.000, and 21K untouched');

    // ---------------------------------------------------------------- §8 returns in invoice history
    const withReturns = await ok(await api('/history/invoices?type=all&limit=100', 'GET', undefined, cookieA), 200);
    assert.ok(withReturns.items.some((row: any) => row.type === 'sales_return'), '§8 sales returns appear as a document type.');
    const onlyReturns = await ok(await api('/history/invoices?type=sales_return&limit=100', 'GET', undefined, cookieA), 200);
    assert.ok(onlyReturns.items.length > 0 && onlyReturns.items.every((row: any) => row.type === 'sales_return'));
    step('§8 invoice history covers sales and sales returns as filterable document types');

    // ---------------------------------------------------------------- §62 cancellation
    const doomed = await ok(await api('/sales', 'POST', {
      warehouseId: furqanId, customerId: customer.id,
      items: [{ itemName: 'قطعة ملغاة', category: 'خواتم ومحابس', karat: '14', grossWeightGrams: '3.000', stoneWeightGrams: '0.000', pricePerGramUSD: '50.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, cookieA));
    const beforeCancel = await ok(await api('/history/sold-weights/summary?karat=14', 'GET', undefined, cookieA), 200);
    near(karat(beforeCancel, '14').netWeightGrams, 3, '14K net before cancelling');
    // A seller holds no sales.cancel permission, so the branch manager cancels it.
    await ok(await api(`/sales/${doomed.id}/cancel`, 'POST', { reason: 'اختبار الإلغاء' }, managerCookie));

    const afterCancel = await ok(await api('/history/sold-weights/summary?karat=14', 'GET', undefined, cookieA), 200);
    near(karat(afterCancel, '14').soldWeightGrams, 3, 'the cancelled line remains visible');
    near(karat(afterCancel, '14').netWeightGrams, 0, 'but contributes nothing to net sold weight');
    const cancelledRow = (await ok(await api(`/history/invoices?invoiceNumber=${doomed.invoiceNumber}`, 'GET', undefined, cookieA), 200)).items[0];
    assert.equal(cancelledRow.status, 'cancelled');
    assert.equal(cancelledRow.paymentState, 'cancelled');
    step('§27/§62 a cancelled sale stays in history, labelled, and counts zero toward net sold weight');

    // ---------------------------------------------------------------- §64 shift drill-down
    const shiftDetail = await ok(await api(`/shifts/${shiftA.id}`, 'GET', undefined, managerCookie), 200);
    const shiftWeights = await ok(await api(`/history/sold-weights/summary?shiftId=${shiftA.id}`, 'GET', undefined, managerCookie), 200);
    const shiftSold21 = shiftDetail.totals.soldWeightByKarat.find((row: any) => row.karat === '21');
    near(karat(shiftWeights, '21').soldWeightGrams, shiftSold21.weightGrams, '§64 drill-down matches the shift total exactly');
    step(`§64 sold weight filtered to the shift matches TASK 11 shift totals (21K = ${shiftSold21.weightGrams} g)`);

    // ---------------------------------------------------------------- §33 filter options
    const sellerFilters = await ok(await api('/history/filters', 'GET', undefined, cookieA), 200);
    assert.equal(sellerFilters.canFilterBySeller, false, '§33 an own-only seller gets no seller selector.');
    assert.equal(sellerFilters.sellers.length, 0);
    const managerFilters = await ok(await api('/history/filters', 'GET', undefined, managerCookie), 200);
    assert.equal(managerFilters.canFilterBySeller, true);
    assert.ok(managerFilters.sellers.some((row: any) => row.id === sellerA.id));
    assert.ok(!managerFilters.warehouses.some((row: any) => row.id === otherId), '§34 a manager sees only assigned warehouses.');
    step('§33/§34 seller selector is hidden from sellers and warehouse choices follow scope');

    // ---------------------------------------------------------------- §32 weight isolation
    const weightsB = await ok(await api('/history/sold-weights?limit=100', 'GET', undefined, cookieB), 200);
    assert.ok(!weightsB.items.some((row: any) => row.invoiceId === saleA.id), 'Seller B must not see Seller A sold lines.');
    const managerWeights = await ok(await api('/history/sold-weights?limit=100', 'GET', undefined, managerCookie), 200);
    assert.ok(managerWeights.items.some((row: any) => row.invoiceId === saleA.id) && managerWeights.items.some((row: any) => row.invoiceId === saleB.id));
    const bySeller = await ok(await api(`/history/sold-weights?sellerId=${sellerA.id}&limit=100`, 'GET', undefined, managerCookie), 200);
    assert.ok(bySeller.items.every((row: any) => row.sellerId === sellerA.id));
    step('§32/§33 sold-weight isolation holds, and a manager can filter by seller');

    // ---------------------------------------------------------------- §55 no double counting
    const manualRows = (await ok(await api(`/history/sold-weights?invoiceNumber=${saleA.invoiceNumber}&source=manual&limit=100`, 'GET', undefined, cookieA), 200)).items;
    assert.equal(manualRows.length, 1, '§55 a manual sale is counted once from the sales line, never again from its negative inventory record.');
    step('§55 manual historical sales are counted once, from the commercial document');

    console.log('\nTASK 12 history suite passed.');
  } finally {
    await app.close();
  }
}

await main();
