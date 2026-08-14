import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 09: gold weight accounts. Every case follows metal, not money — grams at a stated
// karat, never merged across karats, always traceable back to the document that caused it.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3011;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let salesCookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const balance = async (partnerId: string, karat: string) => {
  const summary = await json(await api(`/gold/partners/${partnerId}`));
  return summary.balances.find((row: any) => row.karat === karat)?.grams ?? 0;
};
// Every gold transaction must balance in PURE gold — checked after each phase.
const assertAllBalanced = async (sql: any, label: string) => {
  const broken = await sql`
    select t.transaction_number
    from gold_transactions t join gold_ledger_entries e on e.gold_transaction_id = t.id
    group by t.id, t.transaction_number
    having round(sum(case when e.debit_grams > 0 then e.pure_gold_grams else 0 end), 3)
        <> round(sum(case when e.credit_grams > 0 then e.pure_gold_grams else 0 end), 3)`;
  assert.equal(broken.length, 0, `${label}: unbalanced gold transactions ${broken.map((r: any) => r.transaction_number).join(', ')}`);
  const wrongPurity = await sql`select id from gold_ledger_entries where round((greatest(debit_grams, credit_grams) * karat::numeric / 24), 4) <> pure_gold_grams`;
  assert.equal(wrongPurity.length, 0, `${label}: ${wrongPurity.length} ledger entries have a wrong pure-gold equivalent`);
};

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 2 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
    const salesLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'furqan_sales_dev', password, warehouseId }) }) as ResponseWithCookies;
    salesCookie = salesLogin.status === 201 ? (salesLogin.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ') : '';

    console.log('\n— access control —');
    assert.equal((await fetch(`${base}/gold/accounts`)).status, 401);
    assert.equal((await fetch(`${base}/gold/receipt`, { method: 'POST' })).status, 401);
    if (salesCookie) {
      assert.equal((await api('/gold/accounts', 'GET', undefined, salesCookie)).status, 200);
      assert.equal((await api('/gold/receipt', 'POST', {}, salesCookie)).status, 403);
      assert.equal((await api('/gold/conversion', 'POST', {}, salesCookie)).status, 403);
      step('unauthenticated rejected; a sales user may read gold accounts but not move weight');
    }

    const customer = await ok(await api('/partners', 'POST', { name: `عميل ذهب ${token}`, type: 'customer' }));
    const stock = async (suffix: string, karat = '21') => ok(await api('/inventory', 'POST', { code: `GLD-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat, grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));

    console.log('\n— a sale that takes scrap gold —');
    // Measured as a delta so the suite can run repeatedly against the same database.
    const holding = async () => Number((await sql`
      select coalesce(sum(e.debit_grams - e.credit_grams), 0) as grams from gold_ledger_entries e
      join gold_accounts a on a.id = e.gold_account_id
      where a.kind = 'company' and a.system_code is null and a.warehouse_id = ${warehouseId} and e.karat = '21'`)[0].grams);
    const holdingBefore = await holding();
    const sale = await ok(await api('/sales', 'POST', {
      warehouseId, customerId: customer.id, items: [{ inventoryItemId: (await stock('a')).id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }],
      scrapGoldItems: [{ karat: '21', weightGrams: '5.000', pricePerGramUSD: '80.0000' }],
      discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'gold_exchange', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    }));
    const saleTransactions = await json(await api(`/gold/transactions?partnerId=${customer.id}`));
    assert.equal(saleTransactions.items.length, 1, 'the sale should have produced exactly one gold transaction');
    assert.equal(saleTransactions.items[0].type, 'sale_exchange');
    assert.equal(saleTransactions.items[0].sourceNumber, sale.invoiceNumber);
    step(`sale ${sale.invoiceNumber} posted gold transaction ${saleTransactions.items[0].transactionNumber}`);

    // The value of the scrap was already credited on the invoice, so the customer is not
    // separately owed 5 g on top of it — the partner account must be flat.
    assert.equal(await balance(customer.id, '21'), 0, 'scrap paid on an invoice must not leave a partner obligation');
    assert.equal(await holding() - holdingBefore, 5, 'the branch should physically hold the 5 g it took in');
    step('scrap landed in the branch holding and left the customer at zero');
    await assertAllBalanced(sql, 'after sale');

    console.log('\n— returning that sale —');
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`));
    const salesReturn = await ok(await api('/returns', 'POST', {
      type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: 'إرجاع كامل', exchangeRateSypPerUsd: RATE,
      items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID(),
    }));
    assert.equal(await balance(customer.id, '21'), -5, 'after a full return the shop owes the customer the 5 g back');
    const returnTransactions = await json(await api(`/gold/transactions?partnerId=${customer.id}&type=sales_return_obligation`));
    assert.equal(returnTransactions.items.length, 1);
    assert.equal(returnTransactions.items[0].sourceNumber, salesReturn.invoiceNumber);
    step(`return ${salesReturn.invoiceNumber} left the shop owing 5.000 g of 21K, no metal moved`);
    await assertAllBalanced(sql, 'after return');

    console.log('\n— settling the obligation —');
    const overPay = await api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '9.000', warehouseId, idempotencyKey: crypto.randomUUID() });
    assert.equal(overPay.status, 409, 'handing over more than the shop owes must be refused');
    const wrongKarat = await api('/gold/payment', 'POST', { partnerId: customer.id, karat: '18', weightGrams: '1.000', warehouseId, idempotencyKey: crypto.randomUUID() });
    assert.equal(wrongKarat.status, 409, 'a karat the partner has no balance in must not be settled by accident');
    step('over-settlement and wrong-karat settlement are both refused');

    const paymentKey = crypto.randomUUID();
    const payment = await ok(await api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '2.000', warehouseId, idempotencyKey: paymentKey, note: 'تسليم جزئي' }));
    assert.equal(await balance(customer.id, '21'), -3);
    const replay = await ok(await api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '2.000', warehouseId, idempotencyKey: paymentKey }), 201);
    assert.equal(replay.id, payment.id, 'the same idempotency key must return the same transaction');
    assert.equal(await balance(customer.id, '21'), -3, 'a replayed request must not move metal twice');
    step('partial payment recorded once; the replay returned the same transaction');

    // Two cashiers settling the same obligation at the same moment: the row lock must make
    // one of them lose, rather than letting both succeed and overdraw the balance.
    const concurrent = await Promise.all([
      api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '3.000', warehouseId, idempotencyKey: crypto.randomUUID() }),
      api('/gold/payment', 'POST', { partnerId: customer.id, karat: '21', weightGrams: '3.000', warehouseId, idempotencyKey: crypto.randomUUID() }),
    ]);
    const accepted = concurrent.filter(response => response.status === 201).length;
    assert.equal(accepted, 1, `exactly one concurrent settlement should succeed, ${accepted} did`);
    assert.equal(await balance(customer.id, '21'), 0, 'the obligation is now fully settled');
    step('concurrent settlement of the same obligation admitted exactly one writer');
    await assertAllBalanced(sql, 'after settlement');

    console.log('\n— opening balances, receipts and karat conversion —');
    const other = await ok(await api('/partners', 'POST', { name: `صائغ ${token}`, type: 'both' }));
    await ok(await api('/gold/opening', 'POST', { partnerId: other.id, karat: '21', weightGrams: '10.000', direction: 'partner_owes_shop', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(other.id, '21'), 10);

    const unequal = await api('/gold/conversion', 'POST', { partnerId: other.id, fromKarat: '21', toKarat: '18', fromWeightGrams: '10.000', toWeightGrams: '10.000', idempotencyKey: crypto.randomUUID() });
    assert.equal(unequal.status, 409, 'a conversion that creates or destroys fine gold must be refused');
    const nothingToConvert = await api('/gold/conversion', 'POST', { partnerId: other.id, fromKarat: '14', toKarat: '18', fromWeightGrams: '10.000', toWeightGrams: '7.778', idempotencyKey: crypto.randomUUID() });
    assert.equal(nothingToConvert.status, 409, 'a karat with no balance has nothing to convert');
    // 10 g of 21K carries 8.75 g fine, which is 11.667 g of 18K.
    await ok(await api('/gold/conversion', 'POST', { partnerId: other.id, fromKarat: '21', toKarat: '18', fromWeightGrams: '10.000', toWeightGrams: '11.667', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(other.id, '21'), 0);
    assert.equal(await balance(other.id, '18'), 11.667);
    step('conversion 21K → 18K preserved the fine gold and kept the karats separate');

    const summary = await json(await api(`/gold/partners/${other.id}`));
    assert.ok(!summary.balances.some((row: any) => row.karat === '21'), 'a settled karat must not linger in the balance');
    // 11.667 g of 18K is the closest milligram to 8.75 g fine, so the total carries the
    // same tiny rounding a real conversion does.
    assert.ok(Math.abs(summary.pureGoldTotalGrams - 8.75) < 0.001, `pure-gold total ${summary.pureGoldTotalGrams} should be ≈8.75 g`);

    await ok(await api('/gold/receipt', 'POST', { partnerId: other.id, karat: '18', weightGrams: '11.667', warehouseId, idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balance(other.id, '18'), 0);
    step('receiving the converted weight closed the account');
    await assertAllBalanced(sql, 'after conversion');

    console.log('\n— statement —');
    const statement = await json(await api(`/gold/partners/${other.id}/statement?limit=100`));
    assert.equal(statement.rows.length, 4, 'opening, both conversion sides and the receipt must all appear');
    assert.ok(statement.rows.every((row: any) => row.transactionNumber && row.description));
    const karat18 = statement.rows.filter((row: any) => row.karat === '18');
    assert.equal(karat18[karat18.length - 1].runningBalanceGrams, 0, 'the running balance is tracked per karat and ends at zero');
    step('statement shows every movement with a per-karat running balance');

    console.log('\n— reversal and cancellation —');
    const manual = await ok(await api('/gold/receipt', 'POST', { partnerId: other.id, karat: '22', weightGrams: '4.000', warehouseId, idempotencyKey: crypto.randomUUID(), allowReverseBalance: true }));
    assert.equal(await balance(other.id, '22'), -4);
    await ok(await api(`/gold/transactions/${manual.id}/reverse`, 'POST', { reason: 'خطأ إدخال' }), 201);
    assert.equal(await balance(other.id, '22'), 0, 'a reversal is a new opposite transaction, not an edit');
    const reversedAgain = await api(`/gold/transactions/${manual.id}/reverse`, 'POST', { reason: 'مرة أخرى' });
    assert.equal(reversedAgain.status, 409, 'a transaction cannot be reversed twice');
    const original = await json(await api(`/gold/transactions/${manual.id}`));
    assert.equal(original.status, 'reversed');
    assert.ok(original.reversedByTransactionId);
    step('manual reversal wrote an opposite transaction and left the original intact');

    // A document-sourced movement is reversed by cancelling its document, never by hand.
    const documentTransaction = saleTransactions.items[0];
    assert.equal((await api(`/gold/transactions/${documentTransaction.id}/reverse`, 'POST', { reason: 'يدوي' })).status, 409);
    await ok(await api(`/returns/${salesReturn.id}/cancel`, 'POST', { reason: 'إلغاء المرتجع' }), 201);
    // The cancellation removes the 5 g obligation but cannot un-hand-over metal: the
    // customer already received 5 g, so those grams are now owed back to the shop.
    assert.equal(await balance(customer.id, '21'), 5, 'cancelling the return must leave the already-delivered weight owed back');
    step('cancelling the return reversed its gold effect without rewriting settled weight');
    await assertAllBalanced(sql, 'after reversals');

    console.log('\n— reconciliation —');
    const reconciliation = await json(await api('/gold/reconciliation'));
    assert.equal(reconciliation.salesExchanges.unposted, 0, 'every scrap exchange must have produced a gold movement');
    assert.equal(reconciliation.transactions.unbalanced, 0);
    assert.ok(reconciliation.karatsBalanced, 'same-karat debits and credits must match within every karat');
    assert.ok(reconciliation.pureGoldBalanced, `the whole ledger must net to zero fine gold, got ${reconciliation.netPureGoldGrams} g`);
    // A conversion is the only thing allowed to move weight between karats, and what it
    // takes out of one karat must arrive in another as the same fine gold — so the
    // conversion effect across all karats nets to zero.
    const converted = reconciliation.karats.filter((row: any) => row.conversionNetGrams !== 0);
    assert.ok(converted.length >= 2, 'a conversion must touch at least two karats');
    const convertedFineGold = converted.reduce((sum: number, row: any) => sum + (row.conversionNetGrams * Number(row.karat)) / 24, 0);
    assert.ok(Math.abs(convertedFineGold) < 0.005, `conversions must net to zero fine gold, got ${convertedFineGold.toFixed(4)} g`);
    assert.ok(converted.some((row: any) => row.karat === '21') && converted.some((row: any) => row.karat === '18'), 'this run converted 21K into 18K');
    step(`reconciliation clean: ${reconciliation.salesExchanges.posted}/${reconciliation.salesExchanges.total} exchanges posted, ${reconciliation.transactions.total} transactions balanced, net fine gold ${reconciliation.netPureGoldGrams} g`);

    console.log('\nAll Task 09 gold checks passed.');
  } finally {
    await sql.end({ timeout: 5 });
    await app.close();
  }
}

void main().catch(error => { console.error('\nFAILED:', error?.message ?? error); process.exit(1); });
