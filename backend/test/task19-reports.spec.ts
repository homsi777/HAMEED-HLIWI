import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 19: operational reports.
//
// The decisive test is §32 — a report must agree with the module it summarises. A report that
// disagrees with its own source is worse than no report, because it looks authoritative.
//
// The second is §4: no cost, no profit, no valuation. TASK 16 is deferred and production has
// almost no purchased stock, so a gross-profit figure would have no basis at all.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const SELLER_SECRET = 'T19seller!2026';
const port = 3021;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);
const today = new Date().toISOString().slice(0, 10);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 200) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
const round = (value: number) => Number(value.toFixed(4));

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  const username = `t19_seller_${token}`;
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const otherWarehouseId = warehouses.find((row: any) => row.id !== warehouseId)?.id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = jar(login);

    const scope = `?from=${today}&to=${today}&warehouseId=${warehouseId}`;
    const beforeSales = await ok(await api(`/reports/sales${scope}`));
    const beforeValue = beforeSales.totals?.valueUSD ?? 0;
    const beforeReceivable = (await ok(await api('/reports/receivables'))).totalOwedToShopUSD;

    // ---------------------------------------------------------------- controlled data
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد تقارير ${token}`, type: 'supplier' }), 201);
    const customer = await ok(await api('/partners', 'POST', { name: `زبون تقارير ${token}`, type: 'customer' }), 201);
    const code = `T19-${token}`;
    await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: supplier.id,
      items: [{ itemName: `صنف تقارير ${token}`, code, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '60.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }), 201);
    const [item] = await sql`select id from inventory_items where code = ${code} limit 1`;

    // A $1,000 sale settled by $300 — the same shape as the acceptance example.
    const sale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [{ inventoryItemId: item.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '20.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '1000.0000', paidSYP: '0', paymentMethod: 'mixed',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }), 201);
    const saleValue = Number(sale.finalTotalUSD);
    const saleOutstanding = Number(sale.remainingDebtUSD);
    assert.ok(saleValue > 0 && saleOutstanding > 0, 'the fixture must leave an outstanding balance');

    // ---------------------------------------------------------------- §32 agreement with sales
    const afterSales = await ok(await api(`/reports/sales${scope}`));
    assert.equal(round(afterSales.totals.valueUSD - beforeValue), round(saleValue), '§32 the sales report must move by exactly the invoice value');

    // Compared by invoice count against the module's own total for the same filter. Summing a
    // single page would only prove the page, and this shared database holds hundreds of rows.
    const salesModule = await ok(await api(`/sales?warehouseId=${warehouseId}&status=posted&dateFrom=${today}&dateTo=${today}&limit=1`));
    assert.equal(afterSales.totals.invoices, salesModule.meta.total, `§32 the report counted ${afterSales.totals.invoices} posted invoices; the sales module counts ${salesModule.meta.total} for the same filter`);
    step(`§32 sales report agrees with the sales module for the same filter — ${afterSales.totals.invoices} invoices, $${afterSales.totals.valueUSD}`);

    // ---------------------------------------------------------------- §32 agreement with the ledger
    const receivables = await ok(await api('/reports/receivables'));
    assert.equal(round(receivables.totalOwedToShopUSD - beforeReceivable), round(saleOutstanding), '§16 receivables must move by exactly the unpaid remainder');
    const reconciliation = await ok(await api('/accounting/reconciliation'));
    assert.equal(reconciliation.receivable.matches, true, 'the subledger and the GL must still agree');
    const partnerRow = receivables.rows.find((row: any) => row.partnerId === customer.id);
    assert.ok(partnerRow, 'the customer must appear in receivables');
    assert.equal(partnerRow.balanceUSD, saleOutstanding, '§16 the per-partner figure comes from the subledger');
    assert.ok(partnerRow.aging.currentUSD > 0, 'a fresh invoice must land in the current aging bucket');
    step(`§16 receivables agree with the subledger and the GL — $${partnerRow.balanceUSD} owed, aged current`);

    // ---------------------------------------------------------------- §32 agreement with TASK 12
    const history = await ok(await api(`/history/sold-weights/summary?dateFrom=${today}&dateTo=${today}&warehouseId=${warehouseId}`));
    const reportWeight = afterSales.byKarat.reduce((sum: number, row: any) => sum + row.netWeightGrams, 0);
    const historyWeight = history.byKarat.reduce((sum: number, row: any) => sum + row.netWeightGrams, 0);
    assert.equal(round(reportWeight), round(historyWeight), `§32/§41 the report weight (${reportWeight}) must equal سجل الأوزان المباعة (${historyWeight})`);
    step(`§32 sold weight agrees with TASK 12 history — ${reportWeight} g, not a second answer`);

    // ---------------------------------------------------------------- §34 returns reduce the weight
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`));
    await ok(await api('/returns', 'POST', {
      type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: `مرتجع ${token}`, exchangeRateSypPerUsd: RATE,
      items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '50.000' }],
      refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
    }), 201);

    const afterReturn = await ok(await api(`/reports/sales${scope}`));
    const karat21 = afterReturn.byKarat.find((row: any) => row.karat === '21');
    assert.ok(karat21.returnedWeightGrams >= 50, '§34 the returned weight must be visible');
    assert.equal(round(karat21.netWeightGrams), round(karat21.soldWeightGrams - karat21.returnedWeightGrams), '§34 net weight must be sold minus returned, not sold alone');
    step(`§34 a 50 g return shows as returned and reduces the net — sold ${karat21.soldWeightGrams} g, net ${karat21.netWeightGrams} g`);

    // ---------------------------------------------------------------- §33 cancellations are explicit
    const doomed = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [{ itemName: `ملغاة ${token}`, category: 'متنوع', karat: '21', quantity: '1', grossWeightGrams: '5.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }), 201);
    const beforeCancel = await ok(await api(`/reports/sales${scope}`));
    await ok(await api(`/sales/${doomed.id}/cancel`, 'POST', { reason: `اختبار ${token}` }), 201);
    const afterCancel = await ok(await api(`/reports/sales${scope}`));

    assert.equal(round(afterCancel.totals.valueUSD), round(beforeCancel.totals.valueUSD - Number(doomed.finalTotalUSD)), '§33 a cancelled invoice must leave the totals');
    assert.ok(afterCancel.cancelled.count > beforeCancel.cancelled.count, '§33 and must appear in the cancelled count rather than vanishing');
    step(`§33 cancellations leave the totals and are reported separately — ${afterCancel.cancelled.count} cancelled, $${afterCancel.cancelled.valueUSD}`);

    // ---------------------------------------------------------------- §4/§36 nothing about cost
    const surfaces = await Promise.all(['overview', 'sales', 'sales-by-customer', 'purchases', 'inventory', 'receivables', 'cash', 'gold', 'shifts']
      .map(async name => [name, await json(await api(`/reports/${name}${scope}`))] as const));
    for (const [name, payload] of surfaces) {
      const raw = JSON.stringify(payload);
      for (const forbidden of ['cost', 'Cost', 'acquisition', 'COGS', 'margin', 'profit', 'Profit', 'valuation']) {
        assert.ok(!raw.includes(forbidden), `§36 the ${name} report must not expose "${forbidden}"`);
      }
    }
    step('§4/§36 no report mentions cost, acquisition, COGS, margin, profit or valuation');

    // §13: workmanship is reported, under its own name, and is not called profit.
    const workmanship = await ok(await api(`/reports/workmanship${scope}`));
    assert.ok(workmanship.totalUSD > 0, 'workmanship revenue must be reported — it is a recorded fact');
    // The check belongs on the field names: the note deliberately contains the word "ربح" because
    // it says the figure is not one, and a crude string search would flag that denial as a breach.
    const fieldNames = JSON.stringify(Object.keys(workmanship).concat(workmanship.byKarat.flatMap((row: any) => Object.keys(row))));
    assert.ok(!/profit|margin|cost/i.test(fieldNames), '§13 no field may be named profit, margin or cost');
    assert.ok(workmanship.note.includes('ليس ربحاً'), '§13 the payload must say plainly what it is not');
    step(`§13 workmanship revenue reported as $${workmanship.totalUSD}, explicitly not profit`);

    // ---------------------------------------------------------------- §2/§3 currencies and karats
    const cash = await ok(await api(`/reports/cash${scope}`));
    assert.ok(cash.boxes.every((box: any) => typeof box.currency === 'string'), '§2 every cash figure must carry its currency');
    assert.ok(!('totalUSD' in cash) && !('total' in cash), '§2 there must be no combined total across currencies');
    const inventory = await ok(await api(`/reports/inventory${scope}`));
    assert.ok(Array.isArray(inventory.byKarat) && inventory.byKarat.every((row: any) => row.karat), '§3 inventory weight is reported per karat');
    assert.ok(typeof inventory.pureGoldGrams === 'number', '§3 the single headline weight is stated in pure gold');
    assert.ok(inventory.byOrigin.length > 0 && inventory.byOrigin.every((row: any) => ['purchase', 'direct', 'historical', 'used_gold'].includes(row.origin)), '§14 inventory reuses the TASK 17 origin rule');
    step('§2/§3 currencies are never combined, karats never merged, and origin reuses TASK 17');

    // ---------------------------------------------------------------- §6/§35 scope
    await ok(await api('/users', 'POST', { username, fullName: `بائع تقارير ${token}`, password: SELLER_SECRET, roleName: 'sales', warehouseIds: [warehouseId] }), 201);
    const sellerLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: SELLER_SECRET, warehouseId }) }) as ResponseWithCookies;
    const seller = jar(sellerLogin);
    for (const name of ['overview', 'sales', 'receivables', 'cash', 'gold']) {
      assert.equal((await api(`/reports/${name}`, 'GET', undefined, seller)).status, 403, `a seller must not reach the ${name} report`);
    }
    assert.equal((await fetch(`${base}/reports/overview`)).status, 401, 'an unauthenticated caller must be refused');
    step('§35 a seller cannot reach any report, and unauthenticated callers are refused');

    if (otherWarehouseId) {
      // A warehouse the caller does hold narrows the view; the scope service refuses anything else.
      const narrowed = await ok(await api(`/reports/sales?warehouseId=${otherWarehouseId}&from=${today}&to=${today}`));
      assert.notEqual(round(narrowed.totals?.valueUSD ?? 0), round(afterCancel.totals.valueUSD), '§6 narrowing to another warehouse must change the answer');
      step('§6 a warehouse filter narrows the view rather than being ignored');
    }

    // ---------------------------------------------------------------- TASK 21 the daily series
    // The dashboard used to draw a hardcoded week with only the last point real. This is the
    // series that replaced it, so it has to be real all the way across.
    const timeline = await ok(await api(`/reports/sales-timeline?days=7&warehouseId=${warehouseId}`));
    assert.equal(timeline.length, 7, 'every day in the window must be present, including quiet ones');
    assert.ok(timeline.every((row: any) => typeof row.salesUSD === 'number' && typeof row.purchasesUSD === 'number'), 'each day carries real figures');
    const todayRow = timeline[timeline.length - 1];
    assert.equal(todayRow.date, today, 'the series must end today');
    assert.ok(todayRow.salesUSD > 0, 'today has sales in this run, so the series must show them');
    assert.equal(round(todayRow.salesUSD), round(afterCancel.totals.valueUSD), 'the last point must equal the sales report for the same day');
    step(`the daily series is real end to end - today $${todayRow.salesUSD} matches the sales report`);

    console.log('\nTASK 19 reports suite passed.');
  } finally {
    await sql`delete from auth_sessions where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_warehouses where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_roles where user_id in (select id from users where username = ${username})`;
    await sql.end();
    await app.close();
  }
}

await main();
