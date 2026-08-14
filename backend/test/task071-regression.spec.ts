import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 07.1 regression guard for the three defects the user hit in production:
// broken inventory images, an invoice item count of 0, and blank print rows.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3008;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined || body instanceof Uint8Array ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)) as any });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

// Smallest valid files each accepted type, so the upload path is exercised for real.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
    const customer = await ok(await api('/partners', 'POST', { name: `Regression customer ${token}`, type: 'customer' }));

    // ---------------------------------------------------------------- defect 1: images
    console.log('\n— inventory image contract —');
    for (const [label, bytes, type] of [['png', PNG, 'image/png'], ['jpeg', JPEG, 'image/jpeg']] as const) {
      const uploaded = await ok(await api('/inventory/images', 'POST', bytes, { 'content-type': type }));
      assert.ok(uploaded.imagePath && !uploaded.imagePath.includes('/'), 'upload must return a bare stored file name');
      const item = await ok(await api('/inventory', 'POST', { code: `IMG-${token}-${label}`, name: `Image item ${label}`, category: 'أطقم', karat: '21', grossWeightGrams: '5.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '1.0000', warehouseId, imagePath: uploaded.imagePath }));
      assert.ok(item.imageUrl.startsWith('/uploads/inventory/'), `imageUrl must use the public contract, got ${item.imageUrl}`);
      assert.match(item.imageUrl, /\?v=\d+$/, 'imageUrl must carry a version token so a stale cache cannot pin it');
      assert.equal(item.imageUrl.split('?')[0], `/uploads/inventory/${uploaded.imagePath}`);

      const served = await fetch(`http://127.0.0.1:${port}${item.imageUrl}`);
      assert.equal(served.status, 200, 'the published image URL must be served by the API process');
      assert.equal(served.headers.get('content-type'), type);
      assert.equal((await served.arrayBuffer()).byteLength, bytes.byteLength, 'served bytes must match the uploaded file');

      const listed = (await json(await api(`/inventory?page=1&limit=100&status=all`))).items.find((row: any) => row.id === item.id);
      assert.equal(listed.imageUrl, item.imageUrl, 'list and detail must publish the same image URL');
      step(`${label}: uploaded → stored → ${item.imageUrl.split('?')[0]} served ${bytes.byteLength} bytes as ${type}, identical in list and detail`);
    }
    assert.equal((await api('/inventory/images', 'POST', Buffer.from('not-an-image'), { 'content-type': 'text/plain' })).status >= 400, true);
    step('a non-image upload is rejected');

    // ---------------------------------------------------------------- defect 2: item count
    console.log('\n— invoice item count is the number of pieces sold —');
    const aggregate = await ok(await api('/inventory', 'POST', { code: `AGG-${token}`, name: `Aggregate ${token}`, category: 'ذهب كسر', karat: '21', inventoryMode: 'aggregate', quantity: '10.000', grossWeightGrams: '100.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));
    const individual = await ok(await api('/inventory', 'POST', { code: `IND-${token}`, name: `Individual ${token}`, category: 'أطقم', karat: '21', grossWeightGrams: '8.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));

    const oneAndOne = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [
      { inventoryItemId: individual.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
      { itemName: `يدوي ${token}`, category: 'متنوع', karat: '21', grossWeightGrams: '4.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
    ], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    const oneAndOneRow = (await json(await api(`/sales?invoiceNumber=${encodeURIComponent(oneAndOne.invoiceNumber)}&page=1&limit=5`))).items[0];
    assert.equal(oneAndOneRow.itemCount, 2, 'one inventory line plus one manual line must count as 2 pieces');
    assert.equal(oneAndOneRow.lineCount, 2);
    step(`inventory line (qty 1) + manual line (qty 1) → itemCount ${oneAndOneRow.itemCount}`);

    const multi = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [
      { inventoryItemId: aggregate.id, quantity: '2.000', soldWeightGrams: '20.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
    ], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    const multiRow = (await json(await api(`/sales?invoiceNumber=${encodeURIComponent(multi.invoiceNumber)}&page=1&limit=5`))).items[0];
    assert.equal(multiRow.itemCount, 2, 'an aggregate line selling 2 pieces must count as 2, not as 1 row');
    assert.equal(multiRow.lineCount, 1);
    step(`aggregate line selling 2 pieces on 1 row → itemCount ${multiRow.itemCount}, lineCount ${multiRow.lineCount}`);

    const purchase = await ok(await api('/purchases', 'POST', { warehouseId, supplierId: (await ok(await api('/partners', 'POST', { name: `Regression supplier ${token}`, type: 'supplier' }))).id, items: [
      { itemName: `شراء أ ${token}`, code: `RP1-${token}`, category: 'متنوع', karat: '21', quantity: '2.000', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', pricePerGramUSD: '80.0000', laborFeeUSDPerGram: '0.0000' },
      { itemName: `شراء ب ${token}`, code: `RP2-${token}`, category: 'متنوع', karat: '21', quantity: '3.000', grossWeightGrams: '15.000', stoneWeightGrams: '0.000', pricePerGramUSD: '80.0000', laborFeeUSDPerGram: '0.0000' },
    ], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    const purchaseRow = (await json(await api(`/purchases?purchaseNumber=${encodeURIComponent(purchase.invoiceNumber)}&page=1&limit=5`))).items[0];
    assert.equal(purchaseRow.itemCount, 5, 'quantities 2 and 3 must total 5 pieces');
    step(`purchase lines of 2 and 3 pieces → itemCount ${purchaseRow.itemCount}`);

    // ---------------------------------------------------------------- defect 3: print payload
    console.log('\n— invoice detail carries every field the printed sheet needs —');
    const printable = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [
      { inventoryItemId: aggregate.id, quantity: '1.000', soldWeightGrams: '12.500', pricePerGramUSD: '110.0000', laborFeeUSDPerGram: '3.0000' },
      { itemName: `قطعة يدوية ${token}`, category: 'خواتم ومحابس', karat: '18', grossWeightGrams: '6.400', stoneWeightGrams: '0.400', pricePerGramUSD: '95.0000', laborFeeUSDPerGram: '7.0000' },
    ], scrapGoldItems: [{ karat: '21', weightGrams: '3.000', pricePerGramUSD: '70.0000' }], discountUSD: '5.0000', paidUSD: '100.0000', paidSYP: '650000.00', paymentMethod: 'mixed', exchangeRateSypPerUsd: RATE, notes: 'فاتورة اختبار الطباعة', idempotencyKey: crypto.randomUUID() }));

    const listRow = (await json(await api(`/sales?invoiceNumber=${encodeURIComponent(printable.invoiceNumber)}&page=1&limit=5`))).items[0];
    assert.equal(listRow.itemCount, 2);
    const detail = await json(await api(`/sales/${printable.id}`));
    assert.equal(detail.items.length, 2, 'the detail document must return every saved line');
    for (const line of detail.items) {
      for (const field of ['itemName', 'category', 'karat', 'quantity', 'grossWeightGrams', 'stoneWeightGrams', 'netWeightGrams', 'pricePerGramUSD', 'laborFeeUSDPerGram', 'totalPriceUSD']) {
        assert.ok(line[field] !== undefined && line[field] !== null && line[field] !== '', `printed line is missing ${field}`);
      }
      assert.ok(Number(line.quantity) > 0 && Number(line.netWeightGrams) > 0 && Number(line.totalPriceUSD) > 0);
    }
    assert.ok(detail.items.some((line: any) => line.itemId), 'the inventory-sourced line must survive');
    assert.ok(detail.items.some((line: any) => line.itemName.includes('قطعة يدوية')), 'the manual line must not be filtered out');
    assert.equal(detail.scrapGoldItems.length, 1);
    assert.equal(detail.paidSYP, 650000); assert.equal(detail.discountUSD, 5);
    step(`detail returns ${detail.items.length} printable lines (inventory + manual), scrap, discount and both paid currencies`);

    // ---------------------------------------------------------------- invoice attachment
    console.log('\n— invoice documentation image —');
    const photo = `data:image/png;base64,${PNG.toString('base64')}`;
    const withPhoto = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ itemName: `صورة ${token}`, category: 'متنوع', karat: '21', grossWeightGrams: '2.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, itemPhotoUrl: photo, idempotencyKey: crypto.randomUUID() }));
    assert.equal(withPhoto.itemPhotoUrl, photo, 'the attached documentation image must be returned on create');
    const storedPhoto = await sql`select item_photo_data from sales_invoices where id = ${withPhoto.id}`;
    assert.equal(storedPhoto[0]!.item_photo_data, photo, 'it must be persisted in PostgreSQL');
    assert.equal((await json(await api(`/sales/${withPhoto.id}`))).itemPhotoUrl, photo, 'and returned again by the detail endpoint');
    step('invoice attachment persisted and returned on reload');

    // ---------------------------------------------------------------- persistence
    console.log('\n— survives a restart —');
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
    app = await createApp(); await app.listen({ port, host: '127.0.0.1' });
    const afterRestart = await json(await api(`/sales/${printable.id}`));
    assert.equal(afterRestart.items.length, 2);
    const imageAfterRestart = (await json(await api(`/inventory?page=1&limit=100&status=all`))).items.find((row: any) => row.code === `IMG-${token}-jpeg`);
    const reserved = await fetch(`http://127.0.0.1:${port}${imageAfterRestart.imageUrl}`);
    assert.equal(reserved.status, 200);
    step('invoice lines and product images still resolve after a backend restart');

    console.log('\nTask 07.1 regression checks passed.\n');
  } finally {
    await sql.end();
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
