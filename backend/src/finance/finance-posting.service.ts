import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { cashMovements, cashboxes, partnerLedgerEntries, voucherSequences, vouchers } from '../database/schema.js';
import { AccountingDocumentsService } from '../accounting/accounting-documents.service.js';
import { DocumentNumberService } from '../common/document-number.service.js';

export type CashCurrency = 'USD' | 'SYP';
export type VoucherKind = 'receipt' | 'payment' | 'expense';
export type LedgerDirection = 'debit' | 'credit';

const PREFIX: Record<VoucherKind, string> = { receipt: 'RCV', payment: 'PAY', expense: 'EXP' };

export type PostVoucherInput = {
  type: VoucherKind;
  sourceType: 'manual' | 'sale' | 'purchase' | 'sales_return' | 'purchase_return' | 'cashbox_transfer' | 'expense';
  sourcePaymentId?: string | null;
  sourceDocumentNumber?: string | null;
  salesInvoiceId?: string | null;
  purchaseInvoiceId?: string | null;
  returnInvoiceId?: string | null;
  cashboxTransferId?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  warehouseId?: string | null;
  cashboxId?: string | null;
  // Used by controlled foreign-currency disbursements: the voucher keeps the amount
  // physically delivered, while the selected USD cashbox moves its USD equivalent.
  cashboxCurrency?: CashCurrency;
  cashboxAmount?: string;
  currency: CashCurrency;
  amount: string;
  exchangeRateSypPerUsd: string;
  systemNote: string;
  userNote?: string | null;
  expenseCategory?: string | null;
  ledgerEntryType?: 'sale' | 'purchase' | 'sales_return' | 'purchase_return' | 'receipt' | 'payment' | 'reversal' | null;
  ledgerDirection?: LedgerDirection | null;
  idempotencyKey: string;
  reversalOfVoucherId?: string | null;
  occurredAt?: Date;
};

