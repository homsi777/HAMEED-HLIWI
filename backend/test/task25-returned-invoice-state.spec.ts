import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// TASK 25: a sale that has been returned must say so on screen.
//
// The invoice row itself is never rewritten — sales_invoice_status only has posted/cancelled,
// and a posted document is a fact, not a mutable record. So the state is derived from the
// return documents pointing at the invoice, and this proves the derivation is right in all
// three cases: untouched, partly returned, fully returned.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3025;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const app = await createApp();
await app.listen({ port, host: '127.0.0.1' });
try {
  const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
  warehouseId = warehouses[0].id;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
  cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
  assert.ok(cookie, 'admin login failed');

  const customer = await ok(await api('/partners', 'POST', { name: `عميل حالة ${token}`, type: 'customer' }));
  const stock = async (suffix: string) => ok(await api('/inventory', 'POST', { code: `T25-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));

  const first = await stock('a');
  const second = await stock('b');
  // Sold on credit, so the outstanding balance has somewhere to move when the goods come back.
  const sale = await ok(await api('/sales', 'POST', {
    warehouseId, customerId: customer.id,
    items: [
      { inventoryItemId: first.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
      { inventoryItemId: second.id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' },
    ],
    scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0',
    paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
  }));
  assert.equal(sale.finalTotalUSD, 2000, 'fixture assumption: two 10 g lines at $100/g');
  step(`sale ${sale.invoiceNumber} posted on credit — $${sale.finalTotalUSD}, remaining $${sale.remainingDebtUSD}`);

  const detail = async () => json(await api(`/sales/${sale.id}`));
  const listed = async () => {
    const page = await json(await api(`/sales?invoiceNumber=${sale.invoiceNumber}&limit=5`));
    const row = page.items.find((item: any) => item.id === sale.id);
    assert.ok(row, 'the invoice must be in the list');
    return row;
  };

  // ---------------------------------------------------------------- nothing returned yet
  for (const [where, row] of [['detail', await detail()], ['list', await listed()]] as const) {
    assert.equal(row.returnedState, 'none', `${where}: an untouched sale must not read as returned`);
    assert.equal(row.returnedValueUSD, 0, `${where}: nothing returned yet`);
    assert.equal(row.remainingDebtUSD, 2000, `${where}: the full amount is still owed`);
  }
  step('untouched sale reads as none, $2000 still owed');

  // ---------------------------------------------------------------- one line back
  const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`));
  const partial = await ok(await api('/returns', 'POST', {
    type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id,
    reason: 'TASK 25 partial', exchangeRateSypPerUsd: RATE,
    items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }],
    refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
  }));
  for (const [where, row] of [['detail', await detail()], ['list', await listed()]] as const) {
    assert.equal(row.returnedState, 'partial', `${where}: one of two lines back is a partial return`);
    assert.equal(row.returnedValueUSD, 1000, `${where}: half the value has come back`);
    assert.equal(row.returnCount, 1, `${where}: one return document`);
    assert.equal(row.remainingDebtUSD, 1000, `${where}: the returned half must come off what is owed`);
  }
  step(`return ${partial.invoiceNumber ?? partial.returnNumber} → partial, owed drops to $1000`);

  // ---------------------------------------------------------------- the rest back
  const rest = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`));
  const remainingLine = rest.lines.find((line: any) => Number(line.remainingQuantity ?? line.quantity) > 0);
  assert.ok(remainingLine, 'the second line must still be returnable');
  await ok(await api('/returns', 'POST', {
    type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id,
    reason: 'TASK 25 full', exchangeRateSypPerUsd: RATE,
    items: [{ sourceLineId: remainingLine.sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }],
    refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
  }));
  for (const [where, row] of [['detail', await detail()], ['list', await listed()]] as const) {
    assert.equal(row.returnedState, 'full', `${where}: everything is back`);
    assert.equal(row.returnedValueUSD, 2000, `${where}: the whole invoice value returned`);
    assert.equal(row.returnCount, 2, `${where}: two return documents`);
    assert.equal(row.remainingDebtUSD, 0, `${where}: nothing can still be owed on a fully returned sale`);
    assert.equal(row.status, 'posted', `${where}: the invoice itself is still a posted fact`);
  }
  step('second return → full, owed $0, and the invoice is still posted');

  console.log('\nTASK 25 — a returned sale now says so, on the card and in the detail.');
} finally {
  await app.close();
}
