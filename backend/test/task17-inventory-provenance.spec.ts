import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 17 §B: every inventory item must say how it entered the system.
//
// §12 requires this to come from records that already exist — there is no migration and no new
// column. The rule lives in one place on the server (§13) and reads the *first* movement, so a
// later transfer can never overwrite where a piece actually came from (§14).
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3019;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const otherWarehouseId = warehouses.find((row: any) => row.id !== warehouseId)?.id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

    const find = async (code: string) => {
      const page = await json(await api(`/inventory?search=${encodeURIComponent(code)}&status=all&limit=20`));
      return page.items.find((row: any) => row.code === code);
    };

    // ---------------------------------------------------------------- purchase
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد مصدر ${token}`, type: 'supplier' }));
    const purchaseCode = `T17SRC-PUR-${token}`;
    const purchase = await ok(await api('/purchases', 'POST', {
      warehouseId, supplierId: supplier.id,
      items: [{ itemName: `صنف مشترى ${token}`, code: purchaseCode, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '20.000', stoneWeightGrams: '0.000', pricePerGramUSD: '80.0000', laborFeeUSDPerGram: '0.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const purchased = await find(purchaseCode);
    assert.equal(purchased.origin, 'purchase', `expected origin "purchase", got "${purchased.origin}"`);
    assert.equal(purchased.sourceDocumentNumber, purchase.invoiceNumber, 'the purchase number must be the source reference');
    assert.equal(purchased.sourceDescription, `من فاتورة شراء ${purchase.invoiceNumber}`);
    step(`§12 purchase → "${purchased.sourceDescription}"`);

    // ---------------------------------------------------------------- §14 transfer must not win
    if (otherWarehouseId) {
      await sql`insert into inventory_movements (inventory_item_id, type, from_warehouse_id, to_warehouse_id, actor_user_id, note)
                select ${purchased.id}, 'transfer', ${warehouseId}, ${otherWarehouseId}, created_by_user_id, ${'transfer probe'} from inventory_items where id = ${purchased.id}`;
      const afterTransfer = await find(purchaseCode);
      assert.equal(afterTransfer.origin, 'purchase', '§14 a later transfer must not become the origin');
      assert.equal(afterTransfer.sourceDocumentNumber, purchase.invoiceNumber, '§14 the original purchase reference must survive the transfer');
      step('§14 origin survives a later transfer — movement history is not provenance');
    }

    // ---------------------------------------------------------------- direct entry
    const directCode = `T17SRC-DIR-${token}`;
    await ok(await api('/inventory', 'POST', { code: directCode, name: `صنف مباشر ${token}`, category: 'متنوع', karat: '21', grossWeightGrams: '5.000', stoneWeightGrams: '0.000', netWeightGrams: '5.000', warehouseId, quantity: '1.000' }));
    const direct = await find(directCode);
    assert.equal(direct.origin, 'direct', `expected origin "direct", got "${direct.origin}"`);
    assert.equal(direct.sourceDescription, 'إدخال مباشر للمخزون');
    step('§12 direct entry → "إدخال مباشر للمخزون"');

    // ---------------------------------------------------------------- historical manual sale
    const customer = await ok(await api('/partners', 'POST', { name: `زبون مصدر ${token}`, type: 'customer' }));
    const manualSale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id,
      items: [{ itemName: `قطعة تاريخية ${token}`, category: 'متنوع', karat: '21', quantity: '1', grossWeightGrams: '8.250', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const historical = await find(`MANUAL-SALE-${manualSale.invoiceNumber}-1`);
    assert.ok(historical, 'the historical record must be findable');
    assert.equal(historical.origin, 'historical', `expected origin "historical", got "${historical.origin}"`);
    assert.equal(historical.sourceDocumentNumber, manualSale.invoiceNumber, 'the sale that recorded it must be the reference');
    assert.equal(historical.sourceDescription, `من فاتورة بيع ${manualSale.invoiceNumber}`);
    // §16: red belongs to the negative quantity, and provenance must not have overwritten it.
    assert.ok(historical.quantity < 0 && historical.netWeightGrams < 0, '§16 the historical record is still the approved negative row');
    step(`§12/§16 historical → "${historical.sourceDescription}", still a negative row`);

    // ---------------------------------------------------------------- §18 the origin filter
    for (const [origin, expected] of [['purchase', purchaseCode], ['direct', directCode]] as const) {
      const filtered = await json(await api(`/inventory?origin=${origin}&status=all&limit=100&search=T17SRC-`));
      assert.ok(filtered.items.length > 0, `the ${origin} filter must return rows`);
      assert.ok(filtered.items.every((row: any) => row.origin === origin), `the ${origin} filter must return only that origin`);
      assert.ok(filtered.items.some((row: any) => row.code === expected), `the ${origin} filter must include the item created for it`);
    }
    const historicalOnly = await json(await api('/inventory?origin=historical&status=all&limit=50'));
    assert.ok(historicalOnly.items.every((row: any) => row.origin === 'historical'), 'the historical filter must return only historical rows');
    const allOrigins = await json(await api('/inventory?origin=all&status=all&limit=100&search=T17SRC-'));
    assert.ok(allOrigins.items.length >= 2, '"all" must not filter anything out');
    step('§18 the origin filter is applied on the server, so it survives pagination');

    // §13: every row carries a derived origin — no item is left unexplained.
    const everything = await json(await api('/inventory?status=all&limit=100'));
    assert.ok(everything.items.every((row: any) => ['purchase', 'direct', 'historical', 'used_gold'].includes(row.origin)), 'every item must carry one of the four origins');
    assert.ok(everything.items.every((row: any) => typeof row.sourceDescription === 'string' && row.sourceDescription.length > 0), 'every item must carry a source description');
    step(`§13 all ${everything.items.length} items on the page carry a derived origin and description`);

    console.log('\nTASK 17 inventory provenance suite passed.');
  } finally {
    await sql.end();
    await app.close();
  }
}

await main();