// Every financial document is written here so the same rules apply whether the money
// moved because a sale was posted or because a cashier recorded a manual receipt.
@Injectable()
export class FinancePostingService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(AccountingDocumentsService) private readonly accounting: AccountingDocumentsService, @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService) {}

  usdEquivalent(currency: CashCurrency, amount: string, exchangeRate: string) {
    return currency === 'USD' ? Number(amount).toFixed(4) : (Number(amount) / Number(exchangeRate)).toFixed(4);
  }

  // A cash document without a cashbox is a lie, so posting fails loudly rather than
  // letting an invoice claim money moved into a box that was never configured.
  async resolveCashbox(tx: any, currency: CashCurrency, warehouseId: string | null | undefined, explicitCashboxId?: string | null) {
    if (explicitCashboxId) {
      const chosen = (await tx.select().from(cashboxes).where(and(eq(cashboxes.id, explicitCashboxId), eq(cashboxes.isActive, true), isNull(cashboxes.archivedAt))).limit(1))[0];
      if (!chosen) throw new ConflictException('The selected cashbox is not available.');
      if (chosen.currency !== currency) throw new ConflictException(`The selected cashbox holds ${chosen.currency}, not ${currency}.`);
      if (chosen.warehouseId && warehouseId && chosen.warehouseId !== warehouseId) throw new ConflictException('The selected cashbox belongs to another warehouse.');
      return chosen;
    }
    const scoped = warehouseId
      ? (await tx.select().from(cashboxes).where(and(eq(cashboxes.warehouseId, warehouseId), eq(cashboxes.currency, currency), eq(cashboxes.isDefault, true), eq(cashboxes.isActive, true), isNull(cashboxes.archivedAt))).limit(1))[0]
      : undefined;
    if (scoped) return scoped;
    const company = (await tx.select().from(cashboxes).where(and(isNull(cashboxes.warehouseId), eq(cashboxes.currency, currency), eq(cashboxes.isDefault, true), eq(cashboxes.isActive, true), isNull(cashboxes.archivedAt))).limit(1))[0];
    if (company) return company;
    throw new ConflictException(`No default ${currency} cashbox is configured for this warehouse. Create one in Finance before recording ${currency} cash.`);
  }

  async postVoucher(tx: any, user: AuthIdentity, input: PostVoucherInput) {
    const cashbox = await this.resolveCashbox(tx, input.cashboxCurrency ?? input.currency, input.warehouseId, input.cashboxId);
    const year = new Date().getUTCFullYear();
    // Receipts, payments and expenses all read `HH####`, so they share one counter: three
    // separate ones would eventually print the same voucher number on two documents.
    const { sequence, number: voucherNumber } = await this.numbers.next(tx, 'voucher');
    const amountUsdEquivalent = this.usdEquivalent(input.currency, input.amount, input.exchangeRateSypPerUsd);

    const voucher = (await tx.insert(vouchers).values({
      voucherNumber, voucherYear: year, sequenceNumber: sequence, type: input.type,
      sourceType: input.sourceType, sourcePaymentId: input.sourcePaymentId ?? null, sourceDocumentNumber: input.sourceDocumentNumber ?? null,
      salesInvoiceId: input.salesInvoiceId ?? null, purchaseInvoiceId: input.purchaseInvoiceId ?? null, returnInvoiceId: input.returnInvoiceId ?? null, cashboxTransferId: input.cashboxTransferId ?? null,
      partnerId: input.partnerId ?? null, partnerNameSnapshot: input.partnerName ?? null, cashboxId: cashbox.id, warehouseId: input.warehouseId ?? cashbox.warehouseId ?? null,
      currency: input.currency, amount: input.amount, exchangeRateSypPerUsd: input.exchangeRateSypPerUsd, amountUsdEquivalent,
      expenseCategory: input.expenseCategory ?? null, systemNote: input.systemNote, userNote: input.userNote ?? null,
      reversalOfVoucherId: input.reversalOfVoucherId ?? null, idempotencyKey: input.idempotencyKey, createdByUserId: user.id, updatedByUserId: user.id,
    }).returning())[0]!;

    // Movements are the authority for every cash balance; they are never edited or removed.
    const cashboxCurrency = input.cashboxCurrency ?? input.currency;
    const cashboxAmount = input.cashboxAmount ?? input.amount;
    await tx.insert(cashMovements).values({
      cashboxId: cashbox.id, voucherId: voucher.id, cashboxTransferId: input.cashboxTransferId ?? null,
      direction: input.type === 'receipt' ? 'inflow' : 'outflow', amount: cashboxAmount, currency: cashboxCurrency, exchangeRateSypPerUsd: input.exchangeRateSypPerUsd, amountUsdEquivalent,
      partnerId: input.partnerId ?? null, warehouseId: input.warehouseId ?? cashbox.warehouseId ?? null,
      salesInvoiceId: input.salesInvoiceId ?? null, purchaseInvoiceId: input.purchaseInvoiceId ?? null, returnInvoiceId: input.returnInvoiceId ?? null,
      actorUserId: user.id, description: `${voucher.voucherNumber} — ${input.systemNote}`,
    });

    // A transfer leg is accounted once as a single balanced entry by postTransfer, so
    // its individual vouchers are skipped here to avoid posting the movement twice.
    if (input.sourceType !== 'cashbox_transfer') {
      await this.accounting.postVoucher(tx, user, {
        id: voucher.id, voucherNumber: voucher.voucherNumber, type: input.type, sourceType: input.sourceType,
        partnerId: input.partnerId ?? null, warehouseId: input.warehouseId ?? cashbox.warehouseId ?? null, cashboxId: cashbox.id,
        expenseCategory: input.expenseCategory ?? null, systemNote: input.systemNote,
        salesInvoiceId: input.salesInvoiceId ?? null, purchaseInvoiceId: input.purchaseInvoiceId ?? null, returnInvoiceId: input.returnInvoiceId ?? null,
        money: { currency: cashboxCurrency, originalAmount: Number(cashboxAmount), amountUsd: Number(amountUsdEquivalent), rate: Number(input.exchangeRateSypPerUsd) },
      });
    }

    if (input.partnerId && input.ledgerEntryType && input.ledgerDirection) {
      await this.recordLedgerEntry(tx, user, {
        partnerId: input.partnerId, entryType: input.ledgerEntryType, direction: input.ledgerDirection, amountUsd: amountUsdEquivalent,
        currency: input.currency, originalAmount: input.amount, exchangeRateSypPerUsd: input.exchangeRateSypPerUsd,
        salesInvoiceId: input.salesInvoiceId, purchaseInvoiceId: input.purchaseInvoiceId, returnInvoiceId: input.returnInvoiceId, voucherId: voucher.id,
        documentNumber: voucher.voucherNumber, description: input.systemNote, warehouseId: input.warehouseId ?? cashbox.warehouseId ?? null, occurredAt: input.occurredAt,
      });
    }
    return voucher;
  }

  async recordLedgerEntry(tx: any, user: AuthIdentity, entry: {
    partnerId: string; entryType: 'opening' | 'sale' | 'purchase' | 'sales_return' | 'purchase_return' | 'receipt' | 'payment' | 'reversal'; direction: LedgerDirection; amountUsd: string;
    currency?: CashCurrency; originalAmount?: string; exchangeRateSypPerUsd: string;
    salesInvoiceId?: string | null; purchaseInvoiceId?: string | null; returnInvoiceId?: string | null; voucherId?: string | null;
    documentNumber?: string | null; description: string; warehouseId?: string | null; reversalOfEntryId?: string | null; occurredAt?: Date;
  }) {
    if (Number(entry.amountUsd) <= 0) return null;
    return (await tx.insert(partnerLedgerEntries).values({
      partnerId: entry.partnerId, entryType: entry.entryType,
      debitUsd: entry.direction === 'debit' ? entry.amountUsd : '0', creditUsd: entry.direction === 'credit' ? entry.amountUsd : '0',
      currency: entry.currency ?? 'USD', originalAmount: entry.originalAmount ?? entry.amountUsd, exchangeRateSypPerUsd: entry.exchangeRateSypPerUsd,
      salesInvoiceId: entry.salesInvoiceId ?? null, purchaseInvoiceId: entry.purchaseInvoiceId ?? null, returnInvoiceId: entry.returnInvoiceId ?? null, voucherId: entry.voucherId ?? null,
      documentNumber: entry.documentNumber ?? null, description: entry.description, warehouseId: entry.warehouseId ?? null, reversalOfEntryId: entry.reversalOfEntryId ?? null, ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
      actorUserId: user.id,
    }).returning())[0]!;
  }

  // Cancelling a document never erases its money. It marks the original cancelled and
  // writes an equal, opposite document so both remain visible in the history.
  async reverseVoucher(tx: any, user: AuthIdentity, voucher: any, reason: string) {
    const opposite: VoucherKind = voucher.type === 'receipt' ? 'payment' : 'receipt';
    const cancelled = (await tx.update(vouchers).set({ status: 'cancelled', cancelledAt: new Date(), cancelledByUserId: user.id, cancellationReason: reason, updatedByUserId: user.id, updatedAt: new Date(), version: sql`${vouchers.version} + 1` }).where(and(eq(vouchers.id, voucher.id), eq(vouchers.status, 'posted'))).returning())[0];
    if (!cancelled) return null;
    const ledgerEntry = (await tx.select().from(partnerLedgerEntries).where(eq(partnerLedgerEntries.voucherId, voucher.id)).orderBy(desc(partnerLedgerEntries.createdAt)).limit(1))[0];
    return this.postVoucher(tx, user, {
      type: opposite, sourceType: voucher.sourceType, sourceDocumentNumber: voucher.sourceDocumentNumber,
      salesInvoiceId: voucher.salesInvoiceId, purchaseInvoiceId: voucher.purchaseInvoiceId, returnInvoiceId: voucher.returnInvoiceId,
      partnerId: voucher.partnerId, partnerName: voucher.partnerNameSnapshot, warehouseId: voucher.warehouseId, cashboxId: voucher.cashboxId,
      currency: voucher.currency, amount: voucher.amount, exchangeRateSypPerUsd: voucher.exchangeRateSypPerUsd,
      systemNote: `عكس ${voucher.voucherNumber}: ${reason}`, expenseCategory: voucher.expenseCategory,
      ledgerEntryType: ledgerEntry ? 'reversal' : null, ledgerDirection: ledgerEntry ? (Number(ledgerEntry.debitUsd) > 0 ? 'credit' : 'debit') : null,
      idempotencyKey: `reversal:${voucher.id}`, reversalOfVoucherId: voucher.id,
    });
  }

  // Reverses everything a cancelled invoice or return posted into finance: its vouchers
  // and, just as importantly, the document's own subledger entry. Leaving the latter
  // behind would keep a cancelled invoice inside the partner's balance forever.
  async reverseSourceDocument(tx: any, user: AuthIdentity, source: { salesInvoiceId?: string; purchaseInvoiceId?: string; returnInvoiceId?: string }, reason: string) {
    const column = source.salesInvoiceId ? vouchers.salesInvoiceId : source.purchaseInvoiceId ? vouchers.purchaseInvoiceId : vouchers.returnInvoiceId;
    const value = source.salesInvoiceId ?? source.purchaseInvoiceId ?? source.returnInvoiceId!;
    const posted = await tx.select().from(vouchers).where(and(eq(column, value), eq(vouchers.status, 'posted'), isNull(vouchers.reversalOfVoucherId)));
    for (const voucher of posted) await this.reverseVoucher(tx, user, voucher, reason);
    await this.reverseDocumentLedger(tx, user, source, reason);
    return posted.length;
  }

  // Writes the opposite of a document's own ledger entry. Voucher-linked entries are
  // skipped because their compensating voucher already carries its own reversal.
  async reverseDocumentLedger(tx: any, user: AuthIdentity, source: { salesInvoiceId?: string; purchaseInvoiceId?: string; returnInvoiceId?: string }, reason: string) {
    const column = source.salesInvoiceId ? partnerLedgerEntries.salesInvoiceId : source.purchaseInvoiceId ? partnerLedgerEntries.purchaseInvoiceId : partnerLedgerEntries.returnInvoiceId;
    const value = source.salesInvoiceId ?? source.purchaseInvoiceId ?? source.returnInvoiceId!;
    const entries = await tx.select().from(partnerLedgerEntries).where(and(eq(column, value), isNull(partnerLedgerEntries.voucherId), isNull(partnerLedgerEntries.reversalOfEntryId)));
    let reversed = 0;
    for (const entry of entries) {
      const already = (await tx.select({ id: partnerLedgerEntries.id }).from(partnerLedgerEntries).where(eq(partnerLedgerEntries.reversalOfEntryId, entry.id)).limit(1))[0];
      if (already) continue;
      await this.recordLedgerEntry(tx, user, {
        partnerId: entry.partnerId, entryType: 'reversal', direction: Number(entry.debitUsd) > 0 ? 'credit' : 'debit',
        amountUsd: Number(entry.debitUsd) > 0 ? entry.debitUsd : entry.creditUsd,
        currency: entry.currency, originalAmount: entry.originalAmount, exchangeRateSypPerUsd: entry.exchangeRateSypPerUsd,
        salesInvoiceId: entry.salesInvoiceId, purchaseInvoiceId: entry.purchaseInvoiceId, returnInvoiceId: entry.returnInvoiceId,
        documentNumber: entry.documentNumber, description: `عكس ${entry.description}: ${reason}`, warehouseId: entry.warehouseId, reversalOfEntryId: entry.id,
      });
      reversed += 1;
    }
    return reversed;
  }

  // ------------------------------------------------------------ document posting
  // Each posted document writes what the partner now owes, then a voucher for every
  // payment fact that actually moved cash. The two together always net to the
  // remaining debt the invoice itself reports.
  async postSaleFinancials(tx: any, user: AuthIdentity, input: { invoiceId: string; invoiceNumber: string; partnerId: string; partnerName: string; warehouseId: string; finalTotalUsd: string; exchangeRateSypPerUsd: string; payments: any[] }) {
    const occurredAt = new Date();
    await this.recordLedgerEntry(tx, user, { partnerId: input.partnerId, entryType: 'sale', direction: 'debit', amountUsd: Number(input.finalTotalUsd).toFixed(4), exchangeRateSypPerUsd: input.exchangeRateSypPerUsd, salesInvoiceId: input.invoiceId, documentNumber: input.invoiceNumber, description: `فاتورة بيع ${input.invoiceNumber}`, warehouseId: input.warehouseId, occurredAt });
    for (const [index, payment] of input.payments.entries()) {
      const currency: CashCurrency = payment.method === 'cash_syp' ? 'SYP' : 'USD';
      const amount = currency === 'SYP' ? Number(payment.amountSyp).toFixed(4) : Number(payment.amountUsd).toFixed(4);
      if (Number(amount) <= 0) continue;
      await this.postVoucher(tx, user, {
        type: 'receipt', sourceType: 'sale', sourcePaymentId: payment.id, sourceDocumentNumber: input.invoiceNumber, salesInvoiceId: input.invoiceId,
        partnerId: input.partnerId, partnerName: input.partnerName, warehouseId: input.warehouseId,
        currency, amount, exchangeRateSypPerUsd: payment.exchangeRateSypPerUsd ?? input.exchangeRateSypPerUsd,
        systemNote: `قبض آلي عن فاتورة بيع ${input.invoiceNumber}`, ledgerEntryType: 'receipt', ledgerDirection: 'credit',
        idempotencyKey: `sale:${payment.id}`, occurredAt: new Date(occurredAt.getTime() + index + 1),
      });
    }
  }

  async postPurchaseFinancials(tx: any, user: AuthIdentity, input: { invoiceId: string; invoiceNumber: string; partnerId: string; partnerName: string; warehouseId: string; finalTotalUsd: string; exchangeRateSypPerUsd: string; payments: any[] }) {
    const occurredAt = new Date();
    await this.recordLedgerEntry(tx, user, { partnerId: input.partnerId, entryType: 'purchase', direction: 'credit', amountUsd: Number(input.finalTotalUsd).toFixed(4), exchangeRateSypPerUsd: input.exchangeRateSypPerUsd, purchaseInvoiceId: input.invoiceId, documentNumber: input.invoiceNumber, description: `فاتورة شراء ${input.invoiceNumber}`, warehouseId: input.warehouseId, occurredAt });
    for (const [index, payment] of input.payments.entries()) {
      const currency: CashCurrency = payment.method === 'cash_syp' ? 'SYP' : 'USD';
      const amount = currency === 'SYP' ? Number(payment.amountSyp).toFixed(4) : Number(payment.amountUsd).toFixed(4);
      if (Number(amount) <= 0) continue;
      await this.postVoucher(tx, user, {
        type: 'payment', sourceType: 'purchase', sourcePaymentId: payment.id, sourceDocumentNumber: input.invoiceNumber, purchaseInvoiceId: input.invoiceId,
        partnerId: input.partnerId, partnerName: input.partnerName, warehouseId: input.warehouseId,
        currency, amount, exchangeRateSypPerUsd: payment.exchangeRateSypPerUsd ?? input.exchangeRateSypPerUsd,
        systemNote: `صرف آلي عن فاتورة شراء ${input.invoiceNumber}`, ledgerEntryType: 'payment', ledgerDirection: 'debit',
        idempotencyKey: `purchase:${payment.id}`, occurredAt: new Date(occurredAt.getTime() + index + 1),
      });
    }
  }

  // A sales return credits the customer for the whole return, then any cash actually
  // handed back is a payment that settles part of that credit immediately.
  async postReturnFinancials(tx: any, user: AuthIdentity, input: { returnId: string; returnNumber: string; type: 'sales_return' | 'purchase_return'; partnerId: string; partnerName: string; warehouseId: string; finalTotalUsd: string; exchangeRateSypPerUsd: string; payments: any[] }) {
    const isSalesReturn = input.type === 'sales_return';
    const occurredAt = new Date();
    await this.recordLedgerEntry(tx, user, {
      partnerId: input.partnerId, entryType: input.type, direction: isSalesReturn ? 'credit' : 'debit', amountUsd: Number(input.finalTotalUsd).toFixed(4), exchangeRateSypPerUsd: input.exchangeRateSypPerUsd,
      returnInvoiceId: input.returnId, documentNumber: input.returnNumber, description: `${isSalesReturn ? 'مرتجع مبيعات' : 'مرتجع مشتريات'} ${input.returnNumber}`, warehouseId: input.warehouseId, occurredAt,
    });
    for (const [index, payment] of input.payments.entries()) {
      if (payment.method === 'credit_note') continue;
      const currency: CashCurrency = payment.method === 'cash_syp' ? 'SYP' : 'USD';
      const amount = currency === 'SYP' ? Number(payment.amountSyp).toFixed(4) : Number(payment.amountUsd).toFixed(4);
      if (Number(amount) <= 0) continue;
      await this.postVoucher(tx, user, {
        type: isSalesReturn ? 'payment' : 'receipt', sourceType: input.type, sourcePaymentId: payment.id, sourceDocumentNumber: input.returnNumber, returnInvoiceId: input.returnId,
        partnerId: input.partnerId, partnerName: input.partnerName, warehouseId: input.warehouseId,
        currency, amount, exchangeRateSypPerUsd: payment.exchangeRateSypPerUsd ?? input.exchangeRateSypPerUsd,
        systemNote: isSalesReturn ? `رد مبلغ للعميل عن مرتجع ${input.returnNumber}` : `قبض من المورد عن مرتجع مشتريات ${input.returnNumber}`,
        ledgerEntryType: isSalesReturn ? 'payment' : 'receipt', ledgerDirection: isSalesReturn ? 'debit' : 'credit',
        idempotencyKey: `${input.type}:${payment.id}`, occurredAt: new Date(occurredAt.getTime() + index + 1),
      });
    }
  }

  // Lets an invoice screen show exactly which vouchers and cashboxes it produced.
  async documentFinancials(documentId: string, kind: 'sales' | 'purchases' | 'returns', db: any = this.db) {
    const column = kind === 'sales' ? vouchers.salesInvoiceId : kind === 'purchases' ? vouchers.purchaseInvoiceId : vouchers.returnInvoiceId;
    const rows = await db.select({ voucher: vouchers, cashboxName: cashboxes.name }).from(vouchers).innerJoin(cashboxes, eq(cashboxes.id, vouchers.cashboxId)).where(eq(column, documentId)).orderBy(asc(vouchers.createdAt), asc(vouchers.id));
    return {
      vouchers: rows.map((row: any) => ({
        id: row.voucher.id, voucherNumber: row.voucher.voucherNumber, type: row.voucher.type, status: row.voucher.status, sourceType: row.voucher.sourceType,
        currency: row.voucher.currency, amount: Number(row.voucher.amount), amountUSD: Number(row.voucher.amountUsdEquivalent), exchangeRate: Number(row.voucher.exchangeRateSypPerUsd),
        cashBoxId: row.voucher.cashboxId, cashboxName: row.cashboxName, systemNote: row.voucher.systemNote ?? '', createdAt: row.voucher.createdAt.toISOString(),
      })),
    };
  }

  async cashboxBalance(cashboxId: string, db: any = this.db) {
    const rows = await db.select({
      opening: cashboxes.openingBalance,
      inflow: sql<string>`coalesce((select sum(amount) from cash_movements where cashbox_id = ${cashboxId} and direction = 'inflow'), 0)`,
      outflow: sql<string>`coalesce((select sum(amount) from cash_movements where cashbox_id = ${cashboxId} and direction = 'outflow'), 0)`,
    }).from(cashboxes).where(eq(cashboxes.id, cashboxId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return Number(row.opening) + Number(row.inflow) - Number(row.outflow);
  }

  // Positive means the partner owes the shop; negative means the shop owes the partner.
  async partnerNetUsd(partnerId: string, db: any = this.db) {
    const rows = await db.select({ value: sql<string>`coalesce(sum(${partnerLedgerEntries.debitUsd} - ${partnerLedgerEntries.creditUsd}), 0)` }).from(partnerLedgerEntries).where(eq(partnerLedgerEntries.partnerId, partnerId));
    return Number(rows[0]?.value ?? 0);
  }
}
