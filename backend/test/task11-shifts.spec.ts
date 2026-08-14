import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Task 11: shifts, seller accountability and live manager monitoring.
//
// The scenario is the real operating model: two sellers at one counter, a branch manager
// watching them, and a General Manager above both. Every rule is asserted through the HTTP
// API, because the requirement is that the server refuses.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3011;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);
const SECRET = 'Passw0rd!Task11';

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

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    const loginWarehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const furqanId = loginWarehouses[0].id;
    const otherId = loginWarehouses.find((row: any) => row.id !== furqanId)!.id;
    const adminLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: furqanId }) }) as ResponseWithCookies;
    adminCookie = jar(adminLogin);
    const customer = await ok(await api('/partners', 'POST', { name: `عميل ورديات ${token}`, type: 'customer', phone: `08${token.replace(/\D/g, '').padEnd(8, '5').slice(0, 8)}` }));

    const createUser = async (suffix: string, fullName: string, roleName: string, warehouseIds: string[]) =>
      ok(await api('/users', 'POST', { username: `t11_${suffix}_${token}`, fullName, password: SECRET, roleName, warehouseIds }));
    const gm = await createUser('gm', 'GM Shifts', 'general_manager', []);
    const manager = await createUser('mgr', 'Manager Furqan', 'warehouse_manager', [furqanId]);
    const sellerA = await createUser('a', 'Seller A', 'sales', [furqanId]);
    const sellerB = await createUser('b', 'Seller B', 'sales', [furqanId]);
    const gmCookie = await login(`t11_gm_${token}`, furqanId);
    const managerCookie = await login(`t11_mgr_${token}`, furqanId);
    const cookieA = await login(`t11_a_${token}`, furqanId);
    const cookieB = await login(`t11_b_${token}`, furqanId);
    step('§36 general manager, branch manager and two sellers created');

    const sell = (auth: string, note: string, price: string, karat: string, grams: string, paidUSD = '0', paidSYP = '0', method = 'debt', scrap: any[] = []) =>
      api('/sales', 'POST', {
        warehouseId: furqanId, customerId: customer.id,
        items: [{ itemName: `قطعة ${note}`, category: 'خواتم ومحابس', karat, grossWeightGrams: grams, stoneWeightGrams: '0.000', pricePerGramUSD: price, laborFeeUSDPerGram: '0.0000' }],
        scrapGoldItems: scrap, discountUSD: '0', paidUSD, paidSYP, paymentMethod: method, exchangeRateSypPerUsd: RATE, notes: note, idempotencyKey: crypto.randomUUID(),
      }, auth);

    // ---------------------------------------------------------------- §14 no shift, no sale
    const refused = await api('/sales', 'POST', {
      warehouseId: furqanId, customerId: customer.id,
      items: [{ itemName: 'بلا وردية', category: 'خواتم ومحابس', karat: '21', grossWeightGrams: '1.000', stoneWeightGrams: '0.000', pricePerGramUSD: '10.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, cookieA);
    const refusedBody = await json(refused);
    assert.equal(refused.status, 409);
    assert.match(refusedBody.message, /يجب فتح وردية قبل إنشاء فاتورة بيع/);
    step('§14 a seller with no open shift cannot post a sale');

    // The General Manager is not forced into a shift.
    const gmSale = await ok(await sell(gmCookie, `GM-${token}`, '50.0000', '21', '2.000'));
    assert.ok(gmSale.id);
    step('§14 the general manager sells without a shift');

    // ---------------------------------------------------------------- §11-12 opening
    const shiftA = await ok(await api('/shifts', 'POST', { openingCustodyUSD: '500.0000', openingCustodySYP: '2000000.00', idempotencyKey: crypto.randomUUID() }, cookieA));
    assert.equal(shiftA.status, 'open');
    assert.equal(shiftA.warehouseId, furqanId, '§10 the shift warehouse comes from the seller scope.');
    assert.equal(shiftA.openingCustodyUSD, 500);
    assert.equal(shiftA.openingCustodySYP, 2000000);
    step(`§11/§12 Seller A opened shift ${shiftA.shiftNumber} with custody 500 USD / 2,000,000 SYP`);

    // ---------------------------------------------------------------- §9 one live shift
    assert.equal(await status(await api('/shifts', 'POST', { openingCustodyUSD: '0', openingCustodySYP: '0', idempotencyKey: crypto.randomUUID() }, cookieA)), 409);
    step('§9 a second open shift for the same seller is refused with 409');

    // §48 idempotency: the same key returns the same shift, never a second one.
    const key = crypto.randomUUID();
    const shiftB = await ok(await api('/shifts', 'POST', { openingCustodyUSD: '100.0000', openingCustodySYP: '0', idempotencyKey: key }, cookieB));
    const shiftBAgain = await ok(await api('/shifts', 'POST', { openingCustodyUSD: '100.0000', openingCustodySYP: '0', idempotencyKey: key }, cookieB));
    assert.equal(shiftB.id, shiftBAgain.id, 'A retried open must return the same shift.');
    step('§48 a retried shift opening returns the same shift');

    // ---------------------------------------------------------------- §15 sales link to shift
    // Seller A: 21K 12.000g @ 100 = 1200 paid cash 1000; 21K 8.250g @ 100 = 825 on credit;
    // 18K 5.000g @ 100 = 500 paid 2,000,000 SYP; plus scrap 9.100g 21K on the first sale.
    const saleA1 = await ok(await sell(cookieA, `A1-${token}`, '100.0000', '21', '12.000', '1000.0000', '0', 'cash_usd', [{ karat: '21', weightGrams: '9.100', pricePerGramUSD: '0.0000' }]));
    const saleA2 = await ok(await sell(cookieA, `A2-${token}`, '100.0000', '21', '8.250'));
    const saleA3 = await ok(await sell(cookieA, `A3-${token}`, '100.0000', '18', '5.000', '0', '2000000.00', 'cash_syp'));
    const saleB1 = await ok(await sell(cookieB, `B1-${token}`, '80.0000', '21', '3.000', '240.0000', '0', 'cash_usd'));
    step(`§15 Seller A posted ${saleA1.invoiceNumber}/${saleA2.invoiceNumber}/${saleA3.invoiceNumber}, Seller B posted ${saleB1.invoiceNumber}`);

    const detailA = await ok(await api(`/shifts/${shiftA.id}`, 'GET', undefined, cookieA), 200);
    assert.equal(detailA.sales.length, 3, 'Every sale of the shift must be linked to it.');
    assert.ok(detailA.sales.every((sale: any) => [saleA1.id, saleA2.id, saleA3.id].includes(sale.id)));
    step('§15 all three sales are linked to Seller A shift, and Seller B sale is not');

    // ---------------------------------------------------------------- §5 seller isolation
    assert.equal(await status(await api(`/shifts/${shiftB.id}`, 'GET', undefined, cookieA)), 403);
    assert.equal(await status(await api(`/shifts/${shiftA.id}`, 'GET', undefined, cookieB)), 403);
    const listA = await ok(await api('/shifts', 'GET', undefined, cookieA), 200);
    assert.deepEqual(listA.items.map((row: any) => row.id), [shiftA.id], 'A seller lists only their own shifts.');
    step('§5 a seller cannot read a colleague shift and lists only their own');

    // ---------------------------------------------------------------- §18/§19/§20/§21 totals
    const totals = detailA.totals;
    assert.equal(totals.invoiceCount, 3);
    near(totals.salesGrossUsd, 1200 + 825 + 500 - 0, 'sales gross');
    near(totals.cashReceivedUsd, 1000, 'cash received USD');
    near(totals.cashReceivedSyp, 2000000, 'cash received SYP');
    // All three carry a balance: 1200−1000 = 200, 825−0 = 825, and 500 − (2,000,000 ÷ 6500) = 192.31.
    assert.equal(totals.creditInvoiceCount, 3, 'Every invoice here was left partly unpaid.');
    near(totals.outstandingUsd, 200 + 825 + (500 - 2000000 / 6500), 'outstanding receivable');
    step('§18/§21 invoice count, gross, cash by currency and credit are computed on the server');

    // §56 — karats are never merged into one gram total.
    const sold = Object.fromEntries(totals.soldWeightByKarat.map((row: any) => [row.karat, row.weightGrams]));
    assert.deepEqual(sold, { '21': 20.25, '18': 5 }, `expected 21K=20.250 and 18K=5.000, got ${JSON.stringify(sold)}`);
    step('§19/§56 sold weight is reported per karat: 21K = 20.250 g, 18K = 5.000 g');

    // §57 — scrap taken in is reported apart from what was sold.
    assert.deepEqual(totals.exchangeGoldByKarat, [{ karat: '21', weightGrams: 9.1 }]);
    step('§20/§57 scrap exchange is reported separately: 21K = 9.100 g');

    // ---------------------------------------------------------------- §29/§55 expected cash
    // opening 500 + cash sales 1000 = 1500 USD; opening 2,000,000 + 2,000,000 = 4,000,000 SYP
    near(detailA.expectedUSD, 1500, 'expected USD');
    near(detailA.expectedSYP, 4000000, 'expected SYP');
    step('§29/§55 expected handover is computed per currency: 1,500 USD and 4,000,000 SYP');

    // ---------------------------------------------------------------- §26 timeline
    const types = detailA.timeline.map((entry: any) => entry.type);
    assert.ok(types.includes('shift.opened') && types.filter((type: string) => type === 'sale.created').length === 3);
    step('§26 the activity timeline carries the opening and every sale');

    // ---------------------------------------------------------------- §6/§7 manager view
    const managerOpen = await ok(await api('/shifts?live=true', 'GET', undefined, managerCookie), 200);
    const managerIds = managerOpen.items.map((row: any) => row.id);
    assert.ok(managerIds.includes(shiftA.id) && managerIds.includes(shiftB.id), 'A branch manager sees every open shift in the warehouse.');
    assert.equal(await status(await api(`/shifts/${shiftA.id}`, 'GET', undefined, managerCookie)), 200);
    assert.equal(await status(await api(`/shifts?warehouseId=${otherId}`, 'GET', undefined, managerCookie)), 403);
    step('§6 the branch manager sees both sellers live and is refused the unassigned warehouse');

    const gmOpen = await ok(await api('/shifts?live=true', 'GET', undefined, gmCookie), 200);
    assert.ok(gmOpen.items.some((row: any) => row.id === shiftA.id) && gmOpen.items.some((row: any) => row.id === shiftB.id));
    assert.equal(await status(await api(`/shifts?warehouseId=${otherId}`, 'GET', undefined, gmCookie)), 200);
    step('§7/§54 the general manager sees every shift in every warehouse without a warehouse row');

    // A manager card carries the live summary without a second request per seller.
    const cardA = managerOpen.items.find((row: any) => row.id === shiftA.id);
    assert.equal(cardA.sellerName, 'Seller A');
    assert.equal(cardA.totals.invoiceCount, 3);
    near(cardA.expectedUSD, 1500, 'manager card expected USD');
    step('§22 the open-shift card carries seller, counts, cash and expected custody');

    // ---------------------------------------------------------------- §31 difference needs a note
    assert.equal(await status(await api(`/shifts/${shiftA.id}/closing-request`, 'POST', { actualUSD: '1480.0000', actualSYP: '4000000.00' }, cookieA)), 409);
    step('§31 a closing request with a difference and no explanation is refused');

    // ---------------------------------------------------------------- §27/§30 closing request
    const requested = await ok(await api(`/shifts/${shiftA.id}/closing-request`, 'POST', { actualUSD: '1480.0000', actualSYP: '4000000.00', note: 'نقص 20 دولار — فكة زبون' }, cookieA));
    assert.equal(requested.status, 'closing_requested');
    near(requested.expectedUSD, 1500, 'requested expected USD');
    near(requested.actualUSD, 1480, 'requested actual USD');
    near(requested.differenceUSD, -20, 'USD difference');
    near(requested.differenceSYP, 0, 'SYP difference');
    step('§30 expected 1500 / actual 1480 → USD difference −20, SYP difference 0');

    // ---------------------------------------------------------------- §28 closing lock
    const locked = await sell(cookieA, `LOCKED-${token}`, '10.0000', '21', '1.000');
    const lockedBody = await json(locked);
    assert.equal(locked.status, 409);
    assert.match(lockedBody.message, /بانتظار موافقة المدير/);
    step('§28 a shift awaiting approval refuses new sales');

    // ---------------------------------------------------------------- §33 seller cannot approve
    assert.equal(await status(await api(`/shifts/${shiftA.id}/approve`, 'POST', {}, cookieA)), 403);
    step('§52 a seller cannot approve their own shift');

    // ---------------------------------------------------------------- §49 reject reopens
    assert.equal(await status(await api(`/shifts/${shiftA.id}/reject`, 'POST', {}, managerCookie)), 409, 'A rejection needs a reason.');
    const reopened = await ok(await api(`/shifts/${shiftA.id}/reject`, 'POST', { managerNote: 'أعد عدّ الصندوق' }, managerCookie));
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.actualUSD, null, 'A reopened shift clears the previous handover figures.');
    const afterReopen = await ok(await sell(cookieA, `REOPEN-${token}`, '10.0000', '21', '1.000', '10.0000', '0', 'cash_usd'));
    assert.ok(afterReopen.id, 'A reopened shift can trade again.');
    step('§49/§53 the manager rejected the request, the shift reopened and the seller sold again');

    // ---------------------------------------------------------------- §33 approval
    const secondRequest = await ok(await api(`/shifts/${shiftA.id}/closing-request`, 'POST', { actualUSD: '1510.0000', actualSYP: '4000000.00', note: 'تمت إعادة العد' }, cookieA));
    near(secondRequest.expectedUSD, 1510, 'expected after the extra cash sale');
    near(secondRequest.differenceUSD, 0, 'difference after recount');

    const approved = await ok(await api(`/shifts/${shiftA.id}/approve`, 'POST', { managerNote: 'مطابق' }, managerCookie));
    assert.equal(approved.status, 'closed');
    assert.ok(approved.approvedAt && approved.closedAt);
    assert.equal(approved.managerNote, 'مطابق');
    assert.equal(approved.isSnapshot, true, '§36 a closed shift reads from its frozen snapshot.');
    step('§33 the manager approved the closing and the shift is closed with a snapshot');

    // §47/§48 — approving twice is refused.
    assert.equal(await status(await api(`/shifts/${shiftA.id}/approve`, 'POST', { managerNote: 'مرة ثانية' }, managerCookie)), 409);
    // §49 — a closed shift is never simply reopened.
    assert.equal(await status(await api(`/shifts/${shiftA.id}/reject`, 'POST', { managerNote: 'محاولة إعادة فتح' }, managerCookie)), 409);
    step('§47/§49 a closed shift cannot be approved twice nor reopened');

    // ---------------------------------------------------------------- §36 immutable snapshot
    const snapshotBefore = (await ok(await api(`/shifts/${shiftA.id}`, 'GET', undefined, managerCookie), 200)).totals;
    // A brand-new shift and a further sale must not disturb the closed shift's numbers.
    const shiftA2 = await ok(await api('/shifts', 'POST', { openingCustodyUSD: '0', openingCustodySYP: '0', idempotencyKey: crypto.randomUUID() }, cookieA));
    await ok(await sell(cookieA, `AFTER-${token}`, '100.0000', '21', '7.000', '700.0000', '0', 'cash_usd'));
    const snapshotAfter = (await ok(await api(`/shifts/${shiftA.id}`, 'GET', undefined, managerCookie), 200)).totals;
    assert.deepEqual(snapshotAfter, snapshotBefore, 'A closed shift must never change when later documents are created.');
    assert.notEqual(shiftA2.id, shiftA.id);
    step('§36 the closed shift totals are unchanged by a later shift and a later sale');

    // ---------------------------------------------------------------- §35 no duplicate cash
    // The sale already posted its cash movement in Task 07. Closing must not post it again.
    const movements = await json(await api(`/finance/vouchers?limit=200`, 'GET', undefined, gmCookie));
    const shiftVouchers = (movements.items ?? []).filter((voucher: any) => (voucher.systemNote ?? '').includes('وردية'));
    assert.equal(shiftVouchers.length, 0, 'Shift closing must not create finance vouchers of its own.');
    step('§35 approving a shift created no finance voucher — sales cash is never posted twice');

    // ---------------------------------------------------------------- §37 history
    const history = await ok(await api('/shifts?status=closed', 'GET', undefined, managerCookie), 200);
    assert.ok(history.items.some((row: any) => row.id === shiftA.id));
    const sellerHistory = await ok(await api('/shifts?status=closed', 'GET', undefined, cookieB), 200);
    assert.ok(!sellerHistory.items.some((row: any) => row.id === shiftA.id), 'Seller B must not read Seller A history.');
    step('§37 shift history is scoped: the manager sees it, another seller does not');

    // ---------------------------------------------------------------- §45 seller cannot manage
    assert.equal(await status(await api(`/shifts/${shiftB.id}/approve`, 'POST', { managerNote: 'x' }, cookieA)), 403);
    step('§45 a seller holds no shift-management privilege');

    console.log('\nTASK 11 shifts suite passed.');
  } finally {
    await app.close();
  }
}

await main();
