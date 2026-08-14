import { Inject, Injectable } from '@nestjs/common';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AccountingPostingService, type CashCurrency } from './accounting-posting.service.js';

type Money = { currency: CashCurrency; originalAmount: number; amountUsd: number; rate: number };

/**
 * Turns an operational document into the journal the posting model prescribes.
 * Every method is safe to call twice: the posting service keys on the source event.
 */
@Injectable()
export class AccountingDocumentsService {
  constructor(@Inject(AccountingPostingService) private readonly posting: AccountingPostingService) {}

  // Dr Accounts Receivable · Cr Sales Revenue — the settlement is a separate voucher.
  async postSale(tx: any, user: AuthIdentity, sale: { id: string; invoiceNumber: string; partnerId: string; warehouseId: string; finalTotalUsd: number; rate: number }) {
    if (sale.finalTotalUsd <= 0) return null;
    return this.posting.post(tx, user, {
      sourceType: 'sale', sourceId: sale.id, sourceNumber: sale.invoiceNumber, postingEvent: 'sale',
      description: `فاتورة بيع ${sale.invoiceNumber}`, warehouseId: sale.warehouseId, partnerId: sale.partnerId,
      lines: [
        { systemKey: 'accounts_receivable', debitUsd: sale.finalTotalUsd, exchangeRateSypPerUsd: sale.rate, partnerId: sale.partnerId, salesInvoiceId: sale.id, memo: `ذمة العميل عن ${sale.invoiceNumber}` },
        { systemKey: 'sales_revenue', creditUsd: sale.finalTotalUsd, exchangeRateSypPerUsd: sale.rate, salesInvoiceId: sale.id, memo: `إيراد مبيعات ${sale.invoiceNumber}` },
      ],
    });
  }

  // Dr Inventory/Purchases · Cr Accounts Payable.
  async postPurchase(tx: any, user: AuthIdentity, purchase: { id: string; invoiceNumber: string; partnerId: string; warehouseId: string; finalTotalUsd: number; rate: number }) {
    if (purchase.finalTotalUsd <= 0) return null;
    return this.posting.post(tx, user, {
      sourceType: 'purchase', sourceId: purchase.id, sourceNumber: purchase.invoiceNumber, postingEvent: 'purchase',
      description: `فاتورة شراء ${purchase.invoiceNumber}`, warehouseId: purchase.warehouseId, partnerId: purchase.partnerId,
      lines: [
        { systemKey: 'inventory', debitUsd: purchase.finalTotalUsd, exchangeRateSypPerUsd: purchase.rate, purchaseInvoiceId: purchase.id, memo: `مخزون ومشتريات ${purchase.invoiceNumber}` },
        { systemKey: 'accounts_payable', creditUsd: purchase.finalTotalUsd, exchangeRateSypPerUsd: purchase.rate, partnerId: purchase.partnerId, purchaseInvoiceId: purchase.id, memo: `ذمة المورد عن ${purchase.invoiceNumber}` },
      ],
    });
  }

  // Sales return: Dr Sales Returns · Cr Accounts Receivable — only the returned amount.
  // Purchase return: Dr Accounts Payable · Cr Inventory.
  async postReturn(tx: any, user: AuthIdentity, document: { id: string; returnNumber: string; type: 'sales_return' | 'purchase_return'; partnerId: string; warehouseId: string; finalTotalUsd: number; rate: number }) {
    if (document.finalTotalUsd <= 0) return null;
    const isSalesReturn = document.type === 'sales_return';
    return this.posting.post(tx, user, {
      sourceType: document.type, sourceId: document.id, sourceNumber: document.returnNumber, postingEvent: document.type,
      description: `${isSalesReturn ? 'مرتجع مبيعات' : 'مرتجع مشتريات'} ${document.returnNumber}`, warehouseId: document.warehouseId, partnerId: document.partnerId,
      lines: isSalesReturn
        ? [
            { systemKey: 'sales_returns', debitUsd: document.finalTotalUsd, exchangeRateSypPerUsd: document.rate, returnInvoiceId: document.id, memo: `مردودات مبيعات ${document.returnNumber}` },
            { systemKey: 'accounts_receivable', creditUsd: document.finalTotalUsd, exchangeRateSypPerUsd: document.rate, partnerId: document.partnerId, returnInvoiceId: document.id, memo: `تخفيض ذمة العميل عن ${document.returnNumber}` },
          ]
        : [
            { systemKey: 'accounts_payable', debitUsd: document.finalTotalUsd, exchangeRateSypPerUsd: document.rate, partnerId: document.partnerId, returnInvoiceId: document.id, memo: `تخفيض ذمة المورد عن ${document.returnNumber}` },
            { systemKey: 'inventory', creditUsd: document.finalTotalUsd, exchangeRateSypPerUsd: document.rate, returnInvoiceId: document.id, memo: `رد مخزون ${document.returnNumber}` },
          ],
    });
  }

