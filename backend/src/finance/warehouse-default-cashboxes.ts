import { and, eq, isNull } from 'drizzle-orm';
import { cashboxes } from '../database/schema.js';

export const DEFAULT_WAREHOUSE_CURRENCIES = ['USD', 'SYP'] as const;
export type WarehouseCashCurrency = typeof DEFAULT_WAREHOUSE_CURRENCIES[number];

/**
 * Every warehouse owns a separate cashbox for each operating currency.  Keeping this
 * here (rather than only in the warehouse screen) also repairs older warehouses the
 * first time they record a cash document.
 */
export async function ensureWarehouseDefaultCashboxes(
  tx: any,
  warehouseId: string,
  actorUserId: string,
  currencies: readonly WarehouseCashCurrency[] = DEFAULT_WAREHOUSE_CURRENCIES,
) {
  const resolved = new Map<WarehouseCashCurrency, any>();
  for (const currency of currencies) {
    let cashbox = (await tx.select().from(cashboxes).where(and(
      eq(cashboxes.warehouseId, warehouseId),
      eq(cashboxes.currency, currency),
      eq(cashboxes.isDefault, true),
      eq(cashboxes.isActive, true),
      isNull(cashboxes.archivedAt),
    )).limit(1))[0];

    if (!cashbox) {
      // The partial unique index on (warehouse, currency) makes this safe when two
      // invoices arrive at the same instant; the second transaction simply re-reads it.
      await tx.insert(cashboxes).values({
        name: `صندوق المستودع الافتراضي ${currency}`,
        currency,
        warehouseId,
        openingBalance: '0',
        isDefault: true,
        isActive: true,
        notes: 'تم إنشاؤه تلقائياً للمستودع',
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      }).onConflictDoNothing();
      cashbox = (await tx.select().from(cashboxes).where(and(
        eq(cashboxes.warehouseId, warehouseId),
        eq(cashboxes.currency, currency),
        eq(cashboxes.isDefault, true),
        eq(cashboxes.isActive, true),
        isNull(cashboxes.archivedAt),
      )).limit(1))[0];
    }
    if (cashbox) resolved.set(currency, cashbox);
  }
  return resolved;
}
