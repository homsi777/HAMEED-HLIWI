import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// TASK 24: archiving a sold item used to make its sale impossible to cancel and impossible to
// return against — the item was unreachable from either direction, with no way back.
//
// Two halves are proved here. Archiving a piece that a posted sale still points at is now
// refused outright. And for the invoices already stuck in production, cancelling or returning
// lifts the stale archive as part of that decision, so the goods can come back.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3024;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

// The exact sentence Nabil saw in production. It must not come back for this scenario.
const OLD_RETURN_ERROR = 'The inventory record for a returned line has been archived and cannot receive the return.';

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) =>
  fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const app = await createApp();
await app.listen({ port, host: '127.0.0.1' });
const sql = postgres(appConfig().databaseUrl, { max: 1 });
try {
  const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
  warehouseId = warehouses[0].id;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
  cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
  assert.ok(cookie, 'admin login failed');

  const customer = await ok(await api('/partners', 'POST', { name: `عميل مرتجع ${token}`, type: 'customer' }));
  const stock = async (suffix: string) => ok(await api('/inventory', 'POST', { code: `T24-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));
  const sell = async (itemId: string) => ok(await api('/sales', 'POST', {
    warehouseId, customerId: customer.id,
    items: [{ inventoryItemId: itemId, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
    scrapGoldItems: [], discountUSD: '0', paidUSD: '1000.0000', paidSYP: '0',
    paymentMethod: 'cash_usd', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
  }));
  const itemRow = async (id: string) => (await sql`select status, archived_at from inventory_items where id = ${id}`)[0];
  const archiveDirectly = async (id: string) => sql`update inventory_items set archived_at = now(), version = version + 1 where id = ${id}`;
  step('signed in and fixtures created');

  // ---------------------------------------------------------------- §2.1 prevention
  const guarded = await stock('guard');
  const guardedSale = await sell(guarded.id);
  const refused = await api(`/inventory/${guarded.id}`, 'DELETE', { version: (await json(await api(`/inventory/${guarded.id}`))).version ?? 2 });
  const refusedBody = await json(refused);
  assert.equal(refused.status, 409, 'archiving an item on a posted sale must be refused');
  assert.ok(String(refusedBody.message).includes(guardedSale.invoiceNumber), `the refusal must name the blocking invoice: ${refusedBody.message}`);
  assert.ok(/لا يمكن حذف هذا الصنف/.test(String(refusedBody.message)), 'the refusal must be readable by the person who pressed the button');
  assert.equal((await itemRow(guarded.id)).archived_at, null, 'the item must still not be archived');
  step(`archiving a sold item refused, naming ${guardedSale.invoiceNumber}`);

  // ---------------------------------------------------------------- no regression
  const free = await stock('free');
  const freeVersion = (await json(await api(`/inventory/${free.id}`))).version;
  await ok(await api(`/inventory/${free.id}`, 'DELETE', { version: freeVersion }), 200);
  assert.ok((await itemRow(free.id)).archived_at, 'an item with no active sale must still archive');
  step('archiving an item with no active sale still works');

  // ---------------------------------------------------------------- §2.2 cancellation
  // Archived straight in the database: this is the state production is already in, created
  // before the guard above existed. The fix has to get those invoices moving again.
  const stuck = await stock('cancel');
  const stuckSale = await sell(stuck.id);
  await archiveDirectly(stuck.id);
  assert.ok((await itemRow(stuck.id)).archived_at, 'precondition: the item is archived');
  await ok(await api(`/sales/${stuckSale.id}/cancel`, 'POST', { reason: 'TASK 24 verification' }));
  const afterCancel = await itemRow(stuck.id);
  assert.equal(afterCancel.archived_at, null, 'cancelling must lift the stale archive');
  assert.equal(afterCancel.status, 'in_stock', 'the piece must be back on the shelf');
  step(`cancelled ${stuckSale.invoiceNumber} despite the archive — item back in stock`);

  // ---------------------------------------------------------------- §2.2 returns
  const returned = await stock('return');
  const returnedSale = await sell(returned.id);
  await archiveDirectly(returned.id);
  assert.ok((await itemRow(returned.id)).archived_at, 'precondition: the item is archived');
  const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${returnedSale.id}`));
  const created = await api('/returns', 'POST', {
    type: 'sales_return', originalInvoiceId: returnedSale.id, partnerId: customer.id,
    reason: 'TASK 24 verification', exchangeRateSypPerUsd: RATE,
    items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }],
    refundUSD: '1000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
  });
  const createdBody = await json(created);
  assert.notEqual(String(createdBody.message ?? ''), OLD_RETURN_ERROR, 'the production error text must not come back');
  assert.equal(created.status, 201, `the return must be accepted: ${JSON.stringify(createdBody)}`);
  const afterReturn = await itemRow(returned.id);
  assert.equal(afterReturn.archived_at, null, 'accepting the return must lift the stale archive');
  assert.equal(afterReturn.status, 'in_stock', 'the returned piece must be back on the shelf');
  step(`return ${createdBody.invoiceNumber ?? createdBody.returnNumber} accepted despite the archive — item back in stock`);

  // ---------------------------------------------------------------- the archive is not a free pass
  // Reviving only ever happens as part of a cancel or a return. Nothing else may do it, and the
  // guard now stands in the way of re-archiving while the sale is still live.
  const stillGuarded = await stock('guard2');
  const stillGuardedSale = await sell(stillGuarded.id);
  const secondRefusal = await api(`/inventory/${stillGuarded.id}`, 'DELETE', { version: (await json(await api(`/inventory/${stillGuarded.id}`))).version });
  assert.equal(secondRefusal.status, 409, 'the guard must hold for every sold item, not just the first');
  await ok(await api(`/sales/${stillGuardedSale.id}/cancel`, 'POST', { reason: 'TASK 24 cleanup' }));
  const freed = (await json(await api(`/inventory/${stillGuarded.id}`))).version;
  await ok(await api(`/inventory/${stillGuarded.id}`, 'DELETE', { version: freed }), 200);
  step('once the sale is cancelled the same item archives normally');

  console.log('\nTASK 24 — archived inventory no longer blocks cancellation or returns.');
} finally {
  await app.close();
  await sql.end();
}