  /**
   * A voucher always has a cash side. What it settles depends on where it came from:
   * a receipt against a sale settles the receivable, a payment for a purchase settles
   * the payable, and a refund on a sales return gives the receivable back.
   */
  async postVoucher(tx: any, user: AuthIdentity, voucher: {
    id: string; voucherNumber: string; type: 'receipt' | 'payment' | 'expense'; sourceType: string;
    partnerId: string | null; warehouseId: string | null; cashboxId: string; expenseCategory: string | null;
    salesInvoiceId?: string | null; purchaseInvoiceId?: string | null; returnInvoiceId?: string | null;
    money: Money; systemNote: string;
  }) {
    if (voucher.money.amountUsd <= 0) return null;
    const cashAccount = await this.posting.cashboxAccount(tx, user, voucher.cashboxId);
    const cashLine = {
      accountId: cashAccount.id, currency: voucher.money.currency, originalAmount: voucher.money.originalAmount,
      exchangeRateSypPerUsd: voucher.money.rate, cashboxId: voucher.cashboxId, warehouseId: voucher.warehouseId, voucherId: voucher.id, salesInvoiceId: voucher.salesInvoiceId ?? null, purchaseInvoiceId: voucher.purchaseInvoiceId ?? null, returnInvoiceId: voucher.returnInvoiceId ?? null, memo: voucher.systemNote,
    };
    const counterpart = { currency: 'USD' as CashCurrency, originalAmount: voucher.money.amountUsd, exchangeRateSypPerUsd: voucher.money.rate, partnerId: voucher.partnerId, voucherId: voucher.id, salesInvoiceId: voucher.salesInvoiceId ?? null, purchaseInvoiceId: voucher.purchaseInvoiceId ?? null, returnInvoiceId: voucher.returnInvoiceId ?? null, memo: voucher.systemNote };

    let lines;
    if (voucher.type === 'expense') {
      lines = [
        { ...counterpart, partnerId: null, accountId: (await this.posting.ensureExpenseAccount(tx, user, voucher.expenseCategory ?? 'مصاريف عامة')).id, debitUsd: voucher.money.amountUsd },
        { ...cashLine, creditUsd: voucher.money.amountUsd },
      ];
    } else {
      // Which balance the cash settles is decided by the document the voucher belongs
      // to, never by the direction of the cash. A reversal voucher flips the cash side
      // but still settles the same receivable or payable as the voucher it undoes.
      const settles = this.settlementAccount(voucher, await this.posting.partnerType(tx, voucher.partnerId));
      lines = voucher.type === 'receipt'
        ? [{ ...cashLine, debitUsd: voucher.money.amountUsd }, { ...counterpart, systemKey: settles, creditUsd: voucher.money.amountUsd }]
        : [{ ...counterpart, systemKey: settles, debitUsd: voucher.money.amountUsd }, { ...cashLine, creditUsd: voucher.money.amountUsd }];
    }

    return this.posting.post(tx, user, {
      sourceType: 'voucher', sourceId: voucher.id, sourceNumber: voucher.voucherNumber, postingEvent: 'voucher',
      description: `${voucher.voucherNumber} — ${voucher.systemNote}`, warehouseId: voucher.warehouseId, partnerId: voucher.partnerId,
      lines: lines as any,
    });
  }

  // A sale or a sales return always settles against the customer receivable; a purchase
  // or a purchase return always settles against the supplier payable. A manual voucher
  // falls back to the side implied by its direction.
  private settlementAccount(voucher: { sourceType: string; type: 'receipt' | 'payment' | 'expense'; salesInvoiceId?: string | null; purchaseInvoiceId?: string | null }, partnerType: string | null) {
    if (voucher.sourceType === 'sale' || voucher.sourceType === 'sales_return' || voucher.salesInvoiceId) return 'accounts_receivable';
    if (voucher.sourceType === 'purchase' || voucher.sourceType === 'purchase_return' || voucher.purchaseInvoiceId) return 'accounts_payable';
    if (partnerType === 'supplier') return 'accounts_payable';
    if (partnerType === 'customer' || partnerType === 'both') return 'accounts_receivable';
    return voucher.type === 'receipt' ? 'accounts_receivable' : 'accounts_payable';
  }

