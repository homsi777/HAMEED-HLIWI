import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 18: the shop's operating parameters move from each browser's localStorage onto the server.
//
// The assertion this whole task turns on is §7: changing the exchange rate must change what the
// NEXT document is priced at and nothing else. Every posted document already snapshots its own
// rate, and that guarantee has to survive this change — otherwise moving the rate would silently
// rewrite history, which is far worse than the divergence it was meant to fix.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const SELLER_SECRET = 'T18seller!2026';
const port = 3020;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 200) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  const username = `t18_seller_${token}`;
  let originalRate = 0; let originalVersion = 0;
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = jar(login);

    // ---------------------------------------------------------------- the server is the source
    const initial = await ok(await api('/settings'));
    originalRate = initial.usdToSypRate; originalVersion = initial.version;
    assert.ok(initial.usdToSypRate > 0, 'a rate must be configured');
    assert.equal(initial.goldPrices.length, 5, 'every karat must have a row');
    assert.deepEqual(initial.goldPrices.map((row: any) => row.karat).sort(), ['14', '18', '21', '22', '24']);
    step(`§2 settings load from the server — rate ${initial.usdToSypRate}, ${initial.goldPrices.length} karats, provisional=${initial.isProvisional}`);

    // ---------------------------------------------------------------- §31 the singleton holds
    await assert.rejects(
      sql`insert into app_settings (store_name, usd_to_syp_rate) values ('ثانٍ', 1000)`,
      'a second settings row must be impossible',
    );
    step('§31 a second settings row is refused by the database, not by convention');

    // ---------------------------------------------------------------- §29 permissions
    await ok(await api('/users', 'POST', { username, fullName: `بائع إعدادات ${token}`, password: SELLER_SECRET, roleName: 'sales', warehouseIds: [warehouseId] }), 201);
    const sellerLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: SELLER_SECRET, warehouseId }) }) as ResponseWithCookies;
    const seller = jar(sellerLogin);

    // §14: a seller cannot price a sale without the gold price, so reading is allowed.
    const sellerView = await ok(await api('/settings', 'GET', undefined, seller));
    assert.equal(sellerView.usdToSypRate, initial.usdToSypRate, 'the seller must read the same rate as the manager');
    assert.equal(sellerView.goldPrices.length, 5);
    step('§14 a seller reads the same settings the manager does');

    // §15/§16: changing them is refused by the server, not hidden by the UI.
    assert.equal((await api('/settings', 'PATCH', { usdToSypRate: '9999', version: initial.version }, seller)).status, 403);
    assert.equal((await api('/settings/gold-prices', 'PUT', { goldPrices: [{ karat: '21', sellPriceUsdPerGram: '1' }] }, seller)).status, 403);
    assert.equal((await api('/settings/history', 'GET', undefined, seller)).status, 403);
    step('§15/§16 a seller cannot change any setting, nor read the change history');

    // §17: a read permission must not put Settings in the seller's navigation.
    const sellerMe = await json(await api('/auth/me', 'GET', undefined, seller));
    assert.ok(!sellerMe.scope.modules.includes('settings'), 'settings must not appear in the seller navigation');
    assert.deepEqual(sellerMe.scope.modules.sort(), ['history', 'invoices', 'returns'], 'the seller module list must be exactly what TASK 10 asserts');
    step('§17 the seller navigation is unchanged — still exactly the TASK 10 three');

    assert.equal((await fetch(`${base}/settings`)).status, 401, 'an unauthenticated caller must be refused');
    step('§14 unauthenticated reads are refused');

    // ---------------------------------------------------------------- §7 history is not repriced
    // A real sale is posted at the current rate, then the rate is changed underneath it.
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد إعدادات ${token}`, type: 'supplier' }), 201);
    const code = `T18-${token}`;
    await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: supplier.id,
      items: [{ itemName: `صنف إعدادات ${token}`, code, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', pricePerGramUSD: '50.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }), 201);
    const [item] = await sql`select id from inventory_items where code = ${code} limit 1`;
    const customer = await ok(await api('/partners', 'POST', { name: `زبون إعدادات ${token}`, type: 'customer' }), 201);
    const sale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [{ inventoryItemId: item.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt',
      exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }), 201);
    const before = { rate: sale.exchangeRate ?? RATE, totalUSD: sale.finalTotalUSD, totalSYP: sale.finalTotalSYP };
    const [journalBefore] = await sql`select round(sum(debit_usd), 4) as debit from journal_entry_lines l join journal_entries j on j.id = l.journal_entry_id where j.source_id = ${sale.id}`;

    const doubled = (Number(initial.usdToSypRate) * 2).toFixed(4);
    const changed = await ok(await api('/settings', 'PATCH', { usdToSypRate: doubled, version: initial.version }));
    assert.equal(changed.usdToSypRate, Number(doubled), 'the new rate must be stored');
    assert.equal(changed.isProvisional, false, '§5 confirming a value clears the provisional flag');
    step(`§6 the rate moved from ${initial.usdToSypRate} to ${changed.usdToSypRate} and the provisional flag cleared`);

    const reread = await ok(await api(`/sales/${sale.id}`));
    assert.equal(reread.finalTotalUSD, before.totalUSD, '§7 the posted sale total must not move');
    assert.equal(reread.finalTotalSYP, before.totalSYP, '§7 the posted sale SYP total must not move — this is the whole point of the task');
    const [journalAfter] = await sql`select round(sum(debit_usd), 4) as debit from journal_entry_lines l join journal_entries j on j.id = l.journal_entry_id where j.source_id = ${sale.id}`;
    assert.equal(String(journalAfter.debit), String(journalBefore.debit), '§7 the journal behind the sale must not move either');
    const [storedRate] = await sql`select exchange_rate_syp_per_usd as rate from sales_invoices where id = ${sale.id}`;
    assert.equal(Number(storedRate.rate), Number(RATE), '§7 the document keeps the rate it was written with');
    step('§7 changing the rate did not touch the posted sale, its SYP total, or its journal');

    // ---------------------------------------------------------------- §8 the books still agree
    const reconciliation = await ok(await api('/accounting/reconciliation'));
    assert.equal(reconciliation.receivable.matches, true, `§8 receivable mismatch after a rate change: ${JSON.stringify(reconciliation.receivable)}`);
    assert.equal(reconciliation.payable.matches, true, `§8 payable mismatch after a rate change: ${JSON.stringify(reconciliation.payable)}`);
    assert.ok(reconciliation.cash.every((row: any) => row.matches), '§8 cash is reconciled in its own currency and must survive a rate change');
    assert.equal((await ok(await api('/accounting/trial-balance'))).balanced, true);
    step('§8 reconciliation and the trial balance survive the rate change, cash included');

    // ---------------------------------------------------------------- §30 history recorded it
    const history = await ok(await api('/settings/history?limit=20'));
    const entry = history.find((row: any) => row.field === 'usdToSypRate' && row.newValue === doubled);
    assert.ok(entry, '§9/§30 the rate change must be recorded');
    assert.equal(Number(entry.oldValue), Number(initial.usdToSypRate), 'the old value must be recorded');
    assert.ok(entry.actorUserId, 'the actor must be recorded');
    assert.ok(entry.occurredAt, 'the time must be recorded');
    step(`§30 history recorded ${entry.oldValue} → ${entry.newValue} with actor and timestamp`);

    // ---------------------------------------------------------------- optimistic concurrency
    assert.equal((await api('/settings', 'PATCH', { usdToSypRate: '1234', version: initial.version })).status, 409, 'a stale version must be refused');
    step('a stale version is refused rather than silently overwriting someone else');

    // ---------------------------------------------------------------- §10/§13 gold prices
    const current = await ok(await api('/settings'));
    const karat21 = current.goldPrices.find((row: any) => row.karat === '21');
    const updated = await ok(await api('/settings/gold-prices', 'PUT', {
      goldPrices: [{ karat: '21', sellPriceUsdPerGram: '77.5000', laborFeeUsdPerGram: '3.0000', version: karat21.version }],
    }));
    const after21 = updated.goldPrices.find((row: any) => row.karat === '21');
    assert.equal(after21.sellPriceUSDPerGram, 77.5, 'the karat price must be stored');
    assert.equal(after21.laborFeeUSDPerGram, 3, 'the workmanship fee must be stored');
    const untouched = updated.goldPrices.find((row: any) => row.karat === '18');
    assert.equal(untouched.sellPriceUSDPerGram, current.goldPrices.find((row: any) => row.karat === '18').sellPriceUSDPerGram, '§3 other karats must not move');
    step('§10 a karat price is stored and no other karat moves with it');

    const priceHistory = await ok(await api('/settings/history?limit=50'));
    assert.ok(priceHistory.some((row: any) => row.scope === 'gold_price' && row.karat === '21' && row.newValue === '77.5000'), '§13 the price change must be recorded against its karat');
    step('§13 the price change is recorded in history against karat 21');

    // §12: a gold price is a default. It must not have altered the sale posted before it.
    const stillSame = await ok(await api(`/sales/${sale.id}`));
    assert.equal(stillSame.finalTotalUSD, before.totalUSD, '§12 a price change must not reprice a posted invoice');
    step('§12 the price is a default for the next document, never a rewrite of the last one');

    // ---------------------------------------------------------------- validation
    assert.equal((await api('/settings', 'PATCH', { usdToSypRate: '0', version: updated.version })).status, 409, 'a zero rate must be refused');
    assert.equal((await api('/settings', 'PATCH', { usdToSypRate: '-5', version: updated.version })).status, 409, 'a negative rate must be refused');
    assert.equal((await api('/settings/gold-prices', 'PUT', { goldPrices: [{ karat: '19', sellPriceUsdPerGram: '10' }] })).status, 409, 'an unknown karat must be refused');
    step('a zero rate, a negative rate and an unknown karat are all refused');

    console.log('\nTASK 18 settings suite passed.');
  } finally {
    // Put the rate back where it was, so a shared development database is left as it was found.
    if (originalRate > 0) {
      await sql`update app_settings set usd_to_syp_rate = ${originalRate.toFixed(4)}, version = ${originalVersion}`;
    }
    await sql`delete from auth_sessions where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_warehouses where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_roles where user_id in (select id from users where username = ${username})`;
    await sql.end();
    await app.close();
  }
}

await main();
