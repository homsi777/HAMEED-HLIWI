import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 07 operational verification. Walks the whole business cycle the way a cashier
// would: configure cashboxes, sell, collect, buy, pay, return, reconcile, restart.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3006;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = 6500;
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const boxes = async () => json(await api('/finance/cashboxes'));
const balanceOf = async (id: string) => (await boxes()).find((box: any) => box.id === id).balanceAmount;
const statement = async (partnerId: string) => json(await api(`/finance/partners/${partnerId}/statement`));

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

    console.log('\n[1-2] Cashboxes exist and defaults are configured per warehouse and currency');
    const allBoxes = await boxes();
    const usdBox = allBoxes.find((box: any) => box.warehouseId === warehouseId && box.currency === 'USD' && box.isDefault);
    const sypBox = allBoxes.find((box: any) => box.warehouseId === warehouseId && box.currency === 'SYP' && box.isDefault);
    assert.ok(usdBox && sypBox);
    step(`default USD cashbox "${usdBox.name}" and SYP cashbox "${sypBox.name}" ready — a seller needs no extra clicks`);

    const customer = await ok(await api('/partners', 'POST', { name: `عميل التحقق ${token}`, type: 'customer' }));
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد التحقق ${token}`, type: 'supplier' }));
    const stock = async (suffix: string) => ok(await api('/inventory', 'POST', { code: `V7-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));

    console.log('\n[3-5] Cash sale creates an automatic receipt voucher and raises the cashbox');
    const usdStart = await balanceOf(usdBox.id);
    const cashSale = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: (await stock('cash')).id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '1000.0000', paidSYP: '0', paymentMethod: 'cash_usd', exchangeRateSypPerUsd: String(RATE), idempotencyKey: crypto.randomUUID() }));
    const saleDetail = await json(await api(`/sales/${cashSale.id}`));
    const autoReceipt = saleDetail.vouchers[0];
    assert.equal(autoReceipt.type, 'receipt'); assert.equal(autoReceipt.amountUSD, 1000);
    assert.equal(await balanceOf(usdBox.id), Number((usdStart + 1000).toFixed(4)));
    step(`sale ${cashSale.invoiceNumber} → ${autoReceipt.voucherNumber} "${autoReceipt.systemNote}", cashbox ${usdStart} → ${usdStart + 1000}`);

    console.log('\n[6] Customer statement shows the invoice and its receipt');
    const afterCashSale = await statement(customer.id);
    assert.ok(afterCashSale.rows.some((row: any) => row.documentNumber === cashSale.invoiceNumber && row.debitUSD === 1000));
    assert.ok(afterCashSale.rows.some((row: any) => row.documentNumber === autoReceipt.voucherNumber && row.creditUSD === 1000));
    assert.equal(afterCashSale.closingBalanceUSD, 0);
    step(`statement rows: sale +$1000 debit, receipt -$1000 credit, closing $0`);

    console.log('\n[7-8] Credit sale creates debt without touching cash');
    const beforeCredit = await balanceOf(usdBox.id);
    const creditSale = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: (await stock('credit')).id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: String(RATE), idempotencyKey: crypto.randomUUID() }));
    assert.equal((await json(await api(`/sales/${creditSale.id}`))).vouchers.length, 0);
    assert.equal(await balanceOf(usdBox.id), beforeCredit);
    assert.equal((await statement(customer.id)).closingBalanceUSD, 1000);
    step(`credit sale ${creditSale.invoiceNumber} → no voucher, no cash movement, receivable $1000`);

    console.log('\n[9-10] Manual receipt reduces the debt and raises the cash');
    const manual = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customer.id, currency: 'USD', amount: '400.0000', exchangeRateSypPerUsd: String(RATE), cashBoxId: usdBox.id, warehouseId, userNote: 'دفعة على حساب الفاتورة الآجلة', allocations: [{ salesInvoiceId: creditSale.id, amountUSD: '400.0000' }], idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balanceOf(usdBox.id), Number((beforeCredit + 400).toFixed(4)));
    assert.equal((await statement(customer.id)).closingBalanceUSD, 600);
    step(`manual receipt ${manual.voucherNumber} $400 allocated to ${creditSale.invoiceNumber} → cash +$400, debt $1000 → $600`);

    console.log('\n[11-12] Purchase with partial payment creates a payment voucher and supplier debt');
    const beforePurchase = await balanceOf(usdBox.id);
    const purchase = await ok(await api('/purchases', 'POST', { warehouseId, supplierId: supplier.id, items: [{ itemName: `بضاعة ${token}`, code: `V7PUR-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], discountUSD: '0', paidUSD: '2000.0000', paidSYP: '0', paymentMethod: 'mixed', exchangeRateSypPerUsd: String(RATE), idempotencyKey: crypto.randomUUID() }));
    const purchaseDetail = await json(await api(`/purchases/${purchase.id}`));
    assert.equal(purchaseDetail.vouchers[0].type, 'payment'); assert.equal(purchaseDetail.vouchers[0].amountUSD, 2000);
    assert.equal(await balanceOf(usdBox.id), Number((beforePurchase - 2000).toFixed(4)));
    assert.equal(purchaseDetail.supplierOutstandingUSD, 3000);
    step(`purchase ${purchase.invoiceNumber} $5000 → ${purchaseDetail.vouchers[0].voucherNumber} $2000 out, supplier payable $3000`);

    console.log('\n[13-14] Sales return refunded in cash creates a payment voucher and outflow');
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${cashSale.id}`));
    const beforeRefund = await balanceOf(usdBox.id);
    const salesReturn = await ok(await api('/returns', 'POST', { type: 'sales_return', originalInvoiceId: cashSale.id, partnerId: customer.id, reason: 'إرجاع مع رد نقدي', exchangeRateSypPerUsd: String(RATE), items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '1000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const refundVoucher = (await json(await api(`/finance/vouchers?search=${encodeURIComponent(salesReturn.invoiceNumber)}`))).items[0];
    assert.equal(refundVoucher.type, 'payment');
    assert.equal(await balanceOf(usdBox.id), Number((beforeRefund - 1000).toFixed(4)));
    step(`return ${salesReturn.invoiceNumber} → ${refundVoucher.voucherNumber} "${refundVoucher.systemNote}", cash -$1000`);

    console.log('\n[15-16] Purchase return settled as supplier credit changes no cash');
    const purchaseReturnable = await json(await api(`/returns/returnable?type=purchase_return&invoiceId=${purchase.id}`));
    const beforePurchaseReturn = await balanceOf(usdBox.id);
    const payableBefore = (await statement(supplier.id)).closingBalanceUSD;
    const purchaseReturn = await ok(await api('/returns', 'POST', { type: 'purchase_return', originalInvoiceId: purchase.id, partnerId: supplier.id, reason: 'رد بضاعة مقابل تخفيض الذمة', exchangeRateSypPerUsd: String(RATE), items: [{ sourceLineId: purchaseReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '50.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await balanceOf(usdBox.id), beforePurchaseReturn);
    assert.equal((await statement(supplier.id)).closingBalanceUSD, Number((payableBefore + purchaseReturn.finalTotalUSD).toFixed(4)));
    step(`purchase return ${purchaseReturn.invoiceNumber} → no cash movement, supplier payable reduced by $${purchaseReturn.finalTotalUSD}`);

    console.log('\n[17] USD and SYP are both preserved with their own vouchers and cashboxes');
    const sypBefore = await balanceOf(sypBox.id);
    const mixedSale = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: (await stock('mixed')).id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '400.0000', paidSYP: '1300000.00', paymentMethod: 'mixed', exchangeRateSypPerUsd: String(RATE), idempotencyKey: crypto.randomUUID() }));
    const mixedVouchers = (await json(await api(`/sales/${mixedSale.id}`))).vouchers;
    const sypVoucher = mixedVouchers.find((voucher: any) => voucher.currency === 'SYP');
    assert.equal(mixedVouchers.length, 2); assert.equal(sypVoucher.amount, 1300000); assert.equal(sypVoucher.amountUSD, 200); assert.equal(sypVoucher.exchangeRate, RATE);
    assert.equal(await balanceOf(sypBox.id), Number((sypBefore + 1300000).toFixed(4)));
    step(`sale ${mixedSale.invoiceNumber} kept 1,300,000 SYP @${RATE} (=$200) alongside $400 in separate cashboxes`);

    console.log('\n[18-19] Reload and restart keep every balance identical');
    const beforeRestart = await boxes();
    const statementBefore = await statement(customer.id);
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
    app = await createApp(); await app.listen({ port, host: '127.0.0.1' });
    const afterRestart = await boxes();
    for (const box of beforeRestart) assert.equal(afterRestart.find((row: any) => row.id === box.id).balanceAmount, box.balanceAmount);
    assert.equal((await statement(customer.id)).closingBalanceUSD, statementBefore.closingBalanceUSD);
    step(`all ${afterRestart.length} cashbox balances and the customer statement survived a backend restart`);

    console.log('\n[20] Reconciliation: balances equal their movement history, statements equal their entries');
    for (const box of afterRestart) {
      const derived = await sql`select coalesce(sum(case when direction = 'inflow' then amount else -amount end), 0) as net from cash_movements where cashbox_id = ${box.id}`;
      assert.equal(box.balanceAmount, Number((Number(box.openingBalance) + Number(derived[0]!.net)).toFixed(4)), `cashbox ${box.name} failed to reconcile`);
    }
    for (const partnerId of [customer.id, supplier.id]) {
      const result = await statement(partnerId);
      const recomputed = result.rows.reduce((total: number, row: any) => total + row.debitUSD - row.creditUSD, result.openingBalanceUSD);
      assert.equal(Number(recomputed.toFixed(4)), result.closingBalanceUSD);
    }
    const summary = await json(await api('/finance/summary'));
    step(`reconciled: ${afterRestart.length} cashboxes, USD cash $${summary.totalUsdCash}, SYP cash ${summary.totalSypCash.toLocaleString('en-US')}, receivables $${summary.totalReceivablesUSD}, payables $${summary.totalPayablesUSD}`);

    console.log('\nTask 07 local operational verification passed.\n');
  } finally {
    await sql.end();
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