  /**
   * Dr destination cash · Cr source cash. Both legs carry the value that actually left
   * the source box, so no foreign-exchange gain or loss is invented; the destination's
   * own currency and amount stay visible on its line.
   */
  async postTransfer(tx: any, user: AuthIdentity, transfer: {
    id: string; transferNumber: string; note: string | null;
    from: { cashboxId: string; currency: CashCurrency; amount: number; warehouseId: string | null };
    to: { cashboxId: string; currency: CashCurrency; amount: number; warehouseId: string | null };
    rate: number;
  }) {
    const amountUsd = transfer.from.currency === 'USD' ? transfer.from.amount : Number((transfer.from.amount / transfer.rate).toFixed(4));
    if (amountUsd <= 0) return null;
    return this.posting.post(tx, user, {
      sourceType: 'cashbox_transfer', sourceId: transfer.id, sourceNumber: transfer.transferNumber, postingEvent: 'transfer',
      description: `مناقلة نقدية ${transfer.transferNumber}${transfer.note ? ` — ${transfer.note}` : ''}`, warehouseId: transfer.from.warehouseId,
      lines: [
        { accountId: (await this.posting.cashboxAccount(tx, user, transfer.to.cashboxId)).id, debitUsd: amountUsd, currency: transfer.to.currency, originalAmount: transfer.to.amount, exchangeRateSypPerUsd: transfer.rate, cashboxId: transfer.to.cashboxId, warehouseId: transfer.to.warehouseId, cashboxTransferId: transfer.id, memo: `وارد مناقلة ${transfer.transferNumber}` },
        { accountId: (await this.posting.cashboxAccount(tx, user, transfer.from.cashboxId)).id, creditUsd: amountUsd, currency: transfer.from.currency, originalAmount: transfer.from.amount, exchangeRateSypPerUsd: transfer.rate, cashboxId: transfer.from.cashboxId, warehouseId: transfer.from.warehouseId, cashboxTransferId: transfer.id, memo: `صادر مناقلة ${transfer.transferNumber}` },
      ],
    });
  }

  // Cancelling an operational document reverses everything it posted, including the
  // vouchers that settled it, so accounting and operations stay in step.
  async reverseDocument(tx: any, user: AuthIdentity, kind: 'sale' | 'purchase' | 'sales_return' | 'purchase_return' | 'voucher' | 'cashbox_transfer', sourceId: string, reason: string) {
    return this.posting.reverseSource(tx, user, kind, sourceId, reason);
  }

  // Opening balances are journals like everything else, never a written-in balance.
  async postPartnerOpening(tx: any, user: AuthIdentity, partner: { id: string; name: string; type: string; openingBalanceUsd: number; rate: number }) {
    if (Math.abs(partner.openingBalanceUsd) < 0.00005) return null;
    // A customer's whole relationship lives in Accounts Receivable and a supplier's in
    // Accounts Payable, whatever the sign. Keeping each partner on one account is what
    // lets the ledger reconcile against the operational balances line for line.
    const amount = Math.abs(partner.openingBalanceUsd);
    const partnerAccount = partner.type === 'supplier' ? 'accounts_payable' : 'accounts_receivable';
    const positive = partner.openingBalanceUsd > 0;
    const partnerSideIsDebit = partnerAccount === 'accounts_receivable' ? positive : !positive;
    return this.posting.post(tx, user, {
      sourceType: 'opening', sourceId: partner.id, sourceNumber: partner.name, postingEvent: 'partner_opening',
      description: `رصيد افتتاحي — ${partner.name}`, partnerId: partner.id,
      lines: [
        { systemKey: partnerAccount, [partnerSideIsDebit ? 'debitUsd' : 'creditUsd']: amount, exchangeRateSypPerUsd: partner.rate, partnerId: partner.id, memo: 'رصيد افتتاحي للطرف' } as any,
        { systemKey: 'opening_equity', [partnerSideIsDebit ? 'creditUsd' : 'debitUsd']: amount, exchangeRateSypPerUsd: partner.rate, memo: 'مقابل الرصيد الافتتاحي' } as any,
      ],
    });
  }

  async postCashboxOpening(tx: any, user: AuthIdentity, cashbox: { id: string; name: string; currency: CashCurrency; warehouseId: string | null; openingBalance: number; rate: number }) {
    if (cashbox.openingBalance <= 0) return null;
    const amountUsd = cashbox.currency === 'USD' ? cashbox.openingBalance : Number((cashbox.openingBalance / cashbox.rate).toFixed(4));
    if (amountUsd <= 0) return null;
    return this.posting.post(tx, user, {
      sourceType: 'opening', sourceId: cashbox.id, sourceNumber: cashbox.name, postingEvent: 'cashbox_opening',
      description: `رصيد افتتاحي — ${cashbox.name}`, warehouseId: cashbox.warehouseId,
      lines: [
        { accountId: (await this.posting.cashboxAccount(tx, user, cashbox.id)).id, debitUsd: amountUsd, currency: cashbox.currency, originalAmount: cashbox.openingBalance, exchangeRateSypPerUsd: cashbox.rate, cashboxId: cashbox.id, warehouseId: cashbox.warehouseId, memo: 'رصيد افتتاحي للصندوق' },
        { systemKey: 'opening_equity', creditUsd: amountUsd, exchangeRateSypPerUsd: cashbox.rate, memo: 'مقابل الرصيد الافتتاحي' },
      ],
    });
  }
}
