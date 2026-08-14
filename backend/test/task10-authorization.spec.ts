import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Task 10: users, roles, permissions and data scope.
//
// The scenario is the one the company actually runs: one warehouse, a general manager with
// no warehouse row at all, a branch manager, and five sellers standing at the same counter.
// Every assertion below is made against the HTTP API, because the requirement is that the
// server refuses — hiding a row in the browser proves nothing.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const port = 3010;
const base = `http://127.0.0.1:${port}/api/v1`;
const RATE = '6500.0000';
const token = crypto.randomUUID().slice(0, 8);
const SECRET = 'Passw0rd!Task10';

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

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    // ---------------------------------------------------------------- baseline
    const loginWarehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const furqanId = loginWarehouses[0].id;
    const otherId = loginWarehouses[1]?.id;
    assert.ok(otherId, 'The scenario needs a second warehouse to prove a manager is refused outside their scope.');
    const adminLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId: furqanId }) }) as ResponseWithCookies;
    assert.equal(adminLogin.status, 201, 'The existing administrator must still be able to log in.');
    adminCookie = jar(adminLogin);
    step('§33 the existing administrator still logs in after the role migration');

    const me = await ok(await api('/auth/me'), 200);
    assert.equal(me.scope.type, 'global');
    assert.ok(me.user.roles.includes('general_manager'), 'The migration must add the operational General Manager role to the existing administrator.');
    assert.ok(me.scope.modules.includes('users') && me.scope.modules.includes('settings') && me.scope.modules.includes('finance') && me.scope.modules.includes('accounting') && me.scope.modules.includes('gold-weight-accounts'));
    step('§4/§33 the administrator carries general_manager with global scope and every module');

    const customer = await ok(await api('/partners', 'POST', { name: `عميل صلاحيات ${token}`, type: 'customer', phone: `09${token.replace(/\D/g, '').padEnd(8, '7').slice(0, 8)}` }));

    // ---------------------------------------------------------------- §36 cast
    const createUser = async (suffix: string, fullName: string, roleName: string, warehouseIds: string[]) =>
      ok(await api('/users', 'POST', { username: `t10_${suffix}_${token}`, fullName, password: SECRET, roleName, warehouseIds }));

    const gm = await createUser('gm', 'GM المدير العام', 'general_manager', []);
    assert.equal(gm.scope, 'global');
    assert.equal(gm.warehouses.length, 0, '§15 a General Manager must have no warehouse mapping at all.');
    const manager = await createUser('mgr', 'Manager Furqan', 'warehouse_manager', [furqanId]);
    assert.equal(manager.scope, 'warehouses');
    const sellers: Record<string, any> = {};
    for (const letter of ['a', 'b', 'c', 'd', 'e']) sellers[letter] = await createUser(letter, `Seller ${letter.toUpperCase()}`, 'sales', [furqanId]);
    assert.equal(sellers.a.scope, 'own');
    assert.equal(sellers.a.warehouses.length, 1);
    step('§36 general manager, branch manager and five sellers created through the users API');

    // §15 — a warehouse cannot be forced onto a company-wide account.
    assert.equal(await status(await api('/users', 'POST', { username: `t10_gmx_${token}`, fullName: 'GM with warehouse', password: SECRET, roleName: 'general_manager', warehouseIds: [furqanId] })), 201);
    const forced = await json(await api(`/users`, 'GET'));
    assert.equal(forced.find((user: any) => user.username === `t10_gmx_${token}`).warehouses.length, 0, 'A global role must ignore any warehouse sent by the client.');
    step('§15 warehouse ids sent for a global role are discarded, not stored');

    // §3 — the internal technical role is never assignable from this screen.
    assert.equal(await status(await api('/users', 'POST', { username: `t10_sys_${token}`, fullName: 'System', password: SECRET, roleName: 'system_admin', warehouseIds: [] })), 403);
    const catalog = await ok(await api('/users/catalog'), 200);
    assert.deepEqual(catalog.presets.map((preset: any) => preset.name), ['general_manager', 'warehouse_manager', 'sales']);
    step('§3/§16 system_admin is preserved but hidden from the presets and refused on assignment');

    // §13 — a seller is bound to exactly one warehouse.
    assert.equal(await status(await api('/users', 'POST', { username: `t10_two_${token}`, fullName: 'Two warehouses', password: SECRET, roleName: 'sales', warehouseIds: [furqanId, otherId] })), 409);
    step('§13 a seller cannot be attached to more than one warehouse');

    // ---------------------------------------------------------------- sessions
    const gmCookie = await login(`t10_gm_${token}`, furqanId);
    const managerCookie = await login(`t10_mgr_${token}`, furqanId);
    const cookieA = await login(`t10_a_${token}`, furqanId);
    const cookieB = await login(`t10_b_${token}`, furqanId);

    const sellerMe = await ok(await api('/auth/me', 'GET', undefined, cookieA), 200);
    assert.equal(sellerMe.scope.type, 'own');
    assert.deepEqual(sellerMe.scope.modules.sort(), ['invoices', 'returns']);
    assert.equal(sellerMe.scope.allWarehouses, false);
    step('§17/§20 the seller session reports own scope and only the invoices modules');

    const gmMe = await ok(await api('/auth/me', 'GET', undefined, gmCookie), 200);
    assert.equal(gmMe.scope.type, 'global');
    assert.equal(gmMe.user.warehouses.length, 0, '§2 global scope needs no user_warehouses rows.');
    step('§2/§22 the general manager is company-wide with zero warehouse rows');

    // ---------------------------------------------------------------- §7 isolation
    const sell = (auth: string, note: string) => api('/sales', 'POST', {
      warehouseId: furqanId, customerId: customer.id,
      items: [{ itemName: `قطعة ${note}`, category: 'خواتم ومحابس', karat: '21', grossWeightGrams: '5.000', stoneWeightGrams: '0.000', pricePerGramUSD: '70.0000', laborFeeUSDPerGram: '2.0000' }],
      scrapGoldItems: [], discountUSD: '0', paidUSD: '0', paidSYP: '0', paymentMethod: 'debt', exchangeRateSypPerUsd: RATE, notes: note, idempotencyKey: crypto.randomUUID(),
    }, auth);
    const invoiceA = await ok(await sell(cookieA, `A-${token}`));
    const invoiceB = await ok(await sell(cookieB, `B-${token}`));
    assert.notEqual(invoiceA.id, invoiceB.id);
    step(`§36 Seller A posted ${invoiceA.invoiceNumber} and Seller B posted ${invoiceB.invoiceNumber}`);

    const listFor = async (auth: string, query = '') => (await json(await api(`/sales?limit=100${query}`, 'GET', undefined, auth))).items.map((row: any) => row.id);
    const seenByA = await listFor(cookieA);
    const seenByB = await listFor(cookieB);
    assert.ok(seenByA.includes(invoiceA.id) && !seenByA.includes(invoiceB.id), 'Seller A must not see Seller B in the list.');
    assert.ok(seenByB.includes(invoiceB.id) && !seenByB.includes(invoiceA.id), 'Seller B must not see Seller A in the list.');
    step('§8 each seller lists only their own sales');

    assert.equal(await status(await api(`/sales/${invoiceB.id}`, 'GET', undefined, cookieA)), 403);
    assert.equal(await status(await api(`/sales/${invoiceA.id}`, 'GET', undefined, cookieB)), 403);
    step('§9 direct-id access to a colleague invoice is refused');

    assert.equal(await status(await api(`/sales/${invoiceB.id}/cancel`, 'POST', { reason: 'محاولة إلغاء فاتورة زميل' }, cookieA)), 403);
    step('§10 cancelling a colleague invoice is refused');

    assert.equal(await status(await api(`/returns/returnable?type=sales_return&invoiceId=${invoiceB.id}`, 'GET', undefined, cookieA)), 403);
    // Seller B reads their own returnable lines, then Seller A replays that exact payload:
    // a fully valid request must still be refused on ownership alone, not on validation.
    const returnableB = await ok(await api(`/returns/returnable?type=sales_return&invoiceId=${invoiceB.id}`, 'GET', undefined, cookieB), 200);
    const returnPayload = {
      type: 'sales_return', originalInvoiceId: invoiceB.id, reason: 'محاولة مرتجع على فاتورة زميل',
      items: [{ sourceLineId: returnableB.lines[0].sourceLineId, quantity: returnableB.lines[0].remainingQuantity, netWeightGrams: returnableB.lines[0].remainingNetWeightGrams }],
      refundUSD: '0', refundSYP: '0', exchangeRateSypPerUsd: RATE, idempotencyKey: crypto.randomUUID(),
    };
    assert.equal(await status(await api('/returns', 'POST', returnPayload, cookieA)), 403);
    step('§10 the return path cannot be used to read or act on a colleague invoice');

    const searchLeak = await listFor(cookieA, `&invoiceNumber=${invoiceB.invoiceNumber}`);
    assert.equal(searchLeak.length, 0, 'Search must not leak another seller invoice.');
    // A seller cannot widen their own view by claiming to be someone else.
    const spoofed = await listFor(cookieA, `&sellerId=${sellers.b.id}`);
    assert.deepEqual(spoofed, seenByA, 'A client-supplied sellerId must never widen an own-scope view.');
    step('§8 search and a forged sellerId parameter both stay inside the seller own scope');

    // ---------------------------------------------------------------- §14/§21 manager
    const seenByManager = await listFor(managerCookie);
    assert.ok(seenByManager.includes(invoiceA.id) && seenByManager.includes(invoiceB.id), 'A branch manager must see every seller inside the assigned warehouse.');
    assert.equal(await status(await api(`/sales/${invoiceB.id}`, 'GET', undefined, managerCookie)), 200);
    assert.equal(await status(await api(`/sales?warehouseId=${otherId}`, 'GET', undefined, managerCookie)), 403);
    step('§14/§21 the branch manager sees both sellers but is refused the unassigned warehouse');

    const seenByGm = await listFor(gmCookie);
    assert.ok(seenByGm.includes(invoiceA.id) && seenByGm.includes(invoiceB.id));
    assert.equal(await status(await api(`/sales?warehouseId=${otherId}`, 'GET', undefined, gmCookie)), 200);
    step('§22 the general manager reads every warehouse without an assignment row');

    // §34 — a warehouse created after the fact is visible to global scope immediately.
    const fresh = await ok(await api('/warehouses', 'POST', { name: `فرع اختبار الصلاحيات ${token}`, location: 'اختبار' }));
    const gmWarehouses = await json(await api('/warehouses', 'GET', undefined, gmCookie));
    assert.ok(gmWarehouses.some((row: any) => row.id === fresh.id), 'A new warehouse must be visible to global scope with no mapping row.');
    const managerWarehouses = await json(await api('/warehouses', 'GET', undefined, managerCookie));
    assert.ok(!managerWarehouses.some((row: any) => row.id === fresh.id), 'A new warehouse must not appear for a scoped manager.');
    // Removed again so this suite leaves the warehouse list exactly as it found it and the
    // other suites keep resolving the same default warehouse.
    await ok(await api(`/warehouses/${fresh.id}`, 'DELETE'), 200);
    step('§34 a warehouse created later is company-wide immediately and stays outside branch scope');

    // ---------------------------------------------------------------- §35 modules
    for (const [path, label] of [['/inventory', 'Inventory'], ['/finance/cashboxes', 'Finance'], ['/accounting/accounts', 'Accounting'], ['/gold/accounts', 'Gold'], ['/users', 'Users'], ['/purchases', 'Purchases']] as const) {
      assert.equal(await status(await api(path, 'GET', undefined, cookieA)), 403, `A seller must be refused ${label}.`);
    }
    step('§35 the seller is refused Inventory, Finance, Accounting, Gold, Users and Purchases at the API');

    // ---------------------------------------------------------------- §11 user administration
    const managerView = await json(await api('/users', 'GET', undefined, managerCookie));
    assert.ok(managerView.every((user: any) => user.scope !== 'global' || user.id === manager.id), 'A branch manager must not read company-wide accounts.');
    assert.ok(managerView.some((user: any) => user.id === sellers.a.id), 'A branch manager must see the sellers of the assigned warehouse.');
    assert.equal(await status(await api('/users', 'POST', { username: `t10_mgm_${token}`, fullName: 'Escalation', password: SECRET, roleName: 'general_manager', warehouseIds: [] }, managerCookie)), 403);
    assert.equal(await status(await api('/users', 'POST', { username: `t10_out_${token}`, fullName: 'Outside', password: SECRET, roleName: 'sales', warehouseIds: [otherId] }, managerCookie)), 403);
    assert.equal(await status(await api(`/users/${gm.id}`, 'GET', undefined, managerCookie)), 403);
    step('§11 a branch manager administers only their own branch and cannot escalate to global');

    // ---------------------------------------------------------------- §23 session invalidation
    const cookieC = await login(`t10_c_${token}`, furqanId);
    assert.equal(await status(await api('/auth/me', 'GET', undefined, cookieC)), 200);
    await ok(await api(`/users/${sellers.c.id}`, 'PATCH', { roleName: 'warehouse_manager', warehouseIds: [furqanId] }), 200);
    assert.equal(await status(await api('/auth/me', 'GET', undefined, cookieC)), 401, 'A role change must invalidate the live session.');
    const promotedCookie = await login(`t10_c_${token}`, furqanId);
    const promoted = await ok(await api('/auth/me', 'GET', undefined, promotedCookie), 200);
    assert.equal(promoted.scope.type, 'warehouses', 'The new session must carry the new scope.');
    step('§23 a role or scope change revokes the live session and the next login carries the new scope');

    // ---------------------------------------------------------------- §24 disabled users
    const cookieD = await login(`t10_d_${token}`, furqanId);
    await ok(await api(`/users/${sellers.d.id}/status`, 'POST', { isActive: false }), 201);
    assert.equal(await status(await api('/auth/me', 'GET', undefined, cookieD)), 401, 'Disabling must drop the live session.');
    const refused = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `t10_d_${token}`, password: SECRET, warehouseId: furqanId }) });
    assert.equal(refused.status, 401, 'A disabled user must not be able to log in.');
    const disabled = await ok(await api(`/users/${sellers.d.id}`), 200);
    assert.equal(disabled.isActive, false);
    assert.ok(!('passwordHash' in disabled), '§25 a password hash must never leave the server.');
    step('§24/§25 a disabled account loses its session and its login, and no hash is ever returned');

    // ---------------------------------------------------------------- §25 password reset
    const cookieE = await login(`t10_e_${token}`, furqanId);
    const reset = await ok(await api(`/users/${sellers.e.id}/password`, 'POST', { password: 'N3wPassw0rd!Task10' }), 201);
    assert.deepEqual(Object.keys(reset).sort(), ['id', 'passwordReset', 'username']);
    assert.equal(await status(await api('/auth/me', 'GET', undefined, cookieE)), 401, 'A password reset must drop live sessions.');
    const oldPassword = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `t10_e_${token}`, password: SECRET, warehouseId: furqanId }) });
    assert.equal(oldPassword.status, 401, 'The previous password must stop working.');
    const newPassword = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `t10_e_${token}`, password: 'N3wPassw0rd!Task10', warehouseId: furqanId }) });
    assert.equal(newPassword.status, 201, 'The new password must work immediately.');
    step('§25 a reset sets a new password, reveals nothing, and invalidates old sessions');

    // ---------------------------------------------------------------- §26 usernames
    assert.equal(await status(await api('/users', 'POST', { username: ` T10_A_${token} `, fullName: 'Case duplicate', password: SECRET, roleName: 'sales', warehouseIds: [furqanId] })), 409);
    assert.equal(await status(await api('/users', 'POST', { username: '  ', fullName: 'Blank', password: SECRET, roleName: 'sales', warehouseIds: [furqanId] })), 409);
    assert.equal(await status(await api('/users', 'POST', { username: `t10_short_${token}`, fullName: 'Weak password', password: 'short', roleName: 'sales', warehouseIds: [furqanId] })), 409);
    step('§26 usernames are normalised and unique, and blank or weak credentials are refused');

    // ---------------------------------------------------------------- §32 ownership preserved
    const reread = await ok(await api(`/sales/${invoiceA.id}`, 'GET', undefined, gmCookie), 200);
    assert.equal(reread.createdBy, 'Seller A', 'Existing invoice ownership must be preserved and visible to management.');
    step('§32 invoice ownership is preserved and attributed to the seller who created it');

    // ---------------------------------------------------------------- §27 audit
    const audit = await json(await api(`/users/${sellers.e.id}`, 'GET'));
    assert.ok(audit.id, 'sanity');
    console.log('\nTASK 10 authorization suite passed.');
  } finally {
    await app.close();
  }
}

await main();
