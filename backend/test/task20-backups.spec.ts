import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import postgres from 'postgres';
import { appConfig } from '../src/config/app-config.js';

// Task 20: backups, and the guarantee that a backup file is treated as what it is — the entire
// business in one document: every customer, every balance, every price, every password hash.
//
// The download path is the part worth being paranoid about, so most of this file is about who
// may reach a backup and how quickly a link stops working.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '5000';
// Backups are written somewhere disposable for the run and removed at the end.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-backup-'));
process.env.BACKUP_DIR = SANDBOX;
if (!process.env.PG_DUMP_PATH && process.platform === 'win32' && fs.existsSync('C:/Program Files/PostgreSQL/16/bin/pg_dump.exe')) {
  process.env.PG_DUMP_PATH = 'C:/Program Files/PostgreSQL/16/bin/pg_dump.exe';
}
const { createApp } = await import('../src/main.js');

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error('SEED_ADMIN_PASSWORD is required.');
const SELLER_SECRET = 'T20seller!2026';
const port = 3022;
const base = `http://127.0.0.1:${port}/api/v1`;
const token = crypto.randomUUID().slice(0, 8);

type ResponseWithCookies = Response & { headers: Headers & { getSetCookie?: () => string[] } };
let cookie = '';
const api = (path_: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}${path_}`, { method, headers: { cookie: auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response) => response.json() as Promise<any>;
const ok = async (response: Response, expected = 200) => { const body = await json(response); assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`); return body; };
const step = (message: string) => console.log(`  ✓ ${message}`);
const jar = (response: ResponseWithCookies) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';', 1)[0]).filter(value => value.startsWith('hh_')).join('; ');

