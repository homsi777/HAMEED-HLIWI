import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// TASK 23: a manual correction to the shop's own metal, and its reversal.
//
// The point of this test is the pair, not the single write: an entry that raises the company
// holding must be undoable back to the exact gram it started from, because that is the only
// thing that makes a manual adjustment safe to hand a manager.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const SELLER_SECRET = 'T23seller!2026';
const token = crypto.randomUUID().slice(0, 8);
const port = 3023;
const base = `http://127.0.0.1:${port}/api/v1`;

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = ''; let sellerCookie = ''; let warehouseId = '';
const api = (path: string, method = 'GET', body?: unknown, auth = cookie) =>
  fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);

const holdings = async () => json(await api('/gold/holdings?limit=1'));
const karatGrams = (result: any, karat: string, field: 'totals' | 'totalsExcludingScrap' = 'totals') =>
  Number(result[field].find((row: any) => row.karat === karat)?.grams ?? 0);

const app = await createApp();
await app.listen({ port, host: '127.0.0.1' });
try {
  const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
  warehouseId = warehouses[0].id;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
  cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
  assert.ok(cookie, 'admin login failed');
  // A seller is created for this run rather than assumed: the refusal below has to be a real
  // role refusal (403), not an unauthenticated one (401), or it proves nothing.
  const sellerName = `t23_seller_${token}`;
  await ok(await api('/users', 'POST', { username: sellerName, fullName: `بائع اختبار ${token}`, password: SELLER_SECRET, roleName: 'sales', warehouseIds: [warehouseId] }), 201);
  const sellerLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: sellerName, password: SELLER_SECRET, warehouseId }) }) as ResponseWithCookies;
  sellerCookie = (sellerLogin.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
  assert.ok(sellerCookie, 'seller login failed — the refusal below would prove nothing');
  step('signed in as admin, and as a freshly created seller');

  // ---------------------------------------------------------------- baseline
  const before = await holdings();
  const before21 = karatGrams(before, '21');
  const before18 = karatGrams(before, '18');
  const beforeNoScrap21 = karatGrams(before, '21', 'totalsExcludingScrap');
  assert.ok(Array.isArray(before.totalsExcludingScrap), 'totalsExcludingScrap must be exposed');
  assert.equal(typeof before.pureGoldTotalExcludingScrapGrams, 'number', 'pureGoldTotalExcludingScrapGrams must be exposed');
  step(`baseline read — 21K ${before21} g, 18K ${before18} g`);

  // ---------------------------------------------------------------- the adjustment
  const adjustment = await ok(await api('/gold/company-adjustment', 'POST', {
    direction: 'increase', warehouseId, note: 'TASK 23 automated verification',
    lines: [
      { karat: '21', weightGrams: '12.500', note: 'test bullion line' },
      { karat: '18', weightGrams: '3.250', note: 'test scrap line' },
    ],
    idempotencyKey: crypto.randomUUID(),
  }));
  assert.equal(adjustment.status, 'posted');
  assert.equal(adjustment.partnerId, null, 'a company adjustment must carry no partner');
  step(`posted ${adjustment.transactionNumber} across two karats`);

  const after = await holdings();
  assert.equal(karatGrams(after, '21'), Number((before21 + 12.5).toFixed(3)), '21K did not rise by exactly 12.500');
  assert.equal(karatGrams(after, '18'), Number((before18 + 3.25).toFixed(3)), '18K did not rise by exactly 3.250');
  step('holdings rose by exactly the adjusted weight, per karat');

  // Scrap-excluded totals must move by the same amount: a manual addition is not scrap.
  assert.equal(karatGrams(after, '21', 'totalsExcludingScrap'), Number((beforeNoScrap21 + 12.5).toFixed(3)), 'scrap-excluded 21K did not follow the adjustment');
  step('scrap-excluded totals followed the adjustment too');

  // Karats stay separate: two lines, two ledger entries on the company side.
  const detail = await json(await api(`/gold/transactions/${adjustment.id}`));
  const companyLines = detail.lines.filter((line: any) => line.accountKind === 'company' && line.debitGrams > 0);
  assert.equal(companyLines.length, 2, 'expected one company line per karat');
  assert.deepEqual(companyLines.map((line: any) => line.karat).sort(), ['18', '21']);
  step('one ledger line per karat — nothing merged');

  // ---------------------------------------------------------------- idempotency
  const key = crypto.randomUUID();
  const first = await ok(await api('/gold/company-adjustment', 'POST', { direction: 'increase', warehouseId, lines: [{ karat: '21', weightGrams: '1.000' }], idempotencyKey: key }));
  const repeat = await json(await api('/gold/company-adjustment', 'POST', { direction: 'increase', warehouseId, lines: [{ karat: '21', weightGrams: '1.000' }], idempotencyKey: key }));
  assert.equal(repeat.id, first.id, 'a retried adjustment must not post twice');
  step('retry with the same key returned the same transaction');

  // ---------------------------------------------------------------- refusals
  const duplicateKarat = await api('/gold/company-adjustment', 'POST', { direction: 'increase', warehouseId, lines: [{ karat: '21', weightGrams: '1.000' }, { karat: '21', weightGrams: '2.000' }], idempotencyKey: crypto.randomUUID() });
  assert.equal(duplicateKarat.status, 409, 'the same karat twice must be refused');
  const noLines = await api('/gold/company-adjustment', 'POST', { direction: 'increase', warehouseId, lines: [], idempotencyKey: crypto.randomUUID() });
  assert.equal(noLines.status, 409, 'an empty adjustment must be refused');
  const seller = await api('/gold/company-adjustment', 'POST', { direction: 'increase', warehouseId, lines: [{ karat: '21', weightGrams: '1.000' }], idempotencyKey: crypto.randomUUID() }, sellerCookie);
  assert.equal(seller.status, 403, 'a seller must be refused by role, not by missing session');
  assert.equal((await api('/gold/holdings', 'GET', undefined, sellerCookie)).status, 403, 'a seller must not even read the holdings');
  step('duplicate karat, empty body and a seller are all refused');

  // ---------------------------------------------------------------- reversal
  await ok(await api(`/gold/transactions/${adjustment.id}/reverse`, 'POST', { reason: 'TASK 23 verification cleanup' }));   // Nest answers a POST with 201
  await ok(await api(`/gold/transactions/${first.id}/reverse`, 'POST', { reason: 'TASK 23 verification cleanup' }));   // Nest answers a POST with 201
  const restored = await holdings();
  assert.equal(karatGrams(restored, '21'), before21, '21K did not return to its starting value');
  assert.equal(karatGrams(restored, '18'), before18, '18K did not return to its starting value');
  step('both test adjustments reversed — holdings back to the exact baseline');

  console.log('\nTASK 23 — company adjustment verified end to end.');
} finally {
  await app.close();
}
