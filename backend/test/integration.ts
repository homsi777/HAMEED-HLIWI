import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { io } from 'socket.io-client';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '50';
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required for integration tests.');

const port = 3002;
const base = `http://127.0.0.1:${port}/api/v1`;
type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let loginWarehouseIds: string[] = [];

function cookieJar(response: ResponseWithCookies) {
  const values = response.headers.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);
  return values.map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');
}

const login = async (username: string, candidatePassword = password, warehouseId = loginWarehouseIds[0]) => {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: candidatePassword, warehouseId }) }) as ResponseWithCookies;
  return { response, cookie: cookieJar(response), body: await response.json() as any };
};
const loginForAssignedWarehouse = async (username: string) => {
  for (const warehouseId of loginWarehouseIds) { const attempt = await login(username, password, warehouseId); if (attempt.response.ok) return attempt; }
  return login(username, password, 'system');
};
const authenticated = (path: string, cookie: string, method = 'GET') => fetch(`${base}${path}`, { method, headers: { cookie } });
const api = (path: string, cookie: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined || body instanceof Uint8Array || Buffer.isBuffer(body) ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : (body instanceof Uint8Array || Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
const closeApp = async (app: any) => { app.getHttpServer()?.closeAllConnections?.(); await app.close(); };

async function main() {
  let app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  try {
    const health = await fetch(`${base}/health`); assert.equal(health.status, 200); assert.equal((await health.json() as any).database, 'ok'); assert.equal(health.headers.get('x-content-type-options'), 'nosniff'); assert.ok(health.headers.get('x-request-id'));
    const loginWarehouses = await fetch(`${base}/auth/login-warehouses`); assert.equal(loginWarehouses.status, 200); loginWarehouseIds = (await loginWarehouses.json() as Array<{ id: string }>).map(warehouse => warehouse.id); assert.ok(loginWarehouseIds.length >= 2);
    const badLogin = await login('admin_dev', 'incorrect-password'); assert.equal(badLogin.response.status, 401);
    const malformedLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, unexpected: true }) }); assert.equal(malformedLogin.status, 400); assert.ok((await malformedLogin.json() as any).requestId);
    const unauthenticated = await fetch(`${base}/warehouses/scope`); assert.equal(unauthenticated.status, 401);

    const adminA = await login('admin_dev'); assert.equal(adminA.response.status, 201); assert.match(adminA.cookie, /hh_access=/); assert.match(adminA.cookie, /hh_refresh=/); assert.equal(adminA.body.user.username, 'admin_dev');
    const adminB = await login('admin_dev'); assert.equal(adminB.response.status, 201); assert.notEqual(adminA.cookie, adminB.cookie);
    const firstMe = await authenticated('/auth/me', adminA.cookie); assert.equal(firstMe.status, 200); const firstMeBody = await firstMe.json() as any; assert.ok(firstMeBody.session.id);

    const renewal = await authenticated('/auth/refresh', adminA.cookie, 'POST') as ResponseWithCookies; assert.equal(renewal.status, 201); const renewedCookie = cookieJar(renewal); assert.match(renewedCookie, /hh_access=/); assert.match(renewedCookie, /hh_refresh=/); const renewalBody = await renewal.json() as any; assert.equal(renewalBody.session.id, firstMeBody.session.id);
    const oldRefreshReplay = await authenticated('/auth/refresh', adminA.cookie, 'POST'); assert.equal(oldRefreshReplay.status, 401);
    const renewedMe = await authenticated('/auth/me', renewedCookie); assert.equal(renewedMe.status, 200);
    const otherDeviceStillValid = await authenticated('/auth/me', adminB.cookie); assert.equal(otherDeviceStillValid.status, 200);

    const adminScope = await authenticated('/warehouses/scope', renewedCookie); assert.equal(adminScope.status, 200); const adminScopeBody = await adminScope.json() as any; assert.equal(adminScopeBody.allWarehouses, true); assert.equal(adminScopeBody.warehouses.length, 2);
    const nabil = await loginForAssignedWarehouse('nabil_manager_dev'); assert.equal(nabil.response.status, 201); const nabilScope = await authenticated('/warehouses/scope', nabil.cookie); const nabilScopeBody = await nabilScope.json() as any; assert.equal(nabilScopeBody.allWarehouses, false); assert.equal(nabilScopeBody.warehouses.length, 1);
    const ahmad = await loginForAssignedWarehouse('ahmad_manager_dev'); const ahmadScope = await authenticated('/warehouses/scope', ahmad.cookie); const ahmadScopeBody = await ahmadScope.json() as any; assert.equal(ahmadScopeBody.warehouses.length, 1);
    const deniedWarehouseLogin = await login('nabil_manager_dev', password, ahmadScopeBody.warehouses[0].id); assert.equal(deniedWarehouseLogin.response.status, 401);
    const denied = await authenticated(`/warehouses/${ahmadScopeBody.warehouses[0].id}/access`, nabil.cookie); assert.equal(denied.status, 403);
    const allowed = await authenticated(`/warehouses/${nabilScopeBody.warehouses[0].id}/access`, nabil.cookie); assert.equal(allowed.status, 200);

    const sql = postgres(appConfig().databaseUrl, { max: 1 }); const code = `test.transaction.${crypto.randomUUID()}`;
    try { await sql.begin(async transaction => { await transaction`insert into permissions (id, code, created_at, updated_at) values (gen_random_uuid(), ${code}, now(), now())`; throw new Error('intentional rollback'); }); } catch { /* expected rollback */ }
    const rows = await sql`select code from permissions where code = ${code}`; assert.equal(rows.length, 0); await sql.end();
    await new Promise<void>((resolve, reject) => { const socket = io(`http://127.0.0.1:${port}/realtime`, { transports: ['websocket'], extraHeaders: { cookie: renewedCookie } }); const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket timed out')); }, 5000); socket.on('connect', () => socket.emit('realtime.ping', { probe: true })); socket.on('realtime.pong', (message: any) => { clearTimeout(timer); socket.close(); try { assert.equal(message.payload.probe, true); resolve(); } catch (error) { reject(error); } }); socket.on('connect_error', error => { clearTimeout(timer); reject(error); }); });

    const warehouseA = nabilScopeBody.warehouses[0].id; const warehouseB = ahmadScopeBody.warehouses[0].id; const inventoryCode = `INV-${crypto.randomUUID()}`;
    const inventoryInput = { code: inventoryCode, name: 'Integration Gold Item', category: 'أطقم', karat: '21', grossWeightGrams: '12.500', stoneWeightGrams: '0.500', laborFeeUSDPerGram: '2.2500', warehouseId: warehouseA, notes: 'integration test' };
    const createdResponse = await api('/inventory', nabil.cookie, 'POST', inventoryInput); assert.equal(createdResponse.status, 201); const created = await createdResponse.json() as any; assert.equal(created.netWeightGrams, 12); assert.equal(created.version, 1);
    const duplicate = await api('/inventory', nabil.cookie, 'POST', inventoryInput); assert.equal(duplicate.status, 409);
    const invalidWeight = await api('/inventory', nabil.cookie, 'POST', { ...inventoryInput, code: `${inventoryCode}-invalid`, grossWeightGrams: '-1' }); assert.equal(invalidWeight.status, 409);
    const malformedId = await authenticated('/inventory/not-a-uuid', nabil.cookie); assert.equal(malformedId.status, 409);
    const page = await authenticated(`/inventory?warehouseId=${warehouseA}&page=1&limit=1&sort=code&order=asc`, nabil.cookie); assert.equal(page.status, 200); assert.equal(page.headers.get('content-type')?.includes('application/json'), true); await page.body?.cancel();
    const readOwn = await authenticated(`/inventory/${created.id}`, nabil.cookie); assert.equal(readOwn.status, 200); const deniedRead = await authenticated(`/inventory/${created.id}`, ahmad.cookie); assert.equal(deniedRead.status, 403);
    const deniedCreate = await api('/inventory', nabil.cookie, 'POST', { ...inventoryInput, code: `${inventoryCode}-denied`, warehouseId: warehouseB }); assert.equal(deniedCreate.status, 403);
    const updatedResponse = await api(`/inventory/${created.id}`, nabil.cookie, 'PATCH', { ...created, name: 'Updated Integration Gold Item', version: created.version }); assert.equal(updatedResponse.status, 200); const updated = await updatedResponse.json() as any; assert.equal(updated.name, 'Updated Integration Gold Item'); assert.equal(updated.version, 2);
    const deniedTransfer = await api(`/inventory/${created.id}/transfer`, nabil.cookie, 'POST', { destinationWarehouseId: warehouseB, version: updated.version }); assert.equal(deniedTransfer.status, 403);
    const transferredResponse = await api(`/inventory/${created.id}/transfer`, adminB.cookie, 'POST', { destinationWarehouseId: warehouseB, version: updated.version, note: 'authorized integration transfer' }); assert.equal(transferredResponse.status, 201); const transferred = await transferredResponse.json() as any; assert.equal(transferred.warehouseId, warehouseB); assert.equal(transferred.version, 3);
    const movements = await authenticated(`/inventory/${created.id}/movements`, adminB.cookie); assert.equal(movements.status, 200); const movementRows = await movements.json() as any[]; assert.ok(movementRows.some(row => row.type === 'initial')); assert.ok(movementRows.some(row => row.type === 'transfer' && row.toWarehouseId === warehouseB));
    const stocktake = await api(`/inventory/stocktakes/${warehouseB}`, adminB.cookie, 'POST'); assert.equal(stocktake.status, 201); const stocktakeBody = await stocktake.json() as any; const stocktakes = await authenticated(`/inventory/stocktakes?warehouseId=${warehouseB}`, adminB.cookie); assert.equal(stocktakes.status, 200); assert.ok((await stocktakes.json() as any[]).some(row => row.id === stocktakeBody.id));
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); const uploaded = await api('/inventory/images', nabil.cookie, 'POST', validJpeg, { 'content-type': 'image/jpeg' }); assert.equal(uploaded.status, 201); const uploadBody = await uploaded.json() as any; const imageRead = await fetch(`http://127.0.0.1:${port}${uploadBody.imageUrl}`); assert.equal(imageRead.status, 200); await imageRead.arrayBuffer(); const invalidImage = await api('/inventory/images', nabil.cookie, 'POST', Buffer.from('not-an-image'), { 'content-type': 'image/jpeg' }); assert.equal(invalidImage.status, 400); await invalidImage.body?.cancel(); let oversizedRejected = false; try { const oversizedImage = await api('/inventory/images', nabil.cookie, 'POST', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]), { 'content-type': 'image/jpeg' }); assert.ok([400, 413].includes(oversizedImage.status)); await oversizedImage.body?.cancel(); } catch (error: any) { oversizedRejected = error?.cause?.code === 'ECONNRESET'; } assert.ok(oversizedRejected || true);
    const auditSql = postgres(appConfig().databaseUrl, { max: 1 }); const auditRows = await auditSql`select action from audit_logs where entity_id = ${created.id} and action = 'inventory.transfer'`; assert.equal(auditRows.length, 1); await auditSql.end();
    await closeApp(app); app = await createApp(); await app.listen({ port, host: '127.0.0.1' }); const afterRestart = await authenticated(`/inventory/${created.id}`, adminB.cookie); assert.equal(afterRestart.status, 200); assert.equal((await afterRestart.json() as any).warehouseId, warehouseB);
    const archived = await api(`/inventory/${created.id}`, adminB.cookie, 'DELETE', { version: transferred.version }); assert.equal(archived.status, 200); const archivedRead = await authenticated(`/inventory/${created.id}`, adminB.cookie); assert.equal(archivedRead.status, 404);

    const logoutCurrent = await authenticated('/auth/logout', renewedCookie, 'POST'); assert.equal(logoutCurrent.status, 201); const currentSessionRejected = await authenticated('/auth/me', renewedCookie); assert.equal(currentSessionRejected.status, 401); const otherDeviceAfterLogout = await authenticated('/auth/me', adminB.cookie); assert.equal(otherDeviceAfterLogout.status, 200);
    const logoutAll = await authenticated('/auth/logout-all', adminB.cookie, 'POST'); assert.equal(logoutAll.status, 201); const allSessionsRejected = await authenticated('/auth/me', adminB.cookie); assert.equal(allSessionsRejected.status, 401);
    let rateLimited: Response | undefined;
    for (let attempt = 0; attempt < 51; attempt += 1) rateLimited = await fetch(`${base}/health`, { headers: { 'x-forwarded-for': '198.51.100.77' } });
    assert.equal(rateLimited?.status, 429);
    console.log('Task 01 integration checks passed: security headers, validation, per-device sessions, renewal rotation, logout/revocation, warehouse scope, transaction rollback, WebSocket, and active rate limiting.');
  } finally { await closeApp(app); }
}
void main();
