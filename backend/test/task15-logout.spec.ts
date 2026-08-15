import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Task 15: logout must be a real server logout.
//
// The reported symptom — "the button does nothing" — was a frontend consequence of a backend
// fact these tests pin down: the 15-minute access cookie expires long before the session does,
// and `/auth/logout` is guarded. So the suite covers both the ordinary path and the expired
// access cookie path, which is the one that actually broke.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3015;
const base = `http://127.0.0.1:${port}/api/v1`;
const token = crypto.randomUUID().slice(0, 8);
const SECRET = 'Passw0rd!Task15';

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
const setCookies = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).filter(value => value.startsWith('hh_'));
const jar = (response: ResponseWithCookies) => setCookies(response).map(value => value.split(';', 1)[0]).join('; ');
const only = (response: ResponseWithCookies, name: string) => setCookies(response).map(value => value.split(';', 1)[0]).filter(value => value.startsWith(name)).join('; ');
const json = async (response: Response) => response.json() as Promise<any>;
const step = (message: string) => console.log(`  ✓ ${message}`);
const status = async (response: Response) => { const value = response.status; await response.text().catch(() => undefined); return value; };

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const signIn = async (username: string, secret = password!) =>
      await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: secret, warehouseId }) }) as ResponseWithCookies;

    // ---------------------------------------------------------------- §4/§11 the ordinary path
    const first = await signIn('admin_dev');
    assert.equal(first.status, 201);
    const cookie = jar(first);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie } })), 200);

    const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } }) as ResponseWithCookies;
    assert.equal(out.status, 201);
    // §7 — cookies must be cleared with the same path they were issued on, or the browser
    // silently keeps them.
    const cleared = setCookies(out);
    assert.ok(cleared.some(value => value.startsWith('hh_access=;') && value.includes('Path=/')), 'hh_access must be cleared on its own path');
    assert.ok(cleared.some(value => value.startsWith('hh_refresh=;') && value.includes('Path=/api/v1/auth')), 'hh_refresh must be cleared on its own path');
    assert.ok(cleared.every(value => value.includes('HttpOnly')), 'clearing must keep the HttpOnly attribute');
    step('§4/§7 logout returns 201 and clears both cookies on the paths they were issued with');

    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie } })), 401);
    step('§4/§11 /auth/me is 401 immediately after logout');

    // ---------------------------------------------------------------- §6 stale refresh
    assert.equal(await status(await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie } })), 401);
    step('§6 the old refresh token cannot resurrect the revoked session');

    // ---------------------------------------------------------------- §10 repeated logout
    assert.equal(await status(await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } })), 401);
    step('§10 logging out again is harmless — refused, never destructive');

    // ---------------------------------------------------------------- §11 login again
    const again = await signIn('admin_dev');
    assert.equal(again.status, 201);
    const freshCookie = jar(again);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { freshCookie } as any })), 401, 'sanity: a malformed header is refused');
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: freshCookie } })), 200);
    step('§11 logging in again produces a working session');

    // ---------------------------------------------------------------- the real bug
    // A tab left open past 15 minutes still holds a valid session, but the browser has dropped
    // the short-lived access cookie. Logout must remain reachable in that state — the frontend
    // now renews before retrying, and the server accepts the renewed token.
    const staleRefreshOnly = only(again, 'hh_refresh');
    assert.equal(await status(await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: staleRefreshOnly } })), 401, 'without an access cookie the guard refuses, which is why the client must renew first');
    const renewed = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie: staleRefreshOnly } }) as ResponseWithCookies;
    assert.equal(renewed.status, 201, 'the session itself is still perfectly valid');
    const renewedCookie = jar(renewed);
    assert.equal(await status(await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: renewedCookie } })), 201);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: renewedCookie } })), 401);
    step('the expired-access-cookie path: renew, then logout succeeds and the session is revoked');

    // ---------------------------------------------------------------- §5/§54 other sessions
    const deviceA = await signIn('admin_dev');
    const deviceB = await signIn('admin_dev');
    const cookieA = jar(deviceA), cookieB = jar(deviceB);
    assert.equal(await status(await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: cookieA } })), 201);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: cookieA } })), 401);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: cookieB } })), 200, '§5 a normal logout ends this device only');
    step('§5 logging out one device leaves the other device signed in');

    // ---------------------------------------------------------------- logout-all still works
    const deviceC = await signIn('admin_dev');
    const cookieC = jar(deviceC);
    assert.equal(await status(await fetch(`${base}/auth/logout-all`, { method: 'POST', headers: { cookie: cookieC } })), 201);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: cookieC } })), 401);
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: cookieB } })), 401, 'logout-all ends every session');
    step('§5/§54 logout-all still ends every session, and remains distinct from normal logout');

    // ---------------------------------------------------------------- §49 next user is clean
    const admin = await signIn('admin_dev');
    const adminCookie = jar(admin);
    const seller = await fetch(`${base}/users`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ username: `t15_s_${token}`, fullName: 'Seller Fifteen', password: SECRET, roleName: 'sales', warehouseIds: [warehouseId] }) });
    assert.equal(seller.status, 201);
    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: adminCookie } });

    const sellerLogin = await signIn(`t15_s_${token}`, SECRET);
    const sellerCookie = jar(sellerLogin);
    const sellerMe = await json(await fetch(`${base}/auth/me`, { headers: { cookie: sellerCookie } }));
    assert.equal(sellerMe.scope.type, 'own', 'the next user gets their own identity, not the previous one');
    assert.ok(!sellerMe.scope.modules.includes('users'), 'and their own modules');
    assert.equal(await status(await fetch(`${base}/auth/me`, { headers: { cookie: adminCookie } })), 401, 'the previous session stays revoked');
    step('§49/§50 after logout the next login returns a fresh identity and the old session stays dead');

    console.log('\nTASK 15 logout suite passed.');
  } finally {
    await app.close();
  }
}

await main();
