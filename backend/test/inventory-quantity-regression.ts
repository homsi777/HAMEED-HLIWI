import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Regression guard for the inventory save failure: a blank, comma-separated,
// Arabic-Indic, half-typed, or over-precise quantity used to reach the API raw and
// come back as "quantity is invalid.". The form now normalises before sending, so
// this checks both that the raw shapes are still rejected by the authoritative API
// and that every normalised shape the form now produces is accepted.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3004;
const base = `http://127.0.0.1:${port}/api/v1`;
type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };

// Mirrors readNumber + the payload normalisation in src/components/InventoryView.tsx.
const readNumber = (value: string) => {
  const normalized = value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/[\s٬⁦-⁩]/g, '')
    .trim();
  if (!normalized || !/^[+-]?\d*\.?\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    const warehouses = await (await fetch(`${base}/auth/login-warehouses`)).json() as Array<{ id: string }>;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: warehouses[0]!.id }) }) as ResponseWithCookies;
    const cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
    const warehouseId = warehouses[0]!.id;
    const token = crypto.randomUUID().slice(0, 8);
    const post = (body: unknown) => fetch(`${base}/inventory`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const item = (extra: Record<string, unknown>, suffix: string) => ({ code: `QTY-${token}-${suffix}`, name: `Quantity guard ${suffix}`, category: 'أطقم', karat: '21', grossWeightGrams: '10.000', stoneWeightGrams: '0.000', laborFeeUSDPerGram: '2.0000', warehouseId, status: 'in_stock', ...extra });

    // What the old form sent straight from the input box.
    const rawShapes: Array<[string, unknown]> = [['blank', ''], ['decimal comma', '1,5'], ['arabic digits', '٢'], ['half typed', '1.'], ['over precise', 1.0001], ['float artifact', 0.1 + 0.2]];
    for (const [label, quantity] of rawShapes) {
      const response = await post(item({ quantity }, `raw-${label.replace(/\s/g, '-')}`));
      assert.equal(response.status, 409, `raw ${label} should still be rejected by the API`);
      assert.match((await response.json() as any).message, /quantity is invalid/);
      console.log(`  raw ${label.padEnd(14)} → 409 quantity is invalid (as designed)`);
    }

    // What the fixed form sends for those same keystrokes.
    const typedShapes: Array<[string, string, 'individual' | 'aggregate', number]> = [['blank individual', '', 'individual', 1], ['blank aggregate', '', 'aggregate', 0], ['decimal comma', '1,5', 'aggregate', 1.5], ['arabic digits', '٢', 'aggregate', 2], ['half typed', '1.', 'individual', 1], ['over precise', '1.0001', 'aggregate', 1], ['plain', '3', 'individual', 3]];
    for (const [label, typed, mode, expected] of typedShapes) {
      const quantity = (typed.trim() === '' ? (mode === 'aggregate' ? 0 : 1) : readNumber(typed))!;
      const response = await post(item({ quantity: quantity.toFixed(3), inventoryMode: mode }, `fixed-${label.replace(/\s/g, '-')}`));
      const saved = await response.json().catch(() => ({})) as any;
      assert.equal(response.status, 201, `typed "${typed}" should now save: ${JSON.stringify(saved)}`);
      assert.equal(saved.quantity, expected, `typed "${typed}" should store ${expected}`);
      console.log(`  typed ${JSON.stringify(typed).padEnd(9)} ${mode.padEnd(10)} → 201 saved quantity ${saved.quantity}`);
    }

    console.log('\nInventory quantity regression guard passed.\n');
  } finally {
    app.getHttpServer()?.closeAllConnections?.(); await app.close();
  }
}
void main();
