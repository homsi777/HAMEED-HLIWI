import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// TASK 25: the company's gold is read as one balance per karat, entered in that karat.
//
// The screen stopped showing a 24K-equivalent headline, so what the API hands it has to be the
// raw grams per karat and nothing blended. This proves that, proves a karat can be added in a
// later separate entry rather than only in the first one, and proves the opening records are
// reachable as their own list — which is what the History shortcut opens.
//
// Every gram this test writes is reversed before it exits, so the dataset ends where it began.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3027;
const base = `http://127.0.0.1:${port}/api/v1`;

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const holdings = async () => json(await api('/gold/holdings?limit=1'));
const karat = (result: any, value: string) => Number(result.totalsExcludingScrap.find((row: any) => row.karat === value)?.grams ?? 0);

const app = await createApp();
await app.listen({ port, host: '127.0.0.1' });
const posted: string[] = [];
try {
  const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
  warehouseId = warehouses[0].id;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
  cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
  assert.ok(cookie, 'admin login failed');

  const before = await holdings();
  const start = { '21': karat(before, '21'), '24': karat(before, '24'), '18': karat(before, '18'), '14': karat(before, '14') };
  step(`baseline — 21K ${start['21']}, 24K ${start['24']}, 18K ${start['18']}, 14K ${start['14']}`);

  // ---------------------------------------------------------------- several karats at once
  const first = await ok(await api('/gold/company-adjustment', 'POST', {
    direction: 'increase', warehouseId, note: 'TASK 25 — opening balance',
    lines: [
      { karat: '21', weightGrams: '14500.000', note: 'الرصيد الافتتاحي الأساسي' },
      { karat: '24', weightGrams: '1500.000' },
      { karat: '18', weightGrams: '2500.000' },
    ],
    idempotencyKey: crypto.randomUUID(),
  }));
  posted.push(first.id);
  step(`posted ${first.transactionNumber} across three karats in one entry`);

  // ---------------------------------------------------------------- a karat added later
  // §1 asks whether a karat missing from the first entry can be added afterwards. Each call is
  // independent, so it can — proved rather than assumed.
  const second = await ok(await api('/gold/company-adjustment', 'POST', {
    direction: 'increase', warehouseId, note: 'TASK 25 — a karat that was not in the first entry',
    lines: [{ karat: '14', weightGrams: '100.000' }],
    idempotencyKey: crypto.randomUUID(),
  }));
  posted.push(second.id);
  step(`posted ${second.transactionNumber} adding a karat the first entry never mentioned`);

  // ---------------------------------------------------------------- one balance per karat
  const after = await holdings();
  assert.equal(karat(after, '21'), Number((start['21'] + 14500).toFixed(3)), '21K must hold exactly what was entered as 21K');
  assert.equal(karat(after, '24'), Number((start['24'] + 1500).toFixed(3)), '24K must hold exactly what was entered as 24K');
  assert.equal(karat(after, '18'), Number((start['18'] + 2500).toFixed(3)), '18K must hold exactly what was entered as 18K');
  assert.equal(karat(after, '14'), Number((start['14'] + 100).toFixed(3)), '14K must hold exactly what was entered as 14K');
  step('each karat carries its own entered grams — nothing converted, nothing merged');

  // The cards show these rows. A blended figure would have to come from somewhere: it must not
  // be any of them, and no karat row may quietly equal the fine-gold equivalent of the rest.
  const rows = after.totalsExcludingScrap as Array<{ karat: string; grams: number; pureGoldGrams: number }>;
  assert.ok(rows.length >= 4, 'every karat with a balance must be its own row');
  assert.equal(new Set(rows.map(row => row.karat)).size, rows.length, 'a karat must never appear twice');
  for (const row of rows) {
    assert.notEqual(Number(row.grams.toFixed(3)), Number(after.pureGoldTotalExcludingScrapGrams.toFixed(3)),
      `karat ${row.karat} must not be carrying the blended 24K-equivalent figure`);
  }
  step('no row on the card set is the 24K-equivalent total');

  // ---------------------------------------------------------------- the records list
  const openings = await json(await api('/gold/transactions?type=opening&limit=200'));
  const mine = openings.items.filter((row: any) => posted.includes(row.id));
  assert.equal(mine.length, 2, 'both entries must appear in the opening records list');
  for (const row of mine) assert.equal(row.partnerId, null, 'a company adjustment carries no partner, which is how the list separates the two kinds');
  assert.ok(openings.items.some((row: any) => row.partnerId), 'partner openings must still be listed too, so the screen has both sides to separate');
  step('both entries reachable in the opening records the History shortcut opens');
} finally {
  // ---------------------------------------------------------------- put the dataset back
  for (const id of posted) {
    const response = await api(`/gold/transactions/${id}/reverse`, 'POST', { reason: 'TASK 25 verification cleanup' });
    console.log(`  ↩ ${id.slice(0, 8)}: ${response.status === 201 ? 'reversed' : `NOT reversed (${response.status})`}`);
  }
  const restored = await holdings();
  console.log(`  balance now — 21K ${karat(restored, '21')}, 24K ${karat(restored, '24')}, 18K ${karat(restored, '18')}, 14K ${karat(restored, '14')}`);
  await app.close();
}
console.log('\nTASK 25 — one balance per karat, entered in that karat, with no blended figure.');
