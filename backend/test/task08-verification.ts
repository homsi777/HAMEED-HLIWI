import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 08 operational verification: one full accounting cycle on a live server,
// from chart of accounts through every document to the trial balance and reconciliation.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD!;
const port = 3010;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const bySource = async (query: string) => json(await api(`/accounting/journals/by-source?${query}`));
const lines = async (id: string) => (await json(await api(`/accounting/journals/${id}`))).lines;
const balanceOf = async (systemKey: string) => { const account = (await json(await api('/accounting/accounts'))).find((row: any) => row.systemKey === systemKey); return account ? account.balanceUSD : 0; };

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

    console.log('\n[1-2] Chart of accounts and cashbox mappings');
    const chart = await json(await api('/accounting/accounts'));
    const mappings = await json(await api('/accounting/mappings'));
    const boxes = await json(await api('/finance/cashboxes'));
    const usdBox = boxes.find((box: any) => box.currency === 'USD' && box.warehouseId === warehouseId && box.isDefault);
    const sypBox = boxes.find((box: any) => box.currency === 'SYP' && box.warehouseId === warehouseId && box.isDefault);
    assert.ok(mappings.some((row: any) => row.mappingKey === `cashbox:${usdBox.id}`), 'the USD cashbox must map to an account');
    assert.ok(mappings.some((row: any) => row.mappingKey === `cashbox:${sypBox.id}`), 'the SYP cashbox must map to an account');
    step(`${chart.length} accounts, ${mappings.length} mappings — USD and SYP cashboxes both mapped`);

    const customer = await ok(await api('/partners', 'POST', { name: `عميل ت8 ${token}`, type: 'customer' }));
    const supplier = await ok(await api('/partners', 'POST', { name: `مورد ت8 ${token}`, type: 'supplier' }));
    const stock = async (suffix: string) => ok(await api('/inventory', 'POST', { code: `T8-${token}-${suffix}`, name: `صنف ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '0.0000', warehouseId }));

    console.log('\n[3-4] Credit sale and its journal');
    const receivableBefore = await balanceOf('accounts_receivable');
    const revenueBefore = await balanceOf('sales_revenue');
    const sale = await ok(await api('/sales', 'POST', { warehouseId, customerId: customer.id, items: [{ inventoryItemId: (await stock('sale')).id, pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    const saleJournal = (await bySource(`salesInvoiceId=${sale.id}`))[0];
    const saleLines = await lines(saleJournal.id);
    assert.equal(saleJournal.totalDebitUSD, 1000); assert.equal(saleJournal.totalCreditUSD, 1000);
    assert.equal(await balanceOf('accounts_receivable'), Number((receivableBefore + 1000).toFixed(4)));
    assert.equal(await balanceOf('sales_revenue'), Number((revenueBefore + 1000).toFixed(4)));
    step(`sale ${sale.invoiceNumber} → ${saleJournal.journalNumber}: ${saleLines.map((l: any) => `${l.debitUSD ? 'Dr' : 'Cr'} ${l.accountName} ${(l.debitUSD || l.creditUSD).toFixed(2)}`).join(' / ')}`);

    console.log('\n[5-7] Receipt voucher settles the receivable');
    const cashBefore = await balanceOf('accounts_receivable');
    const receipt = await ok(await api('/finance/vouchers', 'POST', { type: 'receipt', partnerId: customer.id, currency: 'USD', amount: '400.0000', exchangeRateSypPerUsd: RATE, cashBoxId: usdBox.id, warehouseId, idempotencyKey: crypto.randomUUID() }));
    const receiptJournal = (await bySource(`voucherId=${receipt.id}`))[0];
    assert.equal((await lines(receiptJournal.id)).find((l: any) => l.accountCode === '12').creditUSD, 400);
    assert.equal(await balanceOf('accounts_receivable'), Number((cashBefore - 400).toFixed(4)));
    const statement = await json(await api(`/finance/partners/${customer.id}/statement`));
    assert.equal(statement.closingBalanceUSD, 600);
    step(`receipt ${receipt.voucherNumber} → ${receiptJournal.journalNumber}; customer balance now $${statement.closingBalanceUSD} in both ledgers`);

    console.log('\n[8-11] Purchase and supplier payment');
    const payableBefore = await balanceOf('accounts_payable');
    const purchase = await ok(await api('/purchases', 'POST', { warehouseId, supplierId: supplier.id, items: [{ itemName: `شراء ت8 ${token}`, code: `T8PUR-${token}`, category: 'متنوع', karat: '21', quantity: '1.000', grossWeightGrams: '50.000', stoneWeightGrams: '0.000', pricePerGramUSD: '100.0000', laborFeeUSDPerGram: '0.0000' }], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID() }));
    const purchaseJournal = (await bySource(`purchaseInvoiceId=${purchase.id}`))[0];
    assert.equal(await balanceOf('accounts_payable'), Number((payableBefore + 5000).toFixed(4)));
    const payment = await ok(await api('/finance/vouchers', 'POST', { type: 'payment', partnerId: supplier.id, currency: 'USD', amount: '2000.0000', exchangeRateSypPerUsd: RATE, cashBoxId: usdBox.id, warehouseId, idempotencyKey: crypto.randomUUID() }));
    const paymentJournal = (await bySource(`voucherId=${payment.id}`))[0];
    assert.equal(await balanceOf('accounts_payable'), Number((payableBefore + 3000).toFixed(4)));
    step(`purchase ${purchase.invoiceNumber} → ${purchaseJournal.journalNumber}, payment ${payment.voucherNumber} → ${paymentJournal.journalNumber}; payable $5000 → $3000`);

    console.log('\n[12-13] Expense voucher');
    const expense = await ok(await api('/finance/vouchers', 'POST', { type: 'expense', currency: 'USD', amount: '120.0000', exchangeRateSypPerUsd: RATE, cashBoxId: usdBox.id, warehouseId, category: `إيجار ${token}`, idempotencyKey: crypto.randomUUID() }));
    const expenseLines = await lines((await bySource(`voucherId=${expense.id}`))[0].id);
    assert.ok(expenseLines.some((l: any) => l.debitUSD === 120 && l.accountCode.startsWith('51')));
    step(`expense ${expense.voucherNumber} → Dr ${expenseLines.find((l: any) => l.debitUSD === 120).accountName} 120 / Cr نقدية 120`);

    console.log('\n[14-17] Sales return and purchase return');
    const returnable = await json(await api(`/returns/returnable?type=sales_return&invoiceId=${sale.id}`));
    const salesReturn = await ok(await api('/returns', 'POST', { type: 'sales_return', originalInvoiceId: sale.id, partnerId: customer.id, reason: 'إرجاع', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: returnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '10.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const salesReturnJournal = (await bySource(`returnInvoiceId=${salesReturn.id}`))[0];
    assert.ok((await lines(salesReturnJournal.id)).some((l: any) => l.accountCode === '42' && l.debitUSD === 1000));
    const purchaseReturnable = await json(await api(`/returns/returnable?type=purchase_return&invoiceId=${purchase.id}`));
    const purchaseReturn = await ok(await api('/returns', 'POST', { type: 'purchase_return', originalInvoiceId: purchase.id, partnerId: supplier.id, reason: 'رد للمورد', exchangeRateSypPerUsd: RATE, items: [{ sourceLineId: purchaseReturnable.lines[0].sourceLineId, quantity: '1.000', netWeightGrams: '50.000' }], refundUSD: '0', refundSYP: '0', idempotencyKey: crypto.randomUUID() }));
    const purchaseReturnJournal = (await bySource(`returnInvoiceId=${purchaseReturn.id}`))[0];
    assert.equal(await balanceOf('accounts_payable'), payableBefore - 2000 + 0);
    step(`sales return → ${salesReturnJournal.journalNumber} (مردودات مبيعات), purchase return → ${purchaseReturnJournal.journalNumber} (تخفيض ذمة المورد)`);

    console.log('\n[18-19] Cashbox transfer');
    const spare = await ok(await api('/finance/cashboxes', 'POST', { name: `صندوق ت8 ${token}`, currency: 'USD', warehouseId, openingBalance: '500.0000' }));
    const transfer = await ok(await api('/finance/transfers', 'POST', { fromCashboxId: spare.id, toCashboxId: usdBox.id, amountFrom: '200.0000', amountTo: '200.0000', exchangeRateSypPerUsd: RATE, note: 'تعزيز', idempotencyKey: crypto.randomUUID() }));
    const transferJournal = (await json(await api(`/accounting/journals?sourceType=cashbox_transfer&search=${encodeURIComponent(transfer.transferNumber)}`))).items[0];
    const transferLines = await lines(transferJournal.id);
    assert.equal(transferLines.length, 2);
    assert.ok(transferLines.every((l: any) => l.cashboxId), 'both legs must be cash accounts');
    step(`transfer ${transfer.transferNumber} → ${transferJournal.journalNumber}: cash to cash only, no revenue or expense`);

    console.log('\n[20] General ledger');
    const receivableAccount = (await json(await api('/accounting/accounts'))).find((row: any) => row.systemKey === 'accounts_receivable');
    const ledger = await json(await api(`/accounting/general-ledger?accountId=${receivableAccount.id}&page=1&limit=5`));
    assert.ok(ledger.items.length > 0 && ledger.items.every((row: any) => row.runningBalanceUSD !== undefined));
    step(`general ledger for ${ledger.account.code} ${ledger.account.nameAr}: ${ledger.meta.total} movements, closing ${ledger.closingBalanceUSD.toFixed(2)}`);

    console.log('\n[21-22] Trial balance');
    const trial = await json(await api('/accounting/trial-balance'));
    assert.equal(trial.balanced, true);
    step(`debit ${trial.totalDebitUSD.toFixed(2)} = credit ${trial.totalCreditUSD.toFixed(2)} across ${trial.rows.length} accounts`);

    console.log('\n[23-25] Reconciliation with the operational modules');
    const reconciliation = await json(await api('/accounting/reconciliation'));
    const badCash = reconciliation.cash.filter((row: any) => !row.matches);
    assert.equal(badCash.length, 0, `cash mismatch: ${badCash.map((r: any) => r.name).join(', ')}`);
    assert.equal(reconciliation.receivable.matches, true, `receivable unexplained ${reconciliation.receivable.unexplainedUSD}`);
    assert.equal(reconciliation.payable.matches, true, `payable unexplained ${reconciliation.payable.unexplainedUSD}`);
    step(`cashboxes ${reconciliation.cash.length}/${reconciliation.cash.length} match · receivable and payable reconcile with no unexplained remainder`);

    console.log('\n[26-27] Restart and duplicate check');
    const before = (await sql`select count(*)::int as n from journal_entries`)[0]!.n;
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
    app = await createApp(); await app.listen({ port, host: '127.0.0.1' });
    assert.equal((await sql`select count(*)::int as n from journal_entries`)[0]!.n, before);
    const duplicates = await sql`select source_type, source_id, posting_event from journal_entries where source_id is not null group by source_type, source_id, posting_event having count(*) > 1`;
    assert.equal(duplicates.length, 0, 'no source event may be posted twice');
    assert.equal((await json(await api('/accounting/trial-balance'))).balanced, true);
    step(`restart kept ${before} journals, no duplicate source postings, trial balance still balanced`);

    console.log('\nTask 08 local operational verification passed.\n');
  } finally {
    await sql.end();
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
