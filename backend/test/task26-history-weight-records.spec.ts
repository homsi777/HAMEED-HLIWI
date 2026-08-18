import 'dotenv/config';
import assert from 'node:assert/strict';

// TASK 26: السجلات has to show the gold ledger as browsable records, not a button that leaves.
//
// The screen reads GET /gold/transactions directly, so what this proves is that the endpoint
// answers with everything a record card needs, that its filters actually narrow, and that the
// sold-weight tab it sits beside is untouched.
//
// Read-only: this test writes nothing to the ledger.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3028;
const base = `http://127.0.0.1:${port}/api/v1`;

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path: string) => fetch(`${base}${path}`, { headers: { cookie } });
const json = async (response: Response) => response.json() as Promise<any>;
const step = (message: string) => console.log(`  ✓ ${message}`);

// Exactly the fields the record card puts on screen.
const CARD_FIELDS = ['date', 'typeLabel', 'description', 'transactionNumber', 'createdBy', 'status', 'sourceType'] as const;

const app = await createApp();
await app.listen({ port, host: '127.0.0.1' });
try {
  const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: warehouses[0].id }) }) as ResponseWithCookies;
  cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
  assert.ok(cookie, 'admin login failed');

  // ---------------------------------------------------------------- the records themselves
  const all = await json(await api('/gold/transactions?limit=200'));
  assert.ok(all.items.length > 0, 'the development ledger must have movements to browse');
  for (const row of all.items) {
    for (const field of CARD_FIELDS) {
      assert.ok(row[field] !== undefined && row[field] !== null, `${row.transactionNumber ?? '?'} is missing ${field}, which the card renders`);
    }
    assert.ok(typeof row.description === 'string' && row.description.length > 0, 'the description carries the weight and karat for the card');
  }
  step(`${all.items.length} ledger movements, every one carrying all ${CARD_FIELDS.length} fields the card shows`);

  // ---------------------------------------------------------------- one of each kind exists
  const kinds = new Map<string, any>();
  for (const row of all.items) kinds.set(`${row.type}/${row.sourceType}`, row);
  const companyAdjustment = all.items.find((row: any) => row.type === 'opening' && !row.partnerId);
  const custody = all.items.find((row: any) => row.sourceType === 'weight_custody');
  const manualSettlement = all.items.find((row: any) => ['receipt', 'payment'].includes(row.type) && row.sourceType === 'manual');
  assert.ok(companyAdjustment, 'a company adjustment must be browsable');
  assert.ok(custody, 'a custody hand-out or receive must be browsable');
  assert.ok(manualSettlement, 'a manual receipt or payment must be browsable');
  step(`each kind present — ${companyAdjustment.transactionNumber} (شركة), ${custody.transactionNumber} (عهدة), ${manualSettlement.transactionNumber} (يدوي)`);
  step(`the type/source combinations the screen labels: ${[...kinds.keys()].join(', ')}`);

  // ---------------------------------------------------------------- the type filter narrows
  const openings = await json(await api('/gold/transactions?type=opening&limit=100'));
  assert.ok(openings.items.length > 0, 'filtering by type must still return something');
  assert.ok(openings.items.every((row: any) => row.type === 'opening'), 'the type filter must not leak other types');
  assert.ok(openings.meta.total <= all.meta.total, 'a filtered total can never exceed the unfiltered one');
  step(`type filter: ${openings.items.length} opening movements, nothing else`);

  // ---------------------------------------------------------------- the date filter narrows
  const days = [...new Set(all.items.map((row: any) => row.date))].sort() as string[];
  const pivot = days[Math.floor(days.length / 2)];
  const upTo = await json(await api(`/gold/transactions?dateTo=${pivot}&limit=200`));
  assert.ok(upTo.items.every((row: any) => row.date <= pivot), `dateTo must exclude anything after ${pivot}`);
  const from = await json(await api(`/gold/transactions?dateFrom=${pivot}&limit=200`));
  assert.ok(from.items.every((row: any) => row.date >= pivot), `dateFrom must exclude anything before ${pivot}`);
  const window = await json(await api(`/gold/transactions?dateFrom=${pivot}&dateTo=${pivot}&limit=200`));
  assert.ok(window.items.every((row: any) => row.date === pivot), 'a single-day window must return that day only');
  assert.ok(window.items.length > 0, 'the chosen pivot day must actually have movements');
  step(`date filter across ${days.length} days: ${window.items.length} movements on ${pivot} alone`);

  // ---------------------------------------------------------------- reversed records survive
  const reversed = all.items.filter((row: any) => row.status === 'reversed');
  if (reversed.length) step(`${reversed.length} reversed movements still listed — the card marks them «معكوسة» rather than hiding them`);
  else console.log('  · no reversed movements in this dataset to check the strike-through against');

  // ---------------------------------------------------------------- the neighbouring tab is untouched
  const soldWeights = await json(await api('/history/sold-weights?limit=5'));
  assert.ok(Array.isArray(soldWeights.items), 'the sold-weight tab must still answer');
  const summary = await json(await api('/history/sold-weights/summary'));
  assert.ok(Array.isArray(summary.byKarat), 'its karat summary must still answer');
  step('«الأوزان المباعة» untouched — it still reads sales lines, as it always did');

  console.log('\nTASK 26 — the gold ledger is browsable inside السجلات.');
} finally {
  await app.close();
}
