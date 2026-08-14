import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 09 operational verification: the required end-to-end gold scenario on a live
// server — a sale that takes scrap, the obligation a return creates, settlement in the
// same karat, a karat conversion, the statement, and reconciliation.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD!;
const port = 3012;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const balance = async (partnerId: string, karat: string) => ((await json(await api(`/gold/partners/${partnerId}`))).balances.find((row: any) => row.karat === karat)?.grams ?? 0);

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

    const customer = await ok(await api('/partners', 'POST', { name: `عميل ت9 ${token}`, type: 'customer' }));
    const trader = await ok(await api('/partners', 'POST', { name: `صائغ ت9 ${token}`, type: 'both' }));
    const stock = async (suffix: string) => ok(await api('/inventory', 'POST', { code: `T9-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));

    console.log('\n[1] A sale that takes 8.000 g of 21K scrap');
    const sale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id, items: [{ inventoryItemId: (await stock('a')).id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [{ karat: '21', weightGrams: '8.000', pricePerGramUSD: '75.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'gold_exchange', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const saleGold = await json(await api(`/gold/transactions?partnerId=${customer.id}`));
    assert.equal(saleGold.items.length, 1);
    const saleTransaction = await json(await api(`/gold/transactions/${saleGold.items[0].id}`));
    assert.equal(saleTransaction.lines.length, 2);
    assert.ok(saleTransaction.lines.every((line: any) => line.karat === '21'));
    assert.equal(await balance(customer.id, '21'), 0, 'the scrap value was credited on the invoice, so no weight is owed');
    step(`${sale.invoiceNumber} → ${saleTransaction.transactionNumber}: 8.000 g of 21K into the shop, customer balance flat`);

    console.log('[2] Returning the sale creates a weight obligation, not a cash refund');
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`));
    assert.equal(returnable.scrapGoldItems.length, 1, 'the return screen must be told what scrap the sale carried');
    const salesReturn = await ok(await api('/returns', 'POST', {
      type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: 'إرجاع كامل', exchangeRateSypPerUsd: RATE,
      items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
    }));
    assert.equal(await balance(customer.id, '21'), -8, 'the shop now owes 8.000 g of 21K');
    const cashMoved = await sql`select count(*)::int as n from cash_movements where return_invoice_id = ${salesReturn.id}`;
    assert.equal(cashMoved[0].n, 0, 'a gold obligation must never move cash');
    step(`${salesReturn.invoiceNumber}: shop owes 8.000 g of 21K, no cash moved`);

    console.log('[3] Settling part of it in the same karat');
    await ok(await api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '3.000', warehouseId, idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(customer.id, '21'), -5);
    assert.equal((await api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '6.000', warehouseId, idempotencyKey: crypto.randomUUID() })).status, 409, 'the shop cannot hand over more than it owes');
    step('3.000 g handed over, 5.000 g still owed, over-settlement refused');

    console.log('[4] Statement and per-karat running balance');
    const statement = await json(await api(`/gold/partners/${customer.id}/statement?limit=50`));
    assert.equal(statement.rows.length, 2, 'the obligation and the partial settlement');
    assert.equal(statement.rows[statement.rows.length - 1].runningBalanceGrams, -5);
    assert.ok(statement.rows.every((row: any) => row.transactionNumber && row.karat === '21'));
    step(`statement: ${statement.rows.map((row: any) => `${row.transactionNumber} ${row.runningBalanceGrams}`).join(' → ')}`);

    console.log('[5] Opening balance and a karat conversion for a trader');
    await ok(await api('/gold/opening', 'POST', { partnerId: trader.id, karat: '22', weightGrams: '12.000', direction: 'partner_owes_shop', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(trader.id, '22'), 12);
    // 12 g of 22K carries 11 g fine, which is 12.571 g of 21K.
    assert.equal((await api('/gold/conversion', 'POST', { partnerId: trader.id, fromKarat: '22', toKarat: '21', fromWeightGrams: '12.000', toWeightGrams: '12.000', idempotencyKey: crypto.randomUUID() })).status, 409);
    await ok(await api('/gold/conversion', 'POST', { partnerId: trader.id, fromKarat: '22', toKarat: '21', fromWeightGrams: '12.000', toWeightGrams: '12.571', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(trader.id, '22'), 0);
    assert.equal(await balance(trader.id, '21'), 12.571);
    step('12.000 g of 22K converted to 12.571 g of 21K, fine gold preserved');

    console.log('[6] Receiving the converted weight closes the trader account');
    await ok(await api('/gold/receipt', 'POST', { partnerId: trader.id, karat: '21', weightGrams: '12.571', warehouseId, idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(trader.id, '21'), 0);
    const traderSummary = await json(await api(`/gold/partners/${trader.id}`));
    assert.equal(traderSummary.balances.length, 0, 'a fully settled account carries no open karat');
    step('trader settled in full, no karat left open');

    console.log('[7] Nothing was rewritten: corrections are new transactions');
    const traderTransactions = await json(await api(`/gold/transactions?partnerId=${trader.id}`));
    assert.equal(traderTransactions.items.length, 3, 'opening, conversion and receipt each stand as their own transaction');
    assert.ok(traderTransactions.items.every((row: any) => row.status === 'posted'));
    const immutable = await sql`select count(*)::int as n from gold_ledger_entries e join gold_transactions t on t.id = e.gold_transaction_id where t.partner_id = ${trader.id}`;
    assert.equal(immutable[0].n, 6, 'three transactions, two sides each');
    step(`${traderTransactions.items.length} transactions / ${immutable[0].n} immutable ledger entries for the trader`);

    console.log('[8] Reconciliation across the whole ledger');
    const reconciliation = await json(await api('/gold/reconciliation'));
    assert.equal(reconciliation.salesExchanges.unposted, 0);
    assert.equal(reconciliation.transactions.unbalanced, 0);
    assert.ok(reconciliation.karatsBalanced);
    assert.ok(reconciliation.pureGoldBalanced);
    step(`${reconciliation.salesExchanges.posted}/${reconciliation.salesExchanges.total} scrap exchanges posted · ${reconciliation.transactions.total} transactions balanced · net fine gold ${reconciliation.netPureGoldGrams} g`);

    console.log('[9] Balances survive a backend restart');
    const before = await balance(customer.id, '21');
    await app.close();
    app = await createApp();
    await app.listen({ port, host: '127.0.0.1' });
    assert.equal(await balance(customer.id, '21'), before, 'a derived balance must be recomputed identically after a restart');
    step(`customer balance still ${before} g of 21K after restart`);

    console.log('\nTask 09 gold weight accounts verification passed.');
  } finally {
    await sql.end({ timeout: 5 });
    await app.close();
  }
}

void main().catch(error => { console.error('\nFAILED:', error?.message ?? error); process.exit(1); });
