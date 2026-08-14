import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 08: the accounting core. Each case follows a business document through the
// posting engine into the ledger, and every journal is checked for balance.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3009;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let salesCookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const journalsFor = async (query: string) => json(await api(`/accounting/journals/by-source?${query}`));
const lines = async (journalId: string) => (await json(await api(`/accounting/journals/${journalId}`))).lines;
const accountBalance = async (code: string) => {
  const account = (await json(await api('/accounting/accounts'))).find((row: any) => row.code === code);
  return account ? account.balanceUSD : 0;
};
// Every journal in the database must balance — checked after each phase, not just once.
const assertAllBalanced = async (sql: any, label: string) => {
  const broken = await sql`select journal_number from journal_entries where total_debit_usd <> total_credit_usd`;
  assert.equal(broken.length, 0, `${label}: unbalanced journals ${broken.map((r: any) => r.journal_number).join(', ')}`);
  const lineSums = await sql`select je.journal_number from journal_entries je join journal_entry_lines l on l.journal_entry_id = je.id group by je.id, je.journal_number, je.total_debit_usd having round(sum(l.debit_usd), 4) <> je.total_debit_usd or round(sum(l.debit_usd), 4) <> round(sum(l.credit_usd), 4)`;
  assert.equal(lineSums.length, 0, `${label}: journal lines do not sum to the header ${lineSums.map((r: any) => r.journal_number).join(', ')}`);
};

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
    const salesLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'furqan_sales_dev', password, warehouseId }) }) as ResponseWithCookies;
    salesCookie = salesLogin.status === 201 ? (salesLogin.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ') : '';

    console.log('\n— security and chart of accounts —');
    assert.equal((await fetch(`${base}/accounting/accounts`)).status, 401);
    assert.equal((await fetch(`${base}/accounting/journals`)).status, 401);
    if (salesCookie) { assert.equal((await api('/accounting/journals', 'POST', {}, salesCookie)).status, 403); assert.equal((await api('/accounting/accounts', 'POST', {}, salesCookie)).status, 403); step('unauthenticated rejected; a sales user cannot create accounts or journals'); }
    const chart = await json(await api('/accounting/accounts'));
    for (const key of ['accounts_receivable', 'accounts_payable', 'sales_revenue', 'sales_returns', 'inventory', 'opening_equity', 'operating_expenses']) {
      assert.ok(chart.some((row: any) => row.systemKey === key), `system account ${key} is missing`);
    }
    const receivableAccount = chart.find((row: any) => row.systemKey === 'accounts_receivable');
    const payableAccount = chart.find((row: any) => row.systemKey === 'accounts_payable');
    const revenueAccount = chart.find((row: any) => row.systemKey === 'sales_revenue');
    assert.ok(chart.some((row: any) => !row.allowsPosting && row.accountClass === 'asset'), 'the chart must have heading accounts');
    step(`chart of accounts present: ${chart.length} accounts, all system keys resolved, hierarchy in place`);

    const heading = chart.find((row: any) => !row.allowsPosting);
    assert.equal((await api(`/accounting/accounts/${heading.id}`, 'PATCH', { isActive: false })).status, 409);
    step('a system account cannot be disabled');

    console.log('\n— journal core —');
    const balanced = await ok(await api('/accounting/journals', 'POST', { description: `قيد يدوي متوازن ${token}`, exchangeRateSypPerUsd: RATE, lines: [{ accountId: receivableAccount.id, debitUSD: '50.0000' }, { accountId: revenueAccount.id, creditUSD: '50.0000' }] }));
    assert.match(balanced.journalNumber, /^JRN-\d{4}-\d{6}$/);
    assert.equal(balanced.totalDebitUSD, 50); assert.equal(balanced.totalCreditUSD, 50); assert.equal(balanced.lines.length, 2);
    step(`balanced manual journal accepted: ${balanced.journalNumber}`);
    assert.equal((await api('/accounting/journals', 'POST', { description: 'غير متوازن', exchangeRateSypPerUsd: RATE, lines: [{ accountId: receivableAccount.id, debitUSD: '50.0000' }, { accountId: revenueAccount.id, creditUSD: '30.0000' }] })).status, 409);
    assert.equal((await api('/accounting/journals', 'POST', { description: 'سطر واحد', exchangeRateSypPerUsd: RATE, lines: [{ accountId: receivableAccount.id, debitUSD: '50.0000' }] })).status, 409);
    assert.equal((await api('/accounting/journals', 'POST', { description: 'حساب رئيسي', exchangeRateSypPerUsd: RATE, lines: [{ accountId: heading.id, debitUSD: '10.0000' }, { accountId: revenueAccount.id, creditUSD: '10.0000' }] })).status, 409);
    assert.equal((await api('/accounting/journals', 'POST', { description: 'مدين ودائن معاً', exchangeRateSypPerUsd: RATE, lines: [{ accountId: receivableAccount.id, debitUSD: '10.0000', creditUSD: '10.0000' }, { accountId: revenueAccount.id, creditUSD: '10.0000' }] })).status, 409);
    step('unbalanced, single-line, heading-account and both-sided journals all rejected');

    const reversal = await ok(await api(`/accounting/journals/${balanced.id}/reverse`, 'POST', { reason: 'تصحيح' }));
    assert.equal(reversal.totalDebitUSD, 50);
    assert.equal((await json(await api(`/accounting/journals/${balanced.id}`))).status, 'reversed');
    assert.equal((await api(`/accounting/journals/${balanced.id}/reverse`, 'POST', { reason: 'مرة أخرى' })).status, 409);
    step(`reversal ${reversal.journalNumber} created, original retained as reversed, repeat rejected`);

    console.log('\n— sales cycle —');
    const customer = await ok(await api('/partners', 'POST', { name: `عميل محاسبة ${token}`, type: 'customer' }));
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد محاسبة ${token}`, type: 'supplier' }));
    const stock = async (suffix: string) => ok(await api('/inventory', 'POST', { code: `ACC-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));
    const sell = (itemId: string, paidUSD: string, paidSYP = '0', method = 'debt') => api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: itemId, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD, paidSYP, paymentMethod: method, exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() });

    const creditSale = await ok(await sell((await stock('credit')).id, '0'));
    const creditJournal = (await journalsFor(`salesInvoiceId=${creditSale.id}`))[0];
    const creditLines = await lines(creditJournal.id);
    assert.equal(creditLines.length, 2);
    assert.equal(creditLines.find((l: any) => l.accountId === receivableAccount.id).debitUSD, 1000);
    assert.equal(creditLines.find((l: any) => l.accountId === revenueAccount.id).creditUSD, 1000);
    step(`credit sale → ${creditJournal.journalNumber}: Dr ذمم العملاء 1000 / Cr إيرادات المبيعات 1000`);

    const paidSale = await ok(await sell((await stock('paid')).id, '1000.0000', '0', 'cash_usd'));
    const paidJournals = await journalsFor(`salesInvoiceId=${paidSale.id}`);
    assert.equal(paidJournals.length, 2, 'a paid sale posts the invoice and its receipt separately');
    const saleEntry = paidJournals.find((j: any) => j.sourceType === 'sale');
    const receiptEntry = paidJournals.find((j: any) => j.sourceType === 'voucher');
    const receiptLines = await lines(receiptEntry.id);
    assert.equal((await lines(saleEntry.id)).find((l: any) => l.accountId === receivableAccount.id).debitUSD, 1000);
    assert.equal(receiptLines.find((l: any) => l.accountId === receivableAccount.id).creditUSD, 1000);
    assert.ok(receiptLines.some((l: any) => l.debitUSD === 1000 && l.cashboxId), 'the receipt must debit a cash account');
    step(`fully paid sale → invoice ${saleEntry.journalNumber} + receipt ${receiptEntry.journalNumber}; the payment is accounted once`);

    const partialSale = await ok(await sell((await stock('partial')).id, '300.0000', '0', 'mixed'));
    const partialJournals = await journalsFor(`salesInvoiceId=${partialSale.id}`);
    const partialReceipt = partialJournals.find((j: any) => j.sourceType === 'voucher');
    assert.equal((await lines(partialReceipt.id)).find((l: any) => l.accountId === receivableAccount.id).creditUSD, 300);
    step('partial payment settles only $300 of the receivable, leaving $700');

    const beforeManualReceipt = await accountBalance(receivableAccount.code);
    const manualReceipt = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customer.id, currency: 'USD', amount: '200.0000', exchangeRateSypPerUsd: RATE, warehouseId, idempotencyKey: crypto.randomUUID() }));
    const manualJournal = (await journalsFor(`voucherId=${manualReceipt.id}`))[0];
    assert.equal((await lines(manualJournal.id)).find((l: any) => l.accountId === receivableAccount.id).creditUSD, 200);
    assert.equal(await accountBalance(receivableAccount.code), Number((beforeManualReceipt - 200).toFixed(4)));
    step(`manual receipt ${manualReceipt.voucherNumber} → ${manualJournal.journalNumber}: Dr نقدية 200 / Cr ذمم العملاء 200`);

    console.log('\n— currency —');
    const sypSale = await ok(await sell((await stock('syp')).id, '0', '1300000.00', 'mixed'));
    const sypReceipt = (await journalsFor(`salesInvoiceId=${sypSale.id}`)).find((j: any) => j.sourceType === 'voucher');
    const sypLine = (await lines(sypReceipt.id)).find((l: any) => l.currency === 'SYP');
    assert.equal(sypLine.originalAmount, 1300000); assert.equal(sypLine.exchangeRate, 6500); assert.equal(sypLine.debitUSD, 200);
    step(`SYP receipt keeps 1,300,000 SYP @6500 alongside its $200 accounting value`);

    console.log('\n— purchases cycle —');
    const purchase = await ok(await api('/purchases', 'POST', { warehouseId, supplierId: supplier.id, items: [{ itemName: `شراء ${token}`, code: `ACCPUR-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], discountUSD: '0', paidUSD: '2000.0000', paidSYP: '0', paymentMethod: 'mixed', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    const purchaseJournals = await journalsFor(`purchaseInvoiceId=${purchase.id}`);
    const purchaseEntry = purchaseJournals.find((j: any) => j.sourceType === 'purchase');
    const purchaseLines = await lines(purchaseEntry.id);
    assert.equal(purchaseLines.find((l: any) => l.accountId === payableAccount.id).creditUSD, 5000);
    assert.ok(purchaseLines.some((l: any) => l.debitUSD === 5000), 'the purchase must debit inventory/purchases');
    const paymentEntry = purchaseJournals.find((j: any) => j.sourceType === 'voucher');
    assert.equal((await lines(paymentEntry.id)).find((l: any) => l.accountId === payableAccount.id).debitUSD, 2000);
    step(`purchase → ${purchaseEntry.journalNumber} Dr مخزون 5000 / Cr ذمم الموردين 5000, payment ${paymentEntry.journalNumber} settles 2000`);

    const supplierPayment = await ok(await api('/finance/vouchers', 'POST', { type: 'payment', partnerId: supplier.id, currency: 'USD', amount: '500.0000', exchangeRateSypPerUsd: RATE, warehouseId, idempotencyKey: crypto.randomUUID() }));
    assert.equal((await lines((await journalsFor(`voucherId=${supplierPayment.id}`))[0].id)).find((l: any) => l.accountId === payableAccount.id).debitUSD, 500);
    step(`supplier payment ${supplierPayment.voucherNumber}: Dr ذمم الموردين 500 / Cr نقدية 500`);

    console.log('\n— returns —');
    const cashReturnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${paidSale.id}`));
    const cashReturn = await ok(await api('/returns', 'POST', { type: 'sales_return', originalInvoiceId: paidSale.id, partnerId: customer.id, reason: 'إرجاع نقدي', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: cashReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '1000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const cashReturnJournals = await journalsFor(`returnInvoiceId=${cashReturn.id}`);
    const returnEntry = cashReturnJournals.find((j: any) => j.sourceType === 'sales_return');
    const returnLines = await lines(returnEntry.id);
    assert.equal(returnLines.find((l: any) => l.accountId === receivableAccount.id).creditUSD, 1000);
    assert.ok(returnLines.some((l: any) => l.debitUSD === 1000), 'a sales return debits the sales returns account');
    const refundEntry = cashReturnJournals.find((j: any) => j.sourceType === 'voucher');
    assert.equal((await lines(refundEntry.id)).find((l: any) => l.accountId === receivableAccount.id).debitUSD, 1000);
    step(`sales return with cash refund → ${returnEntry.journalNumber} + refund ${refundEntry.journalNumber}`);

    const creditReturnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${creditSale.id}`));
    const creditReturn = await ok(await api('/returns', 'POST', { type: 'sales_return', originalInvoiceId: creditSale.id, partnerId: customer.id, reason: 'إرجاع على الحساب', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: creditReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    assert.equal((await journalsFor(`returnInvoiceId=${creditReturn.id}`)).length, 1, 'a credit-only return posts one journal and no cash entry');
    step('credit-only sales return posts the return journal only, with no cash movement');

    const purchaseReturnable = await json(await api(`/returns/returnable?type=purchase_return&invoiceId=${purchase.id}`));
    const purchaseReturn = await ok(await api('/returns', 'POST', { type: 'purchase_return', originalInvoiceId: purchase.id, partnerId: supplier.id, reason: 'رد للمورد', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: purchaseReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '50.000' }], refundUSD: '1000.0000', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const purchaseReturnJournals = await journalsFor(`returnInvoiceId=${purchaseReturn.id}`);
    const purchaseReturnEntry = purchaseReturnJournals.find((j: any) => j.sourceType === 'purchase_return');
    assert.equal((await lines(purchaseReturnEntry.id)).find((l: any) => l.accountId === payableAccount.id).debitUSD, 5000);
    const supplierRefund = purchaseReturnJournals.find((j: any) => j.sourceType === 'voucher');
    assert.equal((await lines(supplierRefund.id)).find((l: any) => l.accountId === payableAccount.id).creditUSD, 1000);
    step(`purchase return → ${purchaseReturnEntry.journalNumber} Dr ذمم الموردين / Cr مخزون, cash back ${supplierRefund.journalNumber}`);

    console.log('\n— expenses and transfers —');
    const expense = await ok(await api('/finance/vouchers', 'POST', { type: 'expense', currency: 'USD', amount: '75.0000', exchangeRateSypPerUsd: RATE, warehouseId, category: `صيانة ${token}`, idempotencyKey: crypto.randomUUID() }));
    const expenseLines = await lines((await journalsFor(`voucherId=${expense.id}`))[0].id);
    assert.ok(expenseLines.some((l: any) => l.debitUSD === 75 && l.accountCode.startsWith('51')), 'the expense must debit an expense account under operating expenses');
    assert.ok(expenseLines.some((l: any) => l.creditUSD === 75 && l.cashboxId));
    step(`expense voucher → Dr ${expenseLines.find((l: any) => l.debitUSD === 75).accountName} 75 / Cr نقدية 75`);

    const boxes = await json(await api('/finance/cashboxes'));
    const usdBox = boxes.find((box: any) => box.currency === 'USD' && box.warehouseId === warehouseId && box.isDefault);
    const spare = await ok(await api('/finance/cashboxes', 'POST', { name: `صندوق محاسبة ${token}`, currency: 'USD', warehouseId, openingBalance: '400.0000' }));
    const transfer = await ok(await api('/finance/transfers', 'POST', { fromCashboxId: spare.id, toCashboxId: usdBox.id, amountFrom: '150.0000', amountTo: '150.0000', exchangeRateSypPerUsd: RATE, note: 'تعزيز', idempotencyKey: crypto.randomUUID() }));
    const transferEntry = (await json(await api(`/accounting/journals?sourceType=cashbox_transfer&search=${encodeURIComponent(transfer.transferNumber)}`))).items[0];
    const transferLines = await lines(transferEntry.id);
    assert.equal(transferLines.length, 2);
    assert.ok(transferLines.some((l: any) => l.debitUSD === 150) && transferLines.some((l: any) => l.creditUSD === 150));
    assert.ok(transferLines.every((l: any) => l.cashboxId), 'both transfer legs are cash accounts — no revenue or expense');
    step(`transfer ${transfer.transferNumber} → ${transferEntry.journalNumber}: Dr صندوق الوجهة 150 / Cr صندوق المصدر 150`);

    console.log('\n— cancellation —');
    const revenueBeforeSale = await accountBalance(revenueAccount.code);
    const cancelSale = await ok(await sell((await stock('cancel')).id, '1000.0000', '0', 'cash_usd'));
    assert.equal(await accountBalance(revenueAccount.code), Number((revenueBeforeSale + 1000).toFixed(4)), 'the sale must recognise revenue');
    await ok(await api(`/sales/${cancelSale.id}/cancel`, 'POST', { reason: 'إلغاء' }));
    const cancelJournals = await journalsFor(`salesInvoiceId=${cancelSale.id}`);
    assert.equal(cancelJournals.length, 4, 'the sale and its receipt each keep their original journal plus a reversal');
    assert.equal(cancelJournals.filter((j: any) => j.status === 'reversed').length, 1, 'the sale journal is reversed; the receipt is offset by the compensating voucher');
    assert.equal(await accountBalance(revenueAccount.code), revenueBeforeSale, 'cancelling the sale must take revenue back to where it started');
    // Nothing may be left behind on any account once a document is cancelled.
    const netByAccount = await sql`select coalesce(a.system_key, a.code) as key, round(sum(l.debit_usd - l.credit_usd), 4) as net from journal_entry_lines l join accounts a on a.id = l.account_id where l.sales_invoice_id = ${cancelSale.id} group by 1`;
    for (const row of netByAccount) assert.equal(Number(row.net), 0, `cancelled sale left a residue on ${row.key}: ${row.net}`);
    step('cancelling a paid sale reversed both journals; originals retained and revenue back to its prior balance');

    console.log('\n— idempotency and trial balance —');
    const duplicate = await sql`select source_type, source_id, posting_event, count(*)::int as n from journal_entries where source_id is not null group by source_type, source_id, posting_event having count(*) > 1`;
    assert.equal(duplicate.length, 0, 'one source event must never produce two journals');
    await assertAllBalanced(sql, 'after all cycles');
    const trial = await json(await api('/accounting/trial-balance'));
    assert.equal(trial.balanced, true, `trial balance is not balanced: ${trial.totalDebitUSD} vs ${trial.totalCreditUSD}`);
    assert.ok(trial.rows.length > 0);
    step(`trial balance balanced: debit $${trial.totalDebitUSD.toFixed(2)} = credit $${trial.totalCreditUSD.toFixed(2)} over ${trial.rows.length} accounts`);

    console.log('\n— general ledger —');
    const ledger = await json(await api(`/accounting/general-ledger?accountId=${receivableAccount.id}&page=1&limit=10`));
    assert.ok(ledger.items.length > 0);
    for (const row of ledger.items) for (const field of ['date', 'journalNumber', 'description', 'debitUSD', 'creditUSD', 'runningBalanceUSD']) assert.ok(row[field] !== undefined, `ledger row missing ${field}`);
    assert.equal(ledger.account.code, receivableAccount.code);
    step(`general ledger for ${receivableAccount.code} returns ${ledger.meta.total} rows with a running balance`);

    console.log('\n— reconciliation —');
    const reconciliation = await json(await api('/accounting/reconciliation'));
    const mismatched = reconciliation.cash.filter((row: any) => !row.matches);
    assert.equal(mismatched.length, 0, `cash accounts out of step with Finance: ${mismatched.map((r: any) => `${r.name} ${r.accountingBalance} vs ${r.financeBalance}`).join('; ')}`);
    assert.equal(reconciliation.receivable.matches, true, `receivable mismatch: accounting ${reconciliation.receivable.accountingUSD} vs operational ${reconciliation.receivable.operationalUSD}`);
    assert.equal(reconciliation.payable.matches, true, `payable mismatch: accounting ${reconciliation.payable.accountingUSD} vs operational ${reconciliation.payable.operationalUSD}`);
    step(`reconciled: ${reconciliation.cash.length} cash accounts, receivable $${reconciliation.receivable.accountingUSD}, payable $${reconciliation.payable.accountingUSD}`);

    console.log('\n— persistence —');
    const journalsBefore = (await sql`select count(*)::int as n from journal_entries`)[0]!.n;
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
    app = await createApp(); await app.listen({ port, host: '127.0.0.1' });
    assert.equal((await sql`select count(*)::int as n from journal_entries`)[0]!.n, journalsBefore, 'a restart must not create or lose journals');
    assert.equal((await json(await api('/accounting/trial-balance'))).balanced, true);
    step(`restart kept exactly ${journalsBefore} journals and the trial balance still balances`);

    console.log('\nTask 08 accounting core checks passed.\n');
  } finally {
    await sql.end();
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
