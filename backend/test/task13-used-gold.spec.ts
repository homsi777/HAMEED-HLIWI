import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 13: converting barter scrap into sellable used-gold inventory.
//
// The whole risk in this task is double counting metal, so the assertions below repeatedly
// check the same thing from two directions: what the gold ledger says the shop still holds as
// scrap, and what inventory says is on the shelf.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3013;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);
const SECRET = 'Passw0rd!Task13';

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
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.0015, `${label}: expected ${expected} but got ${actual}`);

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 2 });
  try {
    const loginWarehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const furqanId = loginWarehouses[0].id;
    const otherId = loginWarehouses.find((row: any) => row.id !== furqanId)!.id;
    const adminLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: furqanId }) }) as ResponseWithCookies;
    adminCookie = jar(adminLogin);
    const customer = await ok(await api('/partners', 'POST', { name: `عميل مقايضة ${token}`, type: 'customer', phone: `06${token.replace(/\D/g, '').padEnd(8, '2').slice(0, 8)}` }));

    const createUser = async (suffix: string, fullName: string, roleName: string, warehouseIds: string[]) =>
      ok(await api('/users', 'POST', { username: `t13_${suffix}_${token}`, fullName, password: SECRET, roleName, warehouseIds }));
    await createUser('mgr', 'Manager Furqan', 'warehouse_manager', [furqanId]);
    await createUser('other', 'Manager Other', 'warehouse_manager', [otherId]);
    await createUser('a', 'Seller A', 'sales', [furqanId]);
    const managerCookie = await login(`t13_mgr_${token}`, furqanId);
    const otherManagerCookie = await login(`t13_other_${token}`, otherId);
    const sellerCookie = await login(`t13_a_${token}`, furqanId);

    // ---------------------------------------------------------------- §51 build a real holding
    // Scrap only enters the shop through a sale, so the holding is created the way it really is.
    const bringScrap = async (karat: string, grams: string) => {
      const shift = await ok(await api('/shifts', 'POST', { openingCustodyUSD: '0', openingCustodySYP: '0', idempotencyKey: crypto.randomUUID() }, sellerCookie)).catch(() => null);
      return ok(await api('/sales', 'POST', {
        warehouseId: furqanId, customerId: customer.id,
        items: [{ itemName: `قطعة ${token}`, category: 'خواتم ومحابس', karat, grossWeightGrams: '30.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
        scrapGoldItems: [{ karat, weightGrams: grams, pricePerGramUSD: '1.0000' }],
        discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
      }, managerCookie));
    };
    const before = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const baseRow = (source: any, karat: string) => source.holdings.find((row: any) => row.karat === karat && row.warehouseId === furqanId);
    const baseline = (karat: string) => baseRow(before, karat)?.availableGrams ?? 0;
    const baseConverted = (karat: string) => baseRow(before, karat)?.convertedGrams ?? 0;
    const base21 = baseline('21'), base18 = baseline('18'), base14 = baseline('14');
    const converted21 = baseConverted('21'), converted18 = baseConverted('18');

    await bringScrap('21', '10.000');
    const holdings = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const holding21 = holdings.holdings.find((row: any) => row.karat === '21' && row.warehouseId === furqanId);
    near(holding21.availableGrams, base21 + 10, 'available 21K after a 10 g barter');
    assert.equal(holding21.canConvert, true);
    step(`§51 a real 10.000 g 21K barter holding exists (available ${holding21.availableGrams} غ)`);

    // ---------------------------------------------------------------- §20/§57 authorization
    const convertBody = (karat: string, grams: string, code: string, extra: Record<string, unknown> = {}) => ({
      goldAccountId: holding21.goldAccountId, karat, weightGrams: grams,
      name: 'خاتم مستعمل', category: 'خواتم ومحابس', code, inventoryMode: 'individual', quantity: '1',
      managerNote: 'قطعة مستعملة واردة من مقايضة', idempotencyKey: crypto.randomUUID(), ...extra,
    });
    assert.equal(await status(await api('/gold/used-conversions', 'POST', convertBody('21', '1.000', `X-${token}`), sellerCookie)), 403);
    assert.equal(await status(await api('/gold/holdings/scrap', 'GET', undefined, sellerCookie)), 403);
    assert.equal(await status(await api('/gold/used-conversions', 'POST', convertBody('21', '1.000', `Y-${token}`), otherManagerCookie)), 403);
    step('§20/§57 a seller cannot convert or even read holdings; a manager cannot reach another warehouse');

    // ---------------------------------------------------------------- §11 manager note required
    assert.equal(await status(await api('/gold/used-conversions', 'POST', { ...convertBody('21', '1.000', `N-${token}`), managerNote: '   ' }, managerCookie)), 409);
    step('§10/§11 conversion is refused without a real manager note');

    // ---------------------------------------------------------------- §55/§37 over-conversion
    const tooMuch = await json(await api('/gold/used-conversions', 'POST', convertBody('21', String(holding21.availableGrams + 1), `O-${token}`), managerCookie));
    assert.equal(tooMuch.statusCode, 409);
    assert.match(tooMuch.message, /يتجاوز المتاح/);
    const afterRefusal = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    near(afterRefusal.holdings.find((row: any) => row.karat === '21' && row.warehouseId === furqanId).availableGrams, holding21.availableGrams, 'no partial write after a refusal');
    step('§37/§55 over-conversion is refused and writes nothing');

    // ---------------------------------------------------------------- §51 the conversion itself
    const netPure = async () => Number((await sql`select round(sum(case when debit_grams > 0 then pure_gold_grams else -pure_gold_grams end), 4) as net from gold_ledger_entries`)[0]!.net);
    const netPureBefore = await netPure();
    const conversion = await ok(await api('/gold/used-conversions', 'POST', convertBody('21', '6.250', `USED-${token}`), managerCookie));
    assert.equal(conversion.karat, '21');
    near(conversion.convertedWeightGrams, 6.25, 'converted weight');
    assert.equal(conversion.status, 'posted');
    assert.equal(conversion.warehouseId, furqanId, '§18/§19 stock is created in the warehouse holding the scrap');

    const item = (await sql`select * from inventory_items where id = ${conversion.inventoryItemId}`)[0]!;
    assert.equal(item.condition, 'used', '§12 the used marker is a real column, not a name');
    assert.equal(item.source_type, 'gold_scrap_conversion');
    assert.equal(item.karat, '21', '§8 karat is conserved');
    near(Number(item.net_weight_grams), 6.25, '§9 weight is conserved exactly');
    assert.equal(item.status, 'in_stock');
    assert.equal(item.notes, 'قطعة مستعملة واردة من مقايضة');
    step('§12/§14 a used 21K stock item of 6.250 g was created with a machine-readable source');

    // ---------------------------------------------------------------- §36 scrap cannot reappear
    const afterConvert = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const holdingAfter = afterConvert.holdings.find((row: any) => row.karat === '21' && row.warehouseId === furqanId);
    near(holdingAfter.availableGrams, base21 + 10 - 6.25, '§6 remaining available scrap');
    near(holdingAfter.receivedGrams, holding21.receivedGrams, '§4 the original receipt is untouched');
    near(holdingAfter.convertedGrams, converted21 + 6.25, 'converted total grew by exactly the converted amount');
    step(`§4/§6/§36 received unchanged, converted 6.250 غ, available now ${holdingAfter.availableGrams} غ`);

    // ---------------------------------------------------------------- §2 no duplicate postings
    const goldTx = (await sql`select type, status from gold_transactions where id = ${conversion.goldTransactionId}`)[0]!;
    assert.equal(goldTx.type, 'used_inventory_conversion', '§28 a reclassification, not a faked receipt or payment');
    const vouchersFor = (await sql`select count(*)::int c from vouchers where system_note ilike ${'%مستعمل%'}`)[0]!.c;
    assert.equal(vouchersFor, 0, '§30 conversion creates no voucher');
    const journalsFor = (await sql`select count(*)::int c from journal_entries where description ilike ${'%مستعمل%'}`)[0]!.c;
    assert.equal(journalsFor, 0, '§29 conversion posts no journal value');
    const receipts = (await sql`select count(*)::int c from gold_transactions where type in ('receipt','payment') and description ilike ${'%مستعمل%'}`)[0]!.c;
    assert.equal(receipts, 0, '§2 no second gold receipt');
    step('§2/§29/§30 no voucher, no journal, no cash movement, no second gold receipt');

    // The ledger still balances in pure gold across the whole system.
    // A reclassification moves metal between two accounts, so the system-wide pure-gold
    // position must be exactly what it was before. (The absolute figure carries historical
    // rounding from earlier suites in this shared database; the delta is the real invariant.)
    near(await netPure(), netPureBefore, '§9 the reclassification changed the net pure-gold position');
    step('§9 net pure gold across the whole ledger is unchanged by the reclassification');

    // ---------------------------------------------------------------- §39 idempotency
    const key = crypto.randomUUID();
    const first = await ok(await api('/gold/used-conversions', 'POST', convertBody('21', '0.500', `IDEM-${token}`, { idempotencyKey: key }), managerCookie));
    const second = await ok(await api('/gold/used-conversions', 'POST', convertBody('21', '0.500', `IDEM-${token}`, { idempotencyKey: key }), managerCookie));
    assert.equal(first.id, second.id, 'A retried conversion returns the same record.');
    assert.equal((await sql`select count(*)::int c from gold_inventory_conversions where idempotency_key = ${key}`)[0]!.c, 1);
    step('§39 a retried conversion creates exactly one record, item and movement');

    // ---------------------------------------------------------------- §31/§33 resale
    const sale = await ok(await api('/sales', 'POST', {
      warehouseId: furqanId, customerId: customer.id,
      items: [{ inventoryItemId: conversion.inventoryItemId, pricePerGramUSD: '90.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }, managerCookie));
    const soldItem = (await sql`select status from inventory_items where id = ${conversion.inventoryItemId}`)[0]!;
    assert.equal(soldItem.status, 'sold', '§34 the individual used piece was consumed by a normal sale');
    step(`§31/§32/§34 the used piece sold through the ordinary sales engine on ${sale.invoiceNumber}`);

    // §36 — selling the stock must not give the scrap back.
    const afterSale = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    near(afterSale.holdings.find((row: any) => row.karat === '21' && row.warehouseId === furqanId).availableGrams, base21 + 10 - 6.75, 'available scrap unchanged by the resale');
    step('§36 selling the used stock did not return the grams to the scrap holding');

    // ---------------------------------------------------------------- §35 history, counted once
    const soldWeights = await ok(await api(`/history/sold-weights?invoiceNumber=${sale.invoiceNumber}&limit=50`, 'GET', undefined, managerCookie), 200);
    assert.equal(soldWeights.items.length, 1, 'One sold line, not two.');
    near(soldWeights.items[0].netWeightGrams, 6.25, 'sold weight equals the used piece');
    assert.equal(soldWeights.items[0].source, 'stock', '§35 it is inventory stock, not a manual sale');
    step('§35 history shows the resale exactly once, as stock — no double count with the intake');

    // ---------------------------------------------------------------- §54 partial, §53 full
    await bringScrap('18', '8.000');
    const holdings18 = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const account18 = holdings18.holdings.find((row: any) => row.karat === '18' && row.warehouseId === furqanId);
    const convert18 = (grams: string, code: string) => api('/gold/used-conversions', 'POST', {
      goldAccountId: account18.goldAccountId, karat: '18', weightGrams: grams,
      name: 'ذهب مستعمل 18', category: 'متنوع', code, inventoryMode: 'aggregate', quantity: '1',
      managerNote: 'دفعة مستعملة', idempotencyKey: crypto.randomUUID(),
    }, managerCookie);
    await ok(await convert18('3.000', `P1-${token}`));
    await ok(await convert18('2.000', `P2-${token}`));
    const after18 = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const row18 = after18.holdings.find((row: any) => row.karat === '18' && row.warehouseId === furqanId);
    near(row18.convertedGrams, converted18 + 5, '§54 two partial conversions total 5.000 g');
    near(row18.availableGrams, base18 + 8 - 5, '§54 remaining available');
    assert.ok(row18.conversionCount >= 2, 'each conversion stays individually traceable');
    step('§54 partial conversions of 3.000 + 2.000 tracked separately, 3.000 g still available');

    await bringScrap('14', '5.000');
    const holdings14 = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const account14 = holdings14.holdings.find((row: any) => row.karat === '14' && row.warehouseId === furqanId);
    await ok(await api('/gold/used-conversions', 'POST', {
      goldAccountId: account14.goldAccountId, karat: '14', weightGrams: String(account14.availableGrams.toFixed(3)),
      name: 'ذهب مستعمل 14', category: 'متنوع', code: `FULL-${token}`, inventoryMode: 'aggregate', quantity: '1',
      managerNote: 'تحويل كامل', idempotencyKey: crypto.randomUUID(),
    }, managerCookie));
    const after14 = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const row14 = after14.holdings.find((row: any) => row.karat === '14' && row.warehouseId === furqanId);
    near(row14.availableGrams, 0, '§53 nothing left available');
    assert.equal(row14.fullyConverted, true);
    assert.ok(row14.receivedGrams > 0, '§7 the original receipt still shows in history');
    step('§7/§53 full conversion leaves 0 available while the original receipt stays visible');

    // ---------------------------------------------------------------- §56 concurrency
    await bringScrap('22', '10.000');
    const holdings22 = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const account22 = holdings22.holdings.find((row: any) => row.karat === '22' && row.warehouseId === furqanId);
    const race = (grams: string, code: string) => api('/gold/used-conversions', 'POST', {
      goldAccountId: account22.goldAccountId, karat: '22', weightGrams: grams,
      name: 'ذهب مستعمل 22', category: 'متنوع', code, inventoryMode: 'aggregate', quantity: '1',
      managerNote: 'سباق', idempotencyKey: crypto.randomUUID(),
    }, managerCookie);
    const available22 = account22.availableGrams;
    const [raceA, raceB] = await Promise.all([race(String((available22 * 0.7).toFixed(3)), `R1-${token}`), race(String((available22 * 0.5).toFixed(3)), `R2-${token}`)]);
    const committed = [raceA, raceB].filter(response => response.status === 201).length;
    assert.equal(committed, 1, 'Only one of two overlapping conversions may commit.');
    const after22 = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const row22 = after22.holdings.find((row: any) => row.karat === '22' && row.warehouseId === furqanId);
    assert.ok(row22.convertedGrams <= row22.receivedGrams + 0.0015, `converted ${row22.convertedGrams} must never exceed received ${row22.receivedGrams}`);
    assert.ok(row22.availableGrams >= -0.0015, 'available can never go negative');
    step('§38/§56 two overlapping conversions: exactly one committed, never more than the metal held');

    // ---------------------------------------------------------------- §40 reversal rules
    const sold = await ok(await api('/gold/used-conversions', 'GET', undefined, managerCookie), 200);
    const soldConversion = sold.items.find((row: any) => row.inventoryItemId === conversion.inventoryItemId);
    assert.equal(await status(await api(`/gold/used-conversions/${soldConversion.id}/reverse`, 'POST', { reason: 'محاولة تراجع بعد بيع' }, adminCookie)), 409);
    step('§40 a conversion whose stock was already sold refuses a destructive reversal');

    const fresh = await ok(await api('/gold/used-conversions', 'POST', convertBody('21', '0.750', `REV-${token}`), managerCookie));
    const reversed = await ok(await api(`/gold/used-conversions/${fresh.id}/reverse`, 'POST', { reason: 'خطأ في التقدير' }, adminCookie));
    assert.equal(reversed.status, 'reversed');
    const archived = (await sql`select archived_at from inventory_items where id = ${fresh.inventoryItemId}`)[0]!;
    assert.ok(archived.archived_at, '§41 the item is archived, never hard-deleted');
    const afterReverse = await ok(await api('/gold/holdings/scrap', 'GET', undefined, managerCookie), 200);
    const row21 = afterReverse.holdings.find((row: any) => row.karat === '21' && row.warehouseId === furqanId);
    near(row21.availableGrams, base21 + 10 - 6.75, 'the reversed grams returned to the scrap holding');
    step('§40/§41 an untouched conversion reverses cleanly: stock archived, grams back as scrap');

    // A seller may not reverse either.
    assert.equal(await status(await api(`/gold/used-conversions/${fresh.id}/reverse`, 'POST', { reason: 'محاولة' }, sellerCookie)), 403);
    step('§20 a seller cannot reverse a conversion');

    console.log('\nTASK 13 used-gold suite passed.');
  } finally {
    await sql.end();
    await app.close();
  }
}

await main();
