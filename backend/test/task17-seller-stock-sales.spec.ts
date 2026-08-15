import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 17 §A: a seller must be able to sell digitised warehouse stock without ever receiving
// inventory-management access, while manual historical sales remain a separate, valid workflow.
//
// The whole point of the endpoint under test is that the two capabilities are not the same
// permission. Every assertion here is written so it fails if `inventory.view` were quietly
// granted to make the feature work.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const SELLER_SECRET = 'T17seller!2026';
const port = 3018;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  const username = `t17_seller_${token}`;
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const otherWarehouseId = warehouses.find((row: any) => row.id !== warehouseId)?.id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = jar(login);

    // ---------------------------------------------------------------- a real seller account
    await ok(await api('/users', 'POST', { username, fullName: `بائع تجربة ${token}`, password: SELLER_SECRET, roleName: 'sales', warehouseIds: [warehouseId] }));
    const sellerLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: SELLER_SECRET, warehouseId }) }) as ResponseWithCookies;
    assert.equal(sellerLogin.status, 201, 'the seller must be able to sign in');
    const seller = jar(sellerLogin);

    // §2/§49: the guarantee this whole feature rests on.
    const me = await json(await api('/auth/me', 'GET', undefined, seller));
    assert.ok(!me.user.permissions.includes('inventory.view'), 'the seller must not hold inventory.view');
    assert.ok(me.user.permissions.includes('sales.create'), 'the seller must hold sales.create');
    assert.ok(!me.scope.modules.includes('inventory'), 'inventory must not appear in the seller navigation');
    assert.equal((await api('/inventory?status=all', 'GET', undefined, seller)).status, 403, 'inventory management must stay refused');
    for (const path of ['/purchases', '/finance/cashboxes', '/accounting/accounts', '/gold/accounts', '/users']) {
      assert.equal((await api(path, 'GET', undefined, seller)).status, 403, `${path} must stay refused for a seller`);
    }
    step('§2/§49 the seller holds sales.create, not inventory.view — inventory, purchases, finance, accounting, gold and users are all 403');

    // ---------------------------------------------------------------- stock to sell
    // Bought as the manager, because §48 keeps purchases away from sellers.
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد مخزون ${token}`, type: 'supplier' }));
    const aggregateCode = `T17AGG-${token}`;
    await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: supplier.id,
      items: [{ itemName: `ذهب وزني ${token}`, code: aggregateCode, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '100.000', stoneWeightGrams: '0.000', pricePerGramUSD: '80.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    await sql`update inventory_items set inventory_mode = 'aggregate' where code = ${aggregateCode}`;

    // ---------------------------------------------------------------- §3/§4 the sellable list
    // The warehouse holds hundreds of pieces, so the item is located by search rather than by
    // hoping it lands on the first page — which is the workflow §5 exists for anyway.
    const browsed = await json(await api('/sales/available-items?page=1&limit=20', 'GET', undefined, seller));
    assert.ok(Array.isArray(browsed.items) && browsed.items.length > 0, 'browsing must return a page of sellable stock');
    assert.ok(browsed.meta.total > browsed.items.length, 'the list must be paginated, not the whole inventory');
    step(`§5 browsing returns ${browsed.items.length} of ${browsed.meta.total} sellable items — paginated, not downloaded whole`);

    const available = await json(await api(`/sales/available-items?search=${encodeURIComponent(aggregateCode)}`, 'GET', undefined, seller));
    const aggregate = available.items.find((row: any) => row.code === aggregateCode);
    assert.ok(aggregate, 'the digitised stock must be visible to the seller');
    assert.equal(aggregate.availableWeightGrams, 100, `expected 100.000 g available, got ${aggregate.availableWeightGrams}`);
    assert.equal(aggregate.warehouseId, warehouseId, 'only the seller’s own warehouse may appear');
    step('§3 the seller can reach digitised stock without inventory.view');

    // §4: nothing an inventory manager would need may leak through this door.
    const serialised = JSON.stringify(available);
    for (const forbidden of ['cost', 'Cost', 'valuation', 'Valuation', 'acquisition', 'profit', 'margin', 'stocktake', 'archivedAt', 'createdByUserId', 'version']) {
      assert.ok(!serialised.includes(forbidden), `the sellable list must not expose "${forbidden}"`);
    }
    assert.ok(browsed.items.every((row: any) => row.warehouseId === warehouseId), 'no other warehouse may be returned');
    for (const forbidden of ['cost', 'Cost', 'valuation', 'acquisition', 'profit', 'margin', 'stocktake', 'archivedAt']) {
      assert.ok(!JSON.stringify(browsed).includes(forbidden), `the browsable page must not expose "${forbidden}" either`);
    }
    step('§4 no cost, valuation, stocktake or management metadata is exposed, and no other warehouse');

    // §5: search by code and by name.
    const byCode = await json(await api(`/sales/available-items?search=${encodeURIComponent(aggregateCode)}`, 'GET', undefined, seller));
    assert.equal(byCode.items[0]?.code, aggregateCode, 'an exact code must sort first');
    const byName = await json(await api(`/sales/available-items?search=${encodeURIComponent('ذهب وزني')}`, 'GET', undefined, seller));
    assert.ok(byName.items.some((row: any) => row.code === aggregateCode), 'searching by name must find the piece');
    step('§5 search works by code and by name, with an exact code match first');

    // §3: a browser-supplied warehouse can narrow, never widen.
    if (otherWarehouseId) {
      assert.equal((await api(`/sales/available-items?warehouseId=${otherWarehouseId}`, 'GET', undefined, seller)).status, 403, 'another warehouse must be refused outright');
      step('§3 asking for another warehouse is refused rather than silently ignored');
    }

    // ---------------------------------------------------------------- §58 sell part of it
    // TASK 11 requires an own-scope user to have an open shift before selling.
    await ok(await api('/shifts', 'POST', { openingCustodyUSD: '0', openingCustodySYP: '0', idempotencyKey: crypto.randomUUID() }, seller));
    const customer = await ok(await api('/partners', 'POST', { name: `زبون مخزون ${token}`, type: 'customer' }, seller));
    await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [{ inventoryItemId: aggregate.id, soldWeightGrams: '12.000', quantity: '0.120', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, seller));

    const afterSale = await json(await api(`/sales/available-items?search=${encodeURIComponent(aggregateCode)}`, 'GET', undefined, seller));
    const remaining = afterSale.items.find((row: any) => row.code === aggregateCode);
    assert.ok(remaining, 'the partially sold aggregate must still be sellable');
    assert.equal(remaining.availableWeightGrams, 88, `§58 expected 88.000 g remaining, got ${remaining.availableWeightGrams}`);
    step('§58 the seller sold 12.000 g of 100.000 g from digitised stock — 88.000 g remains');

    // ---------------------------------------------------------------- §9 manual sale still works
    const manual = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [{ itemName: `قطعة يدوية ${token}`, category: 'متنوع', karat: '21', quantity: '1', grossWeightGrams: '8.250', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, seller));
    assert.ok(manual.id, 'manual historical sale must remain available alongside stock sales');
    const [historical] = await sql`select quantity, net_weight_grams, is_manual_sale_entry from inventory_items where is_manual_sale_entry = true order by created_at desc limit 1`;
    assert.equal(Number(historical.quantity), -1, '§9 the approved historical record is a negative quantity');
    assert.equal(Number(historical.net_weight_grams), -8.25, '§9 the approved historical record carries the negative weight');
    step('§9 manual historical sale still creates the approved negative record — both workflows coexist');

    // §9: and that negative record must never come back as sellable stock.
    const sellable = await json(await api('/sales/available-items?page=1&limit=100', 'GET', undefined, seller));
    assert.ok(sellable.items.every((row: any) => row.availableWeightGrams > 0 && row.quantity !== 0), 'a historical negative record must never be offered for sale');
    step('§9 historical negative records are never offered as sellable stock');

    console.log('\nTASK 17 seller stock-sales suite passed.');
  } finally {
    // The temporary seller is removed; nothing else this run created is touched.
    await sql`delete from auth_sessions where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_warehouses where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_roles where user_id in (select id from users where username = ${username})`;
    await sql.end();
    await app.close();
  }
}

await main();