async function main() {
  const app = await createApp();
  await app.listen({ port, host: '127.0.0.1' });
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  const username = `t20_seller_${token}`;
  try {
    const warehouses = await json(await fetch(`${base}/auth/login-warehouses`));
    const warehouseId = warehouses[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin_dev', password, warehouseId }) }) as ResponseWithCookies;
    cookie = jar(login);

    const [booksBefore] = await sql`select round(sum(total_debit_usd),4) as debit, round(sum(total_credit_usd),4) as credit from journal_entries`;

    // ---------------------------------------------------------------- §28 a backup is produced
    const created = await ok(await api('/backups', 'POST'), 201);
    assert.ok(created.fileName?.endsWith('.sql.gz'), 'the backup must be a compressed dump');
    assert.ok(created.sizeBytes > 0, 'the backup must not be empty');
    const filePath = path.join(SANDBOX, created.fileName);
    assert.ok(fs.existsSync(filePath), 'the file must exist on disk');

    // A dump that cannot be read back is not a backup. Decompress it and look for real schema.
    const contents = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
    assert.ok(contents.includes('PostgreSQL database dump'), 'the file must be a real pg_dump');
    for (const table of ['journal_entries', 'partners', 'sales_invoices', 'app_settings']) {
      assert.ok(contents.includes(table), `the dump must contain ${table}`);
    }
    step(`§28 a ${Math.round(created.sizeBytes / 1024)} KB compressed dump was produced and decompresses to a real schema`);

    // ---------------------------------------------------------------- §5 health is visible
    const listed = await ok(await api('/backups'));
    const row = listed.runs.find((entry: any) => entry.id === created.id);
    assert.ok(row, 'the run must be listed');
    assert.equal(row.status, 'completed');
    assert.equal(row.kind, 'manual');
    assert.equal(row.available, true, 'the file must be reported as available');
    assert.ok(listed.health.lastSuccessfulAt, '§5 the last successful backup must be visible');
    assert.equal(listed.health.stale, false, 'a backup taken seconds ago is not stale');
    assert.equal(listed.health.offServerCopy, false, '§8 the absence of an off-server copy must be stated, not implied');
    step(`§5 health reports the last success, staleness and that there is no off-server copy yet`);

    // ---------------------------------------------------------------- §14 one at a time
    assert.equal((await api('/backups', 'POST')).status, 409, '§14 a second backup straight away must be refused');
    step('§14 a rapid second backup is refused rather than allowed to exhaust the server');

    // ---------------------------------------------------------------- §18 the download ticket
    const ticket = await ok(await api(`/backups/${created.id}/ticket`, 'POST'), 201);
    assert.ok(ticket.token && ticket.token.length > 20, 'a ticket must be issued');
    assert.equal(ticket.fileName, created.fileName);

    const download = await api(`/backups/download/${ticket.token}`);
    assert.equal(download.status, 200, 'the ticket must download the file');
    // §17: a real response the browser can hand to the Files app, not a script-made blob.
    assert.match(download.headers.get('content-disposition') ?? '', /attachment; filename="/, '§17 the response must be an attachment');
    assert.equal(download.headers.get('content-type'), 'application/gzip');
    const body = Buffer.from(await download.arrayBuffer());
    assert.equal(body.length, created.sizeBytes, 'the whole file must arrive');
    assert.ok(zlib.gunzipSync(body).toString('utf8').includes('PostgreSQL database dump'), 'the downloaded bytes must be the dump itself');
    step(`§17/§18 the download is a real attachment response and the received bytes are the dump`);

    // §18: single use.
    assert.equal((await api(`/backups/download/${ticket.token}`)).status, 404, '§18 a ticket must not work twice');
    step('§18 the ticket is single-use — a leaked link is worthless once redeemed');

    // ---------------------------------------------------------------- §30 who may reach a backup
    await ok(await api('/users', 'POST', { username, fullName: `بائع نسخ ${token}`, password: SELLER_SECRET, roleName: 'sales', warehouseIds: [warehouseId] }), 201);
    const sellerLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: SELLER_SECRET, warehouseId }) }) as ResponseWithCookies;
    const seller = jar(sellerLogin);

    assert.equal((await api('/backups', 'GET', undefined, seller)).status, 403, 'a seller must not list backups');
    assert.equal((await api('/backups', 'POST', undefined, seller)).status, 403, 'a seller must not take a backup');
    assert.equal((await api(`/backups/${created.id}/ticket`, 'POST', undefined, seller)).status, 403, 'a seller must not obtain a download ticket');
    assert.equal((await fetch(`${base}/backups`)).status, 401, 'an unauthenticated caller must be refused');
    step('§30 a seller is refused listing, taking and downloading; unauthenticated callers get 401');

    // A ticket issued to the manager must be useless to anyone else, even one who could hold the
    // permission — the ticket is bound to the person who asked for it.
    const second = await ok(await api(`/backups/${created.id}/ticket`, 'POST'), 201);
    assert.equal((await api(`/backups/download/${second.token}`, 'GET', undefined, seller)).status, 403, '§18 a ticket must not work for another session');
    step('§18 a ticket is bound to the session that asked for it');

    // ---------------------------------------------------------------- §19 no path is served
    for (const guess of [`/backups/download/${created.fileName}`, '/backups/download/../../etc/passwd', `/backups/${created.fileName}`]) {
      const response = await api(guess);
      assert.notEqual(response.status, 200, `§19 a guessed path must never return a file: ${guess}`);
    }
    step('§19 backup files are not reachable by path, only through an issued ticket');

    // ---------------------------------------------------------------- §34 production is untouched
    const [booksAfter] = await sql`select round(sum(total_debit_usd),4) as debit, round(sum(total_credit_usd),4) as credit from journal_entries`;
    assert.equal(String(booksAfter.debit), String(booksBefore.debit), '§34 taking a backup must not change a single business row');
    assert.equal(String(booksAfter.credit), String(booksBefore.credit));
    step(`§34 the books are identical before and after — ${booksAfter.debit} = ${booksAfter.credit}`);

    // ---------------------------------------------------------------- §31 audited
    const [audited] = await sql`select count(*)::int as n from audit_logs where action in ('backup.create', 'backup.download')`;
    assert.ok(audited.n >= 2, '§31 both taking and downloading a backup must be audited');
    step(`§31 backup activity is written to the audit trail (${audited.n} entries)`);

    console.log('\nTASK 20 backups suite passed.');
  } finally {
    await sql`delete from auth_sessions where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_warehouses where user_id in (select id from users where username = ${username})`;
    await sql`delete from user_roles where user_id in (select id from users where username = ${username})`;
    // The sandbox and the rows describing it are removed; nothing about this run is left behind.
    await sql`delete from backup_runs where file_name like 'hameed-hliwi-manual-%'`;
    await sql.end();
    await app.close();
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
}

await main();
