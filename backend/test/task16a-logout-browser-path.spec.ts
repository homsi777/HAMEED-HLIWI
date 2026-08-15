import 'dotenv/config';
import assert from 'node:assert/strict';

// Task 16A: the logout failure the user actually hit in production.
//
// TASK 15's suite passed while the real button kept returning 400, because the test sent no
// `Content-Type` header and the browser always sends `application/json`. Fastify rejects an
// empty body under that content type before the route is ever reached.
//
// Every request below therefore sends the exact headers a browser sends. That is the whole
// point of this file: it fails if the client ever reintroduces the header on a body-less POST.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3016;
const base = `http://127.0.0.1:${port}/api/v1`;

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
const setCookies = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).filter(value => value.startsWith('hh_'));
const jar = (response: ResponseWithCookies) => setCookies(response).map(value => value.split(';', 1)[0]).join('; ');
const only = (response: ResponseWithCookies, name: string) => setCookies(response).map(value => value.split(';', 1)[0]).filter(value => value.startsWith(name)).join('; ');
const step = (message: string) => console.log(`  ✓ ${message}`);

/** A body-less POST exactly as the browser client issues it. */
const browserPost = (path: string, cookie: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } }) as Promise<ResponseWithCookies>;
const browserGet = (path: string, cookie: string) =>
  fetch(`${base}${path}`, { headers: { cookie, 'Content-Type': 'application/json' } });

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    const warehouses = await (await fetch(`${base}/auth/login-warehouses`)).json() as any;
    const warehouseId = warehouses[0].id;
    const signIn = async () => await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_dev', password, warehouseId }),
    }) as ResponseWithCookies;

    // ---------------------------------------------------------------- §3A valid access token
    const first = await signIn();
    assert.equal(first.status, 201);
    const cookie = jar(first);
    assert.equal((await browserGet('/auth/me', cookie)).status, 200);

    const out = await browserPost('/auth/logout', cookie);
    const body = await out.json().catch(() => ({}));
    assert.equal(out.status, 201, `logout must not 400 on the browser path — got ${out.status}: ${JSON.stringify(body)}`);
    assert.notEqual(out.status, 400, 'the reported production failure must not reappear');
    step('§3A logout with the browser Content-Type returns 201, not 400');

    assert.equal((await browserGet('/auth/me', cookie)).status, 401);
    assert.equal((await browserPost('/auth/refresh', cookie)).status, 401, 'a revoked session must not be renewable');
    step('§5 /auth/me is 401 afterwards and the revoked session cannot be refreshed');

    // ---------------------------------------------------------------- §3D already revoked
    const repeat = await browserPost('/auth/logout', cookie);
    assert.notEqual(repeat.status, 400, 'a repeated logout must not fail with a malformed-request error');
    assert.equal(repeat.status, 401);
    step('§3D logging out again is refused as unauthenticated, never as a bad request');

    // ---------------------------------------------------------------- §3B/§3C expired access
    // The access cookie lives ~15 minutes while the session lives days. Dropping it reproduces
    // a tab left open, which is the state the renewal path has to survive.
    const second = await signIn();
    const refreshOnly = only(second, 'hh_refresh');
    const renewal = await browserPost('/auth/refresh', refreshOnly);
    assert.notEqual(renewal.status, 400, 'renewal is the path that silently broke; it must not 400');
    assert.equal(renewal.status, 201, 'a valid refresh session must renew');
    const renewed = jar(renewal);
    step('§3B/§3C refresh works on the browser path — this is what had been failing silently');

    const afterRenewal = await browserPost('/auth/logout', renewed);
    assert.equal(afterRenewal.status, 201);
    assert.equal((await browserGet('/auth/me', renewed)).status, 401);
    step('§3B logout succeeds after the access token expired and was renewed');

    // ---------------------------------------------------------------- logout-all
    const third = await signIn();
    const thirdCookie = jar(third);
    const all = await browserPost('/auth/logout-all', thirdCookie);
    assert.notEqual(all.status, 400);
    assert.equal(all.status, 201);
    assert.equal((await browserGet('/auth/me', thirdCookie)).status, 401);
    step('§4 logout-all also works on the browser path');

    // ---------------------------------------------------------------- §4 no body required
    // The server identifies the session from its own cookies; the client never has to send
    // secret token values back.
    const fourth = await signIn();
    const fourthCookie = jar(fourth);
    const noBody = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: fourthCookie } });
    assert.equal(noBody.status, 201, 'logout must also work with no content-type at all');
    step('§4 logout needs no request body in either form — the session comes from the cookies');

    console.log('\nTASK 16A browser-path logout suite passed.');
  } finally {
    await app.close();
  }
}

await main();
