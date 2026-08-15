import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { appSettings, goldPrices, settingsHistory, type AppSettingsRow, type GoldPriceRow } from '../database/schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

const KARATS = ['24', '22', '21', '18', '14'] as const;

/** Text fields carried straight through, with a length ceiling so nothing unbounded is stored. */
const TEXT_FIELDS = ['storeName', 'storeSubtitle', 'address', 'branchName', 'phone1', 'phone2'] as const;
/** Numeric fields and the scale each is stored at. */
const NUMERIC_FIELDS = {
  usdToSypRate: 4, baseGoldOunceUsd: 4, baseGoldGram24kUsd: 4,
  buyMarginPercent: 4, sellMarginPercent: 4, taxRatePercent: 4,
} as const;
const PRICE_FIELDS = {
  buyPriceUsdPerGram: 4, sellPriceUsdPerGram: 4, buyPriceSypPerGram: 2, sellPriceSypPerGram: 2, laborFeeUsdPerGram: 4,
} as const;

const text = (value: unknown, field: string, max = 200) => {
  if (typeof value !== 'string') throw new ConflictException(`${field} is invalid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ConflictException(`${field} is too long.`);
  return trimmed;
};
const decimal = (value: unknown, field: string, scale: number, minimum = 0) => {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(raw)) throw new ConflictException(`${field} is invalid.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new ConflictException(`${field} is invalid.`);
  return parsed.toFixed(scale);
};

const settingsDto = (row: AppSettingsRow, prices: GoldPriceRow[]) => ({
  storeName: row.storeName, storeSubtitle: row.storeSubtitle, address: row.address, branchName: row.branchName,
  phone1: row.phone1, phone2: row.phone2,
  primaryCurrency: 'USD' as const, secondaryCurrency: 'SYP' as const,
  usdToSypRate: Number(row.usdToSypRate),
  baseGoldOunceUSD: Number(row.baseGoldOunceUsd), baseGoldGram24kUSD: Number(row.baseGoldGram24kUsd),
  buyMarginPercent: Number(row.buyMarginPercent), sellMarginPercent: Number(row.sellMarginPercent),
  taxRatePercent: Number(row.taxRatePercent), autoSyncGoldPrices: row.autoSyncGoldPrices,
  // TASK 18 §5: true while the values are the ones the migration derived from past documents
  // rather than ones a human confirmed. The UI says so loudly until it is cleared.
  isProvisional: row.isProvisional,
  version: row.version, updatedAt: row.updatedAt.toISOString(),
  goldPrices: prices.map(price => ({
    karat: price.karat,
    buyPriceUSDPerGram: Number(price.buyPriceUsdPerGram), sellPriceUSDPerGram: Number(price.sellPriceUsdPerGram),
    buyPriceSYPPerGram: Number(price.buyPriceSypPerGram), sellPriceSYPPerGram: Number(price.sellPriceSypPerGram),
    laborFeeUSDPerGram: Number(price.laborFeeUsdPerGram),
    version: price.version,
  })),
});

/**
 * TASK 18: the shop's operating parameters, held on the server.
 *
 * These values used to live in each browser's localStorage, which meant two devices could price
 * the same goods differently on the same day and nothing would notice. They are now read from one
 * place by every session.
 *
 * What this service must never do is reach backwards. Every posted document already snapshots the
 * exchange rate it was written with; changing the rate here changes what the *next* document will
 * use and nothing else. There is deliberately no code path in this file that touches a document.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  /** §14: any authenticated session may read. A seller cannot price a sale without the gold price. */
  async get() {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row) throw new NotFoundException('Settings have not been initialised.');
    const prices = await this.db.select().from(goldPrices).orderBy(asc(goldPrices.karat));
    return settingsDto(row, prices);
  }

  /** §15/§16: guarded by `settings.manage` at the controller; enforced by the server, not the UI. */
  async update(user: AuthIdentity, input: Record<string, unknown>) {
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 1) throw new ConflictException('version is invalid.');

    const changes: Record<string, string | boolean> = {};
    for (const field of TEXT_FIELDS) if (input[field] !== undefined) changes[field] = text(input[field], field);
    for (const [field, scale] of Object.entries(NUMERIC_FIELDS)) {
      // The response spells these `…USD`, so accept the shape the client was handed back as well
      // as the column name. A client that echoes what it was given must not be silently ignored.
      const supplied = input[field] ?? input[field.replace(/Usd$/, 'USD')];
      if (supplied !== undefined) (input as Record<string, unknown>)[field] = supplied;
      if (input[field] === undefined) continue;
      // The rate is the one value that must be positive: a zero rate would make every SYP figure
      // in the system meaningless, and the database check would reject it anyway.
      changes[field] = decimal(input[field], field, scale, field === 'usdToSypRate' ? 0.0001 : 0);
    }
    if (input.autoSyncGoldPrices !== undefined) changes.autoSyncGoldPrices = input.autoSyncGoldPrices === true;
    if (!Object.keys(changes).length) throw new ConflictException('No settings were supplied.');

    const updated = await this.db.transaction(async tx => {
      const [current] = await tx.select().from(appSettings).for('update').limit(1);
      if (!current) throw new NotFoundException('Settings have not been initialised.');
      if (current.version !== version) throw new ConflictException('Settings were changed by someone else. Reload and retry.');

      const [row] = await tx.update(appSettings)
        .set({ ...changes, isProvisional: false, version: sql`${appSettings.version} + 1`, updatedByUserId: user.id, updatedAt: new Date() })
        .where(eq(appSettings.id, current.id)).returning();
      if (!row) throw new ConflictException('Settings could not be updated. Reload and retry.');

      // §4: append-only, one row per field that actually moved. A value re-saved unchanged is not
      // a change and does not earn a history row.
      for (const [field, value] of Object.entries(changes)) {
        const before = String((current as Record<string, unknown>)[field] ?? '');
        const after = String(value);
        if (before === after) continue;
        await tx.insert(settingsHistory).values({ scope: 'general', field, oldValue: before, newValue: after, actorUserId: user.id });
      }
      return row;
    });

    await this.audit.record({ actorUserId: user.id, action: 'settings.update', module: 'settings', entityId: updated.id });
    const dto = await this.get();
    this.realtime.emitToAll('settings.changed', { version: dto.version });
    return dto;
  }

  /** §10/§13: one row per karat, each versioned and each change recorded. */
  async updateGoldPrices(user: AuthIdentity, input: Record<string, unknown>) {
    const rows = Array.isArray(input.goldPrices) ? input.goldPrices : undefined;
    if (!rows?.length) throw new ConflictException('goldPrices is invalid.');

    const parsed = rows.map((entry: any) => {
      const karat = typeof entry?.karat === 'string' ? entry.karat : '';
      if (!KARATS.includes(karat as typeof KARATS[number])) throw new ConflictException('karat is invalid.');
      const values: Record<string, string> = {};
      for (const [field, scale] of Object.entries(PRICE_FIELDS)) {
        const supplied = entry[field] ?? entry[field.replace('Usd', 'USD').replace('Syp', 'SYP')];
        if (supplied !== undefined) values[field] = decimal(supplied, `${karat}.${field}`, scale);
      }
      if (!Object.keys(values).length) throw new ConflictException(`No prices were supplied for karat ${karat}.`);
      return { karat, values, version: Number(entry.version) };
    });

    await this.db.transaction(async tx => {
      for (const entry of parsed) {
        const [current] = await tx.select().from(goldPrices).where(eq(goldPrices.karat, entry.karat)).for('update').limit(1);
        if (!current) throw new NotFoundException(`Karat ${entry.karat} is not configured.`);
        if (Number.isInteger(entry.version) && current.version !== entry.version) throw new ConflictException(`The price for karat ${entry.karat} was changed by someone else. Reload and retry.`);

        await tx.update(goldPrices)
          .set({ ...entry.values, version: sql`${goldPrices.version} + 1`, updatedByUserId: user.id, updatedAt: new Date() })
          .where(eq(goldPrices.id, current.id));

        for (const [field, value] of Object.entries(entry.values)) {
          const before = String((current as Record<string, unknown>)[field] ?? '');
          if (before === value) continue;
          await tx.insert(settingsHistory).values({ scope: 'gold_price', karat: entry.karat, field, oldValue: before, newValue: value, actorUserId: user.id });
        }
      }
      // Confirming prices is confirming the shop's configuration.
      await tx.update(appSettings).set({ isProvisional: false, updatedAt: new Date() });
    });

    await this.audit.record({ actorUserId: user.id, action: 'settings.gold_prices.update', module: 'settings' });
    const dto = await this.get();
    this.realtime.emitToAll('settings.changed', { version: dto.version });
    return dto;
  }

  /** §4: what changed, from what, to what, by whom. Never edited, never deleted. */
  async history(query: Record<string, unknown>) {
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));
    const rows = await this.db.select().from(settingsHistory).orderBy(desc(settingsHistory.occurredAt)).limit(limit);
    return rows.map(row => ({
      id: row.id, scope: row.scope, karat: row.karat, field: row.field,
      oldValue: row.oldValue, newValue: row.newValue,
      actorUserId: row.actorUserId, occurredAt: row.occurredAt.toISOString(),
    }));
  }
}
