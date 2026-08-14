import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 09.1: the four defects Nabil hit in production.
//   A — an aggregate sale did not deduct the weight
//   B — a manual sale item never showed up in Inventory
//   C — scrap taken in on a sale was not visible as physical gold
//   D — the mobile invoice preview rendered two stacked surfaces (checked in the UI build)
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD!;
const port = 3013;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const item = async (id: string) => json(await api(`/inventory/${id}`));

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 2 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
    const customer = await ok(await api('/partners', 'POST', { name: `عميل ت9.1 ${token}`, type: 'customer' }));

    console.log('\n[A] Aggregate sale deducts exactly the sold weight');
    const aggregate = await ok(await api('/inventory', 'POST', { code: `AGG-${token}`, name: 'test aggregate jewelry', category: 'أطقم', karat: '21', inventoryMode: 'aggregate', grossWeightGrams: '1250.000', stoneWeightGrams: '0.000', quantity: '0', laborFeeUSDPerGram: '0.0000', warehouseId }));
    assert.equal(aggregate.netWeightGrams, 1250);

    // The exact payload the invoice screen now sends: the stock reference is `itemId`.
    const sale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [
        { itemId: aggregate.id, soldWeightGrams: 12, quantity: 1, itemName: 'test aggregate jewelry', category: 'أطقم', karat: '21', grossWeightGrams: 12, stoneWeightGrams: 0, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
        { itemName: 'قطعة يدوية', category: 'خواتم ومحابس', karat: '21', grossWeightGrams: '8.250', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
      ],
      scrapGoldItems: [{ karat: '21', weightGrams: '9.100', pricePerGramUSD: '121.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const afterSale = await item(aggregate.id);
    assert.equal(afterSale.netWeightGrams, 1238, `1250 - 12 must be 1238, got ${afterSale.netWeightGrams}`);
    assert.equal(afterSale.grossWeightGrams, 1238);
    assert.equal(afterSale.quantity, -1, 'the approved transitional negative quantity is preserved');
    assert.equal(afterSale.status, 'in_stock', 'an aggregate item with weight left must stay sellable');
    step(`${sale.invoiceNumber}: 1250.000 − 12.000 = ${afterSale.netWeightGrams.toFixed(3)} g, item still in stock`);

    // The line must be recorded as a stock line, not silently downgraded to a manual one.
    const lineTypes = await sql`select line_type, inventory_item_id from sales_invoice_items where sales_invoice_id = ${sale.id} order by line_number`;
    assert.equal(lineTypes[0].line_type, 'stock', 'a sale against stock must be a stock line');
    assert.equal(lineTypes[0].inventory_item_id, aggregate.id);
    assert.equal(lineTypes[1].line_type, 'manual');
    step('line 1 recorded as stock and linked to the inventory item; line 2 as manual');

    console.log('[A] The movement agrees with the row');
    const movement = (await sql`select type, metadata from inventory_movements where inventory_item_id = ${aggregate.id} and type = 'sale' order by created_at desc limit 1`)[0];
    assert.ok(movement, 'an aggregate sale must leave an immutable movement');
    assert.equal(Number(movement.metadata.beforeNetWeightGrams), 1250);
    assert.equal(Number(movement.metadata.afterNetWeightGrams), 1238);
    assert.equal(movement.metadata.netWeightDeltaGrams, '-12.000');
    assert.equal(movement.metadata.quantityDelta, '-1.000');
    step(`movement: before ${movement.metadata.beforeNetWeightGrams} → delta ${movement.metadata.netWeightDeltaGrams} → after ${movement.metadata.afterNetWeightGrams}`);

    console.log('[A] Two sellers cannot both take the last of the weight');
    const scarce = await ok(await api('/inventory', 'POST', { code: `AGG2-${token}`, name: 'scarce aggregate', category: 'أطقم', karat: '21', inventoryMode: 'aggregate', grossWeightGrams: '20.000', stoneWeightGrams: '0.000', quantity: '0', laborFeeUSDPerGram: '0.0000', warehouseId }));
    const race = (weight: number) => api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ itemId: scarce.id, soldWeightGrams: weight, quantity: 1, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() });
    const [a, b] = await Promise.all([race(12), race(10)]);
    const accepted = [a, b].filter(response => response.status === 201).length;
    assert.equal(accepted, 1, `only one of 12 g + 10 g out of 20 g may commit, ${accepted} did`);
    const afterRace = await item(scarce.id);
    assert.ok(afterRace.netWeightGrams === 8 || afterRace.netWeightGrams === 10, `remaining weight must be 8 or 10, got ${afterRace.netWeightGrams}`);
    step(`concurrent sale admitted exactly one writer; ${afterRace.netWeightGrams.toFixed(3)} g left of 20.000`);

    console.log('[B] The manual line is visible in Inventory as a historical record');
    const manualRow = (await sql`select i.* from inventory_items i join sales_invoice_items l on l.inventory_item_id = i.id where l.sales_invoice_id = ${sale.id} and l.line_type = 'manual'`)[0];
    assert.ok(manualRow, 'a manual sale line must persist an inventory record');
    assert.equal(Number(manualRow.quantity), -1);
    assert.equal(Number(manualRow.net_weight_grams), -8.25);
    assert.equal(manualRow.is_manual_sale_entry, true);
    assert.equal(manualRow.warehouse_id, warehouseId);
    // The screen lists everything the API returns for status=all, and now keeps the
    // historical rows instead of filtering them out with the sellable-stock filter.
    const listed = await json(await api(`/inventory?status=all&limit=100&search=${encodeURIComponent('قطعة يدوية')}`));
    const visible = listed.items.find((row: any) => row.id === manualRow.id);
    assert.ok(visible, 'the historical record must come back from the inventory API');
    assert.equal(visible.isManualSaleEntry, true, 'the API must expose the flag the badge is drawn from');
    assert.equal(visible.netWeightGrams, -8.25);
    step(`historical record ${manualRow.code}: quantity ${Number(manualRow.quantity)}, weight ${Number(manualRow.net_weight_grams)} g, visible through the API`);

    console.log('[C] The scrap is visible as physical gold, marked as an exchange');
    const holdings = await json(await api('/gold/holdings?limit=20'));
    const branch = holdings.accounts.find((account: any) => account.warehouseId === warehouseId);
    assert.ok(branch, 'the branch must have a physical gold account');
    const karat21 = branch.balances.find((row: any) => row.karat === '21');
    assert.ok(karat21 && karat21.scrapGrams >= 9.1, `the 9.100 g of scrap must show as held metal, got ${JSON.stringify(karat21)}`);
    const exchange = holdings.movements.find((row: any) => row.sourceNumber === sale.invoiceNumber);
    assert.ok(exchange, 'the holding movement must be traceable to the sale');
    assert.equal(exchange.source, 'scrap_exchange', 'the source is what the screen badges as كسر مقايضة');
    assert.equal(exchange.karat, '21');
    assert.equal(exchange.inGrams, 9.1);
    assert.ok(exchange.salesGoldExchangeId, 'the movement must point at the exchange row it came from');
    assert.equal(exchange.pureGoldGrams, 7.9625);
    step(`holding: ${exchange.inGrams.toFixed(3)} g 21K from ${exchange.sourceNumber}, source=${exchange.source}, ${exchange.pureGoldGrams} g fine`);

    console.log('[C] The exchange moved metal, not cash, and posted only once');
    const cash = await sql`select count(*)::int as n from cash_movements where sales_invoice_id = ${sale.id}`;
    assert.equal(cash[0].n, 0, 'a debt sale with scrap must not move cash');
    const postings = await sql`select count(*)::int as n from gold_transactions where source_type = 'sale' and source_id = ${sale.id}`;
    assert.equal(postings[0].n, 1, 'exactly one gold transaction per exchange');
    const goldReconciliation = await json(await api('/gold/reconciliation'));
    assert.equal(goldReconciliation.salesExchanges.unposted, 0);
    assert.ok(goldReconciliation.pureGoldBalanced);
    step(`no cash movement · 1 gold transaction · reconciliation clean (${goldReconciliation.salesExchanges.posted}/${goldReconciliation.salesExchanges.total})`);

    console.log('[Regression] Accounting still balances');
    const trial = await json(await api('/accounting/trial-balance'));
    assert.ok(trial.balanced, `trial balance must stay balanced: ${trial.totalDebitUSD} vs ${trial.totalCreditUSD}`);
    step(`trial balance balanced at $${Number(trial.totalDebitUSD).toFixed(2)}`);

    console.log('[Persistence] Effects survive a restart');
    await app.close();
    app = await createApp();
    await app.listen({ port, host: '127.0.0.1' });
    const restored = await item(aggregate.id);
    assert.equal(restored.netWeightGrams, 1238);
    const restoredHoldings = await json(await api('/gold/holdings?limit=20'));
    assert.ok(restoredHoldings.movements.some((row: any) => row.sourceNumber === sale.invoiceNumber));
    step('aggregate weight and the physical holding both survived the restart');

    console.log('\nTask 09.1 regression checks passed.');
  } finally {
    await sql.end({ timeout: 5 });
    await app.close();
  }
}

void main().catch(error => { console.error('\nFAILED:', error?.message ?? error); process.exit(1); });
