import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { documentSequences } from '../database/schema.js';

/**
 * The single definition of what a document number looks like.
 *
 * The owner asked for plain numbers on screen rather than coded references, so each kind
 * of document gets its own numeric range wide enough to stay the same length for the life
 * of the business. The range also tells you at a glance what you are looking at: a sale
 * starts with 1, a return with 2, a transfer with 3.
 *
 *   sale       100001…999999   six digits
 *   purchase  1000001…9999999  seven digits
 *   return     200001…299999   six digits
 *   voucher    HH1001…HH9999   two letters and four digits, receipts and payments together
 *   transfer   3001…9999       four digits
 *   shift      5001…9999       four digits
 *
 * Vouchers deliberately share one sequence: receipts and payments both read `HH####`, so
 * separate counters would eventually hand out the same number twice.
 *
 * Journals and gold transactions keep their coded numbers — those are internal accounting
 * screens where the prefix is the fastest way to tell a posting type apart, and the owner's
 * request was about the documents he reads.
 */
export type DocumentKind = 'sale' | 'purchase' | 'return' | 'voucher' | 'transfer' | 'shift';

const FORMAT: Record<DocumentKind, { base: number; render: (value: number) => string }> = {
  sale: { base: 100000, render: value => String(value) },
  purchase: { base: 1000000, render: value => String(value) },
  return: { base: 200000, render: value => String(value) },
  voucher: { base: 1000, render: value => `HH${value}` },
  transfer: { base: 3000, render: value => String(value) },
  shift: { base: 5000, render: value => String(value) },
};

@Injectable()
export class DocumentNumberService {
  /**
   * Reserves the next number for this document kind inside the caller's transaction, so a
   * rolled-back document does not leave a gap that looks like a deleted invoice, and two
   * concurrent sales can never be handed the same number.
   */
  async next(tx: any, kind: DocumentKind) {
    const format = FORMAT[kind];
    const row = (await tx.insert(documentSequences)
      .values({ key: kind, lastNumber: 1 })
      .onConflictDoUpdate({ target: documentSequences.key, set: { lastNumber: sql`${documentSequences.lastNumber} + 1`, updatedAt: new Date() } })
      .returning())[0]!;
    const sequence = row.lastNumber;
    return { sequence, number: format.render(format.base + sequence) };
  }

  // What the number for a given sequence position would be — used by the renumbering tool.
  format(kind: DocumentKind, sequence: number) {
    const format = FORMAT[kind];
    return format.render(format.base + sequence);
  }
}
