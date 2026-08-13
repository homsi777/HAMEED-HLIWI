import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 07: the complete invoice-to-finance lifecycle. Every case below follows real
// money from the document that caused it into the cashbox and the partner balance.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3005;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
let cookie = '';
let salesCookie = '';
let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected} but got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const token = crypto.randomUUID().slice(0, 8);
let customerId = ''; let supplierId = '';
const cashboxBalance = async (cashboxId: string) => (await json(await api('/finance/cashboxes'))).find((box: any) => box.id === cashboxId).balanceAmount;
const statement = async (partnerId: string) => json(await api(`/finance/partners/${partnerId}/statement`));

const makeStock = async (suffix: string, weight = '10.000') => ok(await api('/inventory', 'POST', { code: `FIN-${token}-${suffix}`, name: `Finance item ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: weight, stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));
const sell = async (itemId: string, price: string, paidUSD: string, paidSYP: string, method: string) => ok(await api('/sales', 'POST', { warehouseId, customerId, items: [{ inventoryItemId: itemId, pricePerGramUSD: price, laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD, paidSYP, paymentMethod: method, exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    assert.equal(login.status, 201); cookie = jar(login);
    const salesLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'furqan_sales_dev', password, warehouseId }) }) as ResponseWithCookies;
    salesCookie = salesLogin.status === 201 ? jar(salesLogin) : '';

    console.log('\n— security —');
    assert.equal((await fetch(`${base}/finance/cashboxes`)).status, 401);
    assert.equal((await fetch(`${base}/finance/vouchers`)).status, 401);
    step('unauthenticated finance endpoints rejected');
    if (salesCookie) { assert.equal((await api('/finance/vouchers', 'POST', {}, salesCookie)).status, 403); assert.equal((await api('/finance/cashboxes', 'POST', {}, salesCookie)).status, 403); step('sales role denied voucher creation and cashbox management'); }

    console.log('\n— cashboxes —');
    const cashboxes = await json(await api('/finance/cashboxes'));
    const usdBox = cashboxes.find((box: any) => box.currency === 'USD' && box.warehouseId === warehouseId && box.isDefault);
    const sypBox = cashboxes.find((box: any) => box.currency === 'SYP' && box.warehouseId === warehouseId && box.isDefault);
    assert.ok(usdBox && sypBox, 'default USD and SYP cashboxes must exist for the warehouse');
    step(`default cashboxes resolved: ${usdBox.name} / ${sypBox.name}`);
    const extraBox = await ok(await api('/finance/cashboxes', 'POST', { name: `صندوق إضافي ${token}`, currency: 'USD', warehouseId, openingBalance: '250.0000' }));
    assert.equal(extraBox.balanceAmount, 250); step('cashbox created with an opening balance and no movements');

    customerId = (await ok(await api('/partners', 'POST', { name: `Finance Customer ${token}`, type: 'customer' }))).id;
    supplierId = (await ok(await api('/partners', 'POST', { name: `Finance Supplier ${token}`, type: 'supplier' }))).id;

    // ---------------------------------------------------------------- cash sale
    console.log('\n— cash sale, fully paid —');
    const usdBefore = await cashboxBalance(usdBox.id);
    const cashItem = await makeStock('cash');
    const cashSale = await sell(cashItem.id, '100.0000', '1000.0000', '0', 'cash_usd');
    assert.equal(cashSale.finalTotalUSD, 1000); assert.equal(cashSale.remainingDebtUSD, 0);
    const cashSaleDetail = await json(await api(`/sales/${cashSale.id}`));
    assert.equal(cashSaleDetail.vouchers.length, 1);
    const receipt = cashSaleDetail.vouchers[0];
    assert.equal(receipt.type, 'receipt'); assert.equal(receipt.sourceType, 'sale'); assert.equal(receipt.amountUSD, 1000); assert.equal(receipt.currency, 'USD'); assert.equal(receipt.cashBoxId, usdBox.id);
    assert.match(receipt.voucherNumber, /^RCV-\d{4}-\d{3}$/);
    assert.equal(receipt.systemNote, `قبض آلي عن فاتورة بيع ${cashSale.invoiceNumber}`);
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBefore + 1000).toFixed(4)));
    const cashVoucher = await json(await api(`/finance/vouchers/${receipt.id}`));
    assert.equal(cashVoucher.sourceInvoiceNumber, cashSale.invoiceNumber); assert.equal(cashVoucher.partnerId, customerId);
    step(`sale ${cashSale.invoiceNumber} → ${receipt.voucherNumber} $1000 into ${usdBox.name}, invoice receivable 0`);

    // ---------------------------------------------------------------- credit sale
    console.log('\n— credit sale, nothing paid —');
    const balanceBeforeCredit = await cashboxBalance(usdBox.id);
    const creditItem = await makeStock('credit');
    const creditSale = await sell(creditItem.id, '100.0000', '0', '0', 'debt');
    assert.equal(creditSale.remainingDebtUSD, 1000);
    const creditDetail = await json(await api(`/sales/${creditSale.id}`));
    assert.equal(creditDetail.vouchers.length, 0, 'a credit sale must not fabricate a receipt');
    assert.equal(await cashboxBalance(usdBox.id), balanceBeforeCredit, 'a credit sale must not move cash');
    const afterCredit = await statement(customerId);
    const creditRow = afterCredit.rows.find((row: any) => row.documentNumber === creditSale.invoiceNumber);
    assert.ok(creditRow && creditRow.debitUSD === 1000 && creditRow.entryType === 'sale');
    step(`credit sale ${creditSale.invoiceNumber} → no voucher, no cash, receivable $1000 referencing the invoice`);

    // ---------------------------------------------------------------- partial sale
    console.log('\n— partial payment sale —');
    const partialItem = await makeStock('partial');
    const partialSale = await sell(partialItem.id, '100.0000', '300.0000', '0', 'mixed');
    assert.equal(partialSale.finalTotalUSD, 1000); assert.equal(partialSale.remainingDebtUSD, 700);
    const partialDetail = await json(await api(`/sales/${partialSale.id}`));
    assert.equal(partialDetail.vouchers.length, 1); assert.equal(partialDetail.vouchers[0].amountUSD, 300);
    step(`sale ${partialSale.invoiceNumber} $1000 → receipt $300, remaining receivable $700`);

    // ---------------------------------------------------------------- mixed currency
    console.log('\n— mixed USD and SYP sale —');
    const sypBefore = await cashboxBalance(sypBox.id);
    const mixedItem = await makeStock('mixed');
    const mixedSale = await sell(mixedItem.id, '100.0000', '400.0000', '1300000.00', 'mixed');
    const mixedDetail = await json(await api(`/sales/${mixedSale.id}`));
    assert.equal(mixedDetail.vouchers.length, 2, 'each paid currency must produce its own voucher');
    const usdLeg = mixedDetail.vouchers.find((voucher: any) => voucher.currency === 'USD');
    const sypLeg = mixedDetail.vouchers.find((voucher: any) => voucher.currency === 'SYP');
    assert.equal(usdLeg.amount, 400); assert.equal(usdLeg.amountUSD, 400);
    assert.equal(sypLeg.amount, 1300000, 'the original SYP amount must be preserved, not only its USD value');
    assert.equal(sypLeg.exchangeRate, 6500); assert.equal(sypLeg.amountUSD, 200);
    assert.equal(await cashboxBalance(sypBox.id), Number((sypBefore + 1300000).toFixed(4)));
    assert.equal(mixedSale.remainingDebtUSD, 400);
    step(`sale ${mixedSale.invoiceNumber} → $400 USD + 1,300,000 SYP @6500 (=$200) in separate vouchers and cashboxes`);

    // ---------------------------------------------------------------- purchase
    console.log('\n— purchase with partial payment —');
    const usdBeforePurchase = await cashboxBalance(usdBox.id);
    const purchase = await ok(await api('/purchases', 'POST', { warehouseId, supplierId, items: [{ itemName: `Finance purchase ${token}`, code: `FINPUR-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], discountUSD: '0', paidUSD: '2000.0000', paidSYP: '0', paymentMethod: 'mixed', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    assert.equal(purchase.finalTotalUSD, 5000); assert.equal(purchase.remainingDebtUSD, 3000);
    const purchaseDetail = await json(await api(`/purchases/${purchase.id}`));
    assert.equal(purchaseDetail.vouchers.length, 1);
    assert.equal(purchaseDetail.vouchers[0].type, 'payment'); assert.equal(purchaseDetail.vouchers[0].amountUSD, 2000);
    assert.match(purchaseDetail.vouchers[0].voucherNumber, /^PAY-\d{4}-\d{3}$/);
    assert.equal(purchaseDetail.vouchers[0].systemNote, `صرف آلي عن فاتورة شراء ${purchase.invoiceNumber}`);
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBeforePurchase - 2000).toFixed(4)));
    assert.equal(purchaseDetail.supplierOutstandingUSD, 3000);
    step(`purchase ${purchase.invoiceNumber} $5000 → payment voucher $2000 out, supplier payable $3000`);

    // ---------------------------------------------------------------- manual receipt and payment
    console.log('\n— manual vouchers —');
    const receivableBefore = (await statement(customerId)).closingBalanceUSD;
    const usdBeforeManual = await cashboxBalance(usdBox.id);
    const manualReceipt = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customerId, currency: 'USD', amount: '300.0000', exchangeRateSypPerUsd: RATE, warehouseId, userNote: 'دفعة على الحساب', idempotencyKey: crypto.randomUUID() }));
    assert.equal(manualReceipt.sourceType, 'manual'); assert.equal(manualReceipt.amountUSD, 300);
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBeforeManual + 300).toFixed(4)));
    assert.equal((await statement(customerId)).closingBalanceUSD, Number((receivableBefore - 300).toFixed(4)));
    step(`manual receipt ${manualReceipt.voucherNumber} → cash +$300, receivable -$300`);

    const payableBefore = (await statement(supplierId)).closingBalanceUSD;
    const manualPayment = await ok(await api('/finance/vouchers', 'POST', { type: 'payment', partnerId: supplierId, currency: 'USD', amount: '500.0000', exchangeRateSypPerUsd: RATE, warehouseId, userNote: 'دفعة للمورد', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBeforeManual + 300 - 500).toFixed(4)));
    assert.equal((await statement(supplierId)).closingBalanceUSD, Number((payableBefore + 500).toFixed(4)));
    step(`manual payment ${manualPayment.voucherNumber} → cash -$500, supplier payable reduced by $500`);

    const allocated = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customerId, currency: 'USD', amount: '100.0000', exchangeRateSypPerUsd: RATE, warehouseId, allocations: [{ salesInvoiceId: creditSale.id, amountUSD: '60.0000' }, { salesInvoiceId: partialSale.id, amountUSD: '40.0000' }], idempotencyKey: crypto.randomUUID() }));
    assert.equal(allocated.allocations.length, 2);
    assert.equal((await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customerId, currency: 'USD', amount: '50.0000', exchangeRateSypPerUsd: RATE, warehouseId, allocations: [{ salesInvoiceId: creditSale.id, amountUSD: '60.0000' }], idempotencyKey: crypto.randomUUID() })).status, 409);
    step('receipt allocated across two invoices as records; over-allocation rejected');

    // ---------------------------------------------------------------- expense and transfer
    console.log('\n— expense and cashbox transfer —');
    const usdBeforeExpense = await cashboxBalance(usdBox.id);
    const expense = await ok(await api('/finance/vouchers', 'POST', { type: 'expense', currency: 'USD', amount: '75.0000', exchangeRateSypPerUsd: RATE, warehouseId, category: 'كهرباء', userNote: 'اشتراك أمبيرات', idempotencyKey: crypto.randomUUID() }));
    assert.match(expense.voucherNumber, /^EXP-\d{4}-\d{3}$/); assert.equal(expense.category, 'كهرباء');
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBeforeExpense - 75).toFixed(4)));
    assert.equal((await api('/finance/vouchers', 'POST', { type: 'expense', partnerId: customerId, currency: 'USD', amount: '10.0000', exchangeRateSypPerUsd: RATE, category: 'كهرباء', idempotencyKey: crypto.randomUUID() })).status, 409);
    step(`expense ${expense.voucherNumber} → cash -$75; expense with a partner rejected`);

    const transferFrom = await cashboxBalance(extraBox.id); const transferTo = await cashboxBalance(usdBox.id);
    const transfer = await ok(await api('/finance/transfers', 'POST', { fromCashboxId: extraBox.id, toCashboxId: usdBox.id, amountFrom: '100.0000', amountTo: '100.0000', exchangeRateSypPerUsd: RATE, note: 'تعزيز الصندوق الإضافي', idempotencyKey: crypto.randomUUID() }));
    assert.match(transfer.transferNumber, /^TRF-\d{4}-\d{3}$/);
    assert.equal(await cashboxBalance(extraBox.id), Number((transferFrom - 100).toFixed(4)));
    assert.equal(await cashboxBalance(usdBox.id), Number((transferTo + 100).toFixed(4)));
    assert.equal((await api('/finance/transfers', 'POST', { fromCashboxId: extraBox.id, toCashboxId: usdBox.id, amountFrom: '999999.0000', amountTo: '999999.0000', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() })).status, 409);
    step(`transfer ${transfer.transferNumber} moved $100 atomically; overdrawn transfer rejected`);

    // ---------------------------------------------------------------- returns
    console.log('\n— returns —');
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${cashSale.id}`));
    const usdBeforeRefund = await cashboxBalance(usdBox.id);
    const cashRefund = await ok(await api('/returns', 'POST', { type: 'sales_return', originalInvoiceId: cashSale.id, partnerId: customerId, reason: 'إرجاع نقدي', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '1000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const refundVouchers = (await json(await api(`/finance/vouchers?returnInvoiceId=${cashRefund.id}&search=${encodeURIComponent(cashRefund.invoiceNumber)}`))).items;
    assert.equal(refundVouchers.length, 1); assert.equal(refundVouchers[0].type, 'payment'); assert.equal(refundVouchers[0].amountUSD, 1000);
    assert.equal(refundVouchers[0].systemNote, `رد مبلغ للعميل عن مرتجع ${cashRefund.invoiceNumber}`);
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBeforeRefund - 1000).toFixed(4)));
    step(`sales return ${cashRefund.invoiceNumber} refunded in cash → payment voucher, cash -$1000`);

    const creditReturnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${creditSale.id}`));
    const balanceBeforeCreditReturn = (await statement(customerId)).closingBalanceUSD;
    const usdBeforeCreditReturn = await cashboxBalance(usdBox.id);
    const creditReturn = await ok(await api('/returns', 'POST', { type: 'sales_return', originalInvoiceId: creditSale.id, partnerId: customerId, reason: 'إرجاع على الحساب', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: creditReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    assert.equal(await cashboxBalance(usdBox.id), usdBeforeCreditReturn, 'a credit-only return must not move cash');
    assert.equal((await statement(customerId)).closingBalanceUSD, Number((balanceBeforeCreditReturn - creditReturn.finalTotalUSD).toFixed(4)));
    step(`credit-only sales return ${creditReturn.invoiceNumber} → no cash movement, receivable reduced by $${creditReturn.finalTotalUSD}`);

    const purchaseReturnable = await json(await api(`/returns/returnable?type=purchase_return&invoiceId=${purchase.id}`));
    const usdBeforePurchaseReturn = await cashboxBalance(usdBox.id);
    const purchaseReturn = await ok(await api('/returns', 'POST', { type: 'purchase_return', originalInvoiceId: purchase.id, partnerId: supplierId, reason: 'رد بضاعة للمورد', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: purchaseReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '50.000' }], refundUSD: '1000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const purchaseReturnVouchers = (await json(await api(`/finance/vouchers?search=${encodeURIComponent(purchaseReturn.invoiceNumber)}`))).items;
    assert.equal(purchaseReturnVouchers.length, 1); assert.equal(purchaseReturnVouchers[0].type, 'receipt');
    assert.equal(await cashboxBalance(usdBox.id), Number((usdBeforePurchaseReturn + 1000).toFixed(4)));
    step(`purchase return ${purchaseReturn.invoiceNumber} recovered in cash → receipt voucher, cash +$1000`);

    // ---------------------------------------------------------------- idempotency and cancellation
    console.log('\n— idempotency, cancellation and reversal —');
    const duplicateKey = crypto.randomUUID();
    const firstManual = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customerId, currency: 'USD', amount: '25.0000', exchangeRateSypPerUsd: RATE, warehouseId, idempotencyKey: duplicateKey }));
    const secondManual = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customerId, currency: 'USD', amount: '25.0000', exchangeRateSypPerUsd: RATE, warehouseId, idempotencyKey: duplicateKey }));
    assert.equal(firstManual.id, secondManual.id);
    const salesVoucherRows = await sql`select count(*)::int as n from vouchers where sales_invoice_id = ${cashSale.id} and source_type = 'sale'`;
    assert.equal(salesVoucherRows[0]!.n, 1, 'one sale payment must never create two automatic vouchers');
    step('duplicate manual submit returns the same voucher; one sale payment yields exactly one automatic voucher');

    assert.equal((await api(`/finance/vouchers/${refundVouchers[0].id}/cancel`, 'POST', { reason: 'محاولة' })).status, 409);
    step('automatic vouchers cannot be cancelled directly');

    const beforeManualCancel = await cashboxBalance(usdBox.id);
    assert.equal((await api(`/finance/vouchers/${firstManual.id}/cancel`, 'POST', {})).status, 409);
    const cancelled = await ok(await api(`/finance/vouchers/${firstManual.id}/cancel`, 'POST', { reason: 'خطأ إدخال' }));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(await cashboxBalance(usdBox.id), Number((beforeManualCancel - 25).toFixed(4)));
    const preservedOriginal = await sql`select status from vouchers where id = ${firstManual.id}`;
    const reversalRow = await sql`select voucher_number, type from vouchers where reversal_of_voucher_id = ${firstManual.id}`;
    assert.equal(preservedOriginal[0]!.status, 'cancelled'); assert.equal(reversalRow.length, 1); assert.equal(reversalRow[0]!.type, 'payment');
    assert.equal((await api(`/finance/vouchers/${firstManual.id}/cancel`, 'POST', { reason: 'مرة أخرى' })).status, 409);
    step(`manual voucher cancelled → reversal ${reversalRow[0]!.voucher_number} created, original preserved, repeat rejected`);

    const beforeSaleCancel = await cashboxBalance(usdBox.id);
    const cancelSaleItem = await makeStock('cancel');
    const cancelSale = await sell(cancelSaleItem.id, '100.0000', '1000.0000', '0', 'cash_usd');
    assert.equal(await cashboxBalance(usdBox.id), Number((beforeSaleCancel + 1000).toFixed(4)));
    await ok(await api(`/sales/${cancelSale.id}/cancel`, 'POST', { reason: 'إلغاء الفاتورة' }));
    assert.equal(await cashboxBalance(usdBox.id), beforeSaleCancel, 'cancelling a cash sale must reverse its receipt');
    const cancelSaleVouchers = await sql`select status, type from vouchers where sales_invoice_id = ${cancelSale.id} order by created_at`;
    assert.equal(cancelSaleVouchers.length, 2); assert.equal(cancelSaleVouchers[0]!.status, 'cancelled'); assert.equal(cancelSaleVouchers[1]!.type, 'payment');
    step('cancelling a cash sale reversed its receipt with a compensating voucher, nothing deleted');

    // ---------------------------------------------------------------- reconciliation
    console.log('\n— reconciliation and persistence —');
    for (const box of await json(await api('/finance/cashboxes'))) {
      const derived = await sql`
        select coalesce(sum(case when direction = 'inflow' then amount else -amount end), 0) as net
        from cash_movements where cashbox_id = ${box.id}`;
      assert.equal(Number(box.balanceAmount.toFixed(4)), Number((Number(box.openingBalance) + Number(derived[0]!.net)).toFixed(4)), `cashbox ${box.name} must reconcile to its movement history`);
    }
    step('every cashbox balance equals its opening balance plus its complete movement history');

    const finalStatement = await statement(customerId);
    const recomputed = finalStatement.rows.reduce((total: number, row: any) => total + row.debitUSD - row.creditUSD, finalStatement.openingBalanceUSD);
    assert.equal(Number(recomputed.toFixed(4)), finalStatement.closingBalanceUSD);
    assert.ok(finalStatement.rows.some((row: any) => row.entryType === 'sale') && finalStatement.rows.some((row: any) => row.entryType === 'receipt') && finalStatement.rows.some((row: any) => row.entryType === 'sales_return'));
    assert.ok(finalStatement.rows.every((row: any) => row.date && row.documentType && row.currency && row.runningBalanceUSD !== undefined));
    step(`partner statement reconciles: opening $${finalStatement.openingBalanceUSD} → closing $${finalStatement.closingBalanceUSD} over ${finalStatement.rows.length} rows`);

    const auditRows = await sql`select action from audit_logs where module = 'finance'`;
    assert.ok(auditRows.some(row => row.action === 'finance.voucher.create')); assert.ok(auditRows.some(row => row.action === 'finance.voucher.cancel'));
    assert.ok(auditRows.some(row => row.action === 'finance.transfer.create')); assert.ok(auditRows.some(row => row.action === 'finance.cashbox.create'));
    step('finance operations audited');

    const balancesBeforeRestart = await json(await api('/finance/cashboxes'));
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
    app = await createApp(); await app.listen({ port, host: '127.0.0.1' });
    const balancesAfterRestart = await json(await api('/finance/cashboxes'));
    for (const box of balancesBeforeRestart) assert.equal(balancesAfterRestart.find((row: any) => row.id === box.id).balanceAmount, box.balanceAmount);
    const persistedVoucher = await json(await api(`/finance/vouchers/${receipt.id}`));
    assert.equal(persistedVoucher.sourceInvoiceNumber, cashSale.invoiceNumber);
    step('cashbox balances and voucher references survive a backend restart');

    console.log('\nTask 07 financial cycle checks passed.\n');
  } finally {
    await sql.end();
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
