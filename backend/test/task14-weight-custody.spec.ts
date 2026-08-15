import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 14: ذمم الأوزان with a flexible person.
//
// The point of the task is that handing gold to a polisher must not force anyone to create a
// commercial Customer, so the assertions below check the partners table before and after
// every free-form operation as carefully as they check the weights.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3014;
const base = `http://127.0.0.1:${port}/api/v1`;
const token = crypto.randomUUID().slice(0, 8);
const SECRET = 'Passw0rd!Task14';

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
const json = async (response: Response) => response.json() as Promise<any>;
const step = (message: string) => console.log(`  ✓ ${message}`);
let adminCookie = '';
const api = (path: string, method = 'GET', body?: unknown, auth = adminCookie) =>
  fetch(`${base}${path}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ok = async (response: Response, expected = 201) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected} but got ${response.status}: ${JSON.stringify(body)}`); return body; };
const status = async (response: Response) => { const value = response.status; await response.text().catch(() => undefined); return value; };
const login = async (username: string, warehouseId: string) => {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: SECRET, warehouseId }) }) as ResponseWithCookies;
  assert.equal(response.status, 201, `login failed for ${username}: ${await response.text()}`);
  return jar(response);
};
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.0015, `${label}: expected ${expected} but got ${actual}`);

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 2 });
  try {
    const loginWarehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const furqanId = loginWarehouses[0].id;
    const otherId = loginWarehouses.find((row: any) => row.id !== furqanId)!.id;
    const adminLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: furqanId }) }) as ResponseWithCookies;
    adminCookie = jar(adminLogin);

    const createUser = async (suffix: string, fullName: string, roleName: string, warehouseIds: string[]) =>
      ok(await api('/users', 'POST', { username: `t14_${suffix}_${token}`, fullName, password: SECRET, roleName, warehouseIds }));
    await createUser('mgr', 'Manager Furqan', 'warehouse_manager', [furqanId]);
    await createUser('other', 'Manager Other', 'warehouse_manager', [otherId]);
    await createUser('a', 'Seller A', 'sales', [furqanId]);
    const managerCookie = await login(`t14_mgr_${token}`, furqanId);
    const otherManagerCookie = await login(`t14_other_${token}`, otherId);
    const sellerCookie = await login(`t14_a_${token}`, furqanId);

    const countPartners = async () => Number((await sql`select count(*)::int c from partners`)[0]!.c);
    const financials = async () => (await sql`select
      (select count(*) from vouchers) as vouchers, (select count(*) from cash_movements) as cash,
      (select count(*) from journal_entries) as journals, (select count(*) from partner_ledger_entries) as ledger`)[0]!;

    // ---------------------------------------------------------------- §50 scenario A
    // A supplier-only partner. Custody must accept it without demanding a Customer role.
    const supplier = await ok(await api('/partners', 'POST', { name: `محمد الأحمد ${token}`, type: 'supplier', phone: `05${token.replace(/\D/g, '').padEnd(8, '4').slice(0, 8)}` }));
    assert.equal(supplier.type, 'supplier');

    const handOut = (body: Record<string, unknown>, auth = managerCookie) =>
      api('/gold/custody/hand-out', 'POST', { warehouseId: furqanId, idempotencyKey: crypto.randomUUID(), ...body }, auth);
    const receive = (body: Record<string, unknown>, auth = managerCookie) =>
      api('/gold/custody/receive', 'POST', { warehouseId: furqanId, idempotencyKey: crypto.randomUUID(), ...body }, auth);
    const outstanding = async (personId: string, karat: string, auth = managerCookie) => {
      const detail = await ok(await api(`/gold/custody/people/${personId}`, 'GET', undefined, auth), 200);
      return detail.balances.find((row: any) => row.karat === karat)?.outstandingGrams ?? 0;
    };

    const financeBefore = await financials();
    const supplierHandOut = await ok(await handOut({ person: { partnerId: supplier.id }, karat: '21', weightGrams: '26.510', note: 'تلميع' }));
    const supplierPersonId = supplierHandOut.person.id;
    near(await outstanding(supplierPersonId, '21'), 26.51, 'outstanding after handing 26.510');
    const supplierAfter = (await sql`select type from partners where id = ${supplier.id}`)[0]!;
    assert.equal(supplierAfter.type, 'supplier', '§50 the partner must stay a supplier, never become a customer');
    step('§50 a supplier-only partner received 26.510 g custody and stayed a supplier');

    await ok(await receive({ person: { custodyPersonId: supplierPersonId }, karat: '21', weightGrams: '20.000' }));
    near(await outstanding(supplierPersonId, '21'), 6.51, '§50 remaining after receiving 20.000');
    step('§50 26.510 − 20.000 = 6.510 g remaining, computed on the server');

    // ---------------------------------------------------------------- §51/§54 free person
    const partnersBefore = await countPartners();
    const freeName = `أبو محمد الصائغ ${token}`;
    const freeHandOut = await ok(await handOut({ person: { name: freeName }, karat: '21', weightGrams: '10.000' }));
    const freePersonId = freeHandOut.person.id;
    assert.equal(freeHandOut.person.partnerId, null, 'A typed person is not linked to any partner.');
    assert.equal(await countPartners(), partnersBefore, '§49/§54 typing a name must not create a commercial partner');
    assert.equal((await sql`select count(*)::int c from partners where name = ${freeName}`)[0]!.c, 0);
    near(await outstanding(freePersonId, '21'), 10, '§51 outstanding for the free person');
    step('§49/§51/§54 a typed person received 10.000 g and the partners table is unchanged');

    await ok(await receive({ person: { custodyPersonId: freePersonId }, karat: '21', weightGrams: '4.250' }));
    near(await outstanding(freePersonId, '21'), 5.75, '§51 remaining 5.750');
    step('§51 10.000 − 4.250 = 5.750 g remaining');

    // ---------------------------------------------------------------- §8/§53 reuse
    const found = await ok(await api(`/gold/custody/people?search=${encodeURIComponent('أبو محمد')}`, 'GET', undefined, managerCookie), 200);
    assert.ok(found.people.some((row: any) => row.id === freePersonId), '§53 a partial search must find the person again');
    const reused = await ok(await handOut({ person: { name: freeName }, karat: '21', weightGrams: '1.000' }));
    assert.equal(reused.person.id, freePersonId, '§8 typing the same name reuses the same person');
    near(await outstanding(freePersonId, '21'), 6.75, 'balance accumulated on the same person');
    step('§8/§53 searching "أبو محمد" finds them, and re-typing the full name reuses the same identity');

    // ---------------------------------------------------------------- §9 no over-merging
    const similar = await ok(await handOut({ person: { name: `أبو محمد الصائغ الحلبي ${token}` }, karat: '21', weightGrams: '2.000' }));
    assert.notEqual(similar.person.id, freePersonId, '§9 a longer, different name is a different person');
    step('§9 a similar but different name creates a separate person, never a silent merge');

    // ---------------------------------------------------------------- §52 karat separation
    const multiName = `أبو حسن ${token}`;
    const multi = await ok(await handOut({ person: { name: multiName }, karat: '21', weightGrams: '20.000' }));
    const multiId = multi.person.id;
    await ok(await handOut({ person: { custodyPersonId: multiId }, karat: '18', weightGrams: '10.000' }));
    await ok(await receive({ person: { custodyPersonId: multiId }, karat: '21', weightGrams: '5.000' }));
    await ok(await receive({ person: { custodyPersonId: multiId }, karat: '18', weightGrams: '3.000' }));
    near(await outstanding(multiId, '21'), 15, '§52 21K remaining');
    near(await outstanding(multiId, '18'), 7, '§52 18K remaining');
    const card = (await ok(await api('/gold/custody/balances', 'GET', undefined, managerCookie), 200)).people.find((row: any) => row.personId === multiId);
    assert.equal(card.balances.length, 2, '§13 each karat is a separate obligation, never one merged total');
    step('§13/§52 21K = 15.000 g and 18K = 7.000 g reported separately, never combined');

    // ---------------------------------------------------------------- §17 historical truth
    const detail = await ok(await api(`/gold/custody/people/${multiId}`, 'GET', undefined, managerCookie), 200);
    const handed21 = detail.movements.filter((row: any) => row.karat === '21' && row.type === 'handed_out');
    assert.equal(handed21.length, 1);
    near(handed21[0].weightGrams, 20, '§17 the original hand-out still reads 20.000, not the net 15.000');
    assert.ok(detail.movements.some((row: any) => row.karat === '21' && row.type === 'received_back' && Math.abs(row.weightGrams - 5) < 0.0015));
    assert.ok(detail.movements.every((row: any) => row.warehouseId === furqanId), '§20 each movement keeps the warehouse it happened in');
    step('§17/§20 history keeps سلمنا 20.000 and استلمنا 5.000 as separate rows, with their warehouse');

    // ---------------------------------------------------------------- §31 over-receipt
    const over = await json(await receive({ person: { custodyPersonId: multiId }, karat: '21', weightGrams: '15.001' }));
    assert.equal(over.statusCode, 409);
    assert.match(over.message, /فقط عيار 21/);
    near(await outstanding(multiId, '21'), 15, 'nothing was written by the refusal');
    step('§31 receiving more than outstanding is refused, preserving the existing gold rule');

    // ---------------------------------------------------------------- §33 idempotency
    const key = crypto.randomUUID();
    const firstCall = await ok(await api('/gold/custody/hand-out', 'POST', { warehouseId: furqanId, idempotencyKey: key, person: { custodyPersonId: multiId }, karat: '14', weightGrams: '3.000' }, managerCookie));
    const secondCall = await ok(await api('/gold/custody/hand-out', 'POST', { warehouseId: furqanId, idempotencyKey: key, person: { custodyPersonId: multiId }, karat: '14', weightGrams: '3.000' }, managerCookie));
    assert.equal(firstCall.transactionId, secondCall.transactionId, 'A retried hand-out returns the same movement.');
    near(await outstanding(multiId, '14'), 3, '§33 the retry did not double the custody');
    step('§33 a retried hand-out creates exactly one movement');

    // ---------------------------------------------------------------- §29 settled card kept
    const settledName = `أبو علي ${token}`;
    const settled = await ok(await handOut({ person: { name: settledName }, karat: '18', weightGrams: '5.000' }));
    await ok(await receive({ person: { custodyPersonId: settled.person.id }, karat: '18', weightGrams: '5.000' }));
    near(await outstanding(settled.person.id, '18'), 0, '§29 fully returned');
    const settledDetail = await ok(await api(`/gold/custody/people/${settled.person.id}`, 'GET', undefined, managerCookie), 200);
    assert.equal(settledDetail.settled, true);
    assert.equal(settledDetail.movements.length, 2, '§29 the history card survives a zero balance');
    step('§29 a fully returned custody keeps its card and both movements, marked settled');

    // ---------------------------------------------------------------- §36/§37/§55 no money
    const financeAfter = await financials();
    assert.deepEqual(financeAfter, financeBefore, '§36/§37/§55 custody must create no voucher, cash, journal or ledger entry');
    step('§36/§37/§55 no voucher, cash movement, journal entry or partner ledger entry was created');

    // ---------------------------------------------------------------- §38 commercial ledger clean
    const commercial = await ok(await api('/gold/partners', 'GET', undefined, managerCookie), 200);
    assert.ok(!commercial.some((row: any) => row.name?.includes('أبو محمد')), '§38 free people must not appear in the commercial gold ledger');
    const kinds = await sql`select kind, count(*)::int c from gold_accounts group by kind`;
    assert.ok(kinds.some((row: any) => row.kind === 'custody_person'), 'custody accounts use their own kind');
    step('§38 free-form people live on custody accounts and never pollute the commercial gold ledger');

    // ---------------------------------------------------------------- §21/§57 authorization
    assert.equal(await status(await api('/gold/custody/balances', 'GET', undefined, sellerCookie)), 403);
    assert.equal(await status(await handOut({ person: { name: `ممنوع ${token}` }, karat: '21', weightGrams: '1.000' }, sellerCookie)), 403);
    step('§21/§57 a seller has no custody rights at all');

    // §22 — a manager cannot record or read custody in a warehouse they do not hold.
    assert.equal(await status(await api('/gold/custody/hand-out', 'POST', { warehouseId: furqanId, idempotencyKey: crypto.randomUUID(), person: { name: `خارج ${token}` }, karat: '21', weightGrams: '1.000' }, otherManagerCookie)), 403);
    const otherView = await ok(await api(`/gold/custody/people/${multiId}`, 'GET', undefined, otherManagerCookie), 200);
    assert.equal(otherView.movements.length, 0, '§22 movements from another warehouse are not readable');
    assert.equal(await status(await api('/gold/custody/balances', 'GET', undefined, adminCookie)), 200);
    step('§22 a manager sees no custody movement belonging to another warehouse; the GM sees all');

    console.log('\nTASK 14 weight-custody suite passed.');
  } finally {
    await sql.end();
    await app.close();
  }
}

await main();
