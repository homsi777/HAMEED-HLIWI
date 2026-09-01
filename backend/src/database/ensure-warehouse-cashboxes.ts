import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { appConfig } from '../config/app-config.js';
import { users, warehouses } from './schema.js';
import { ensureWarehouseDefaultCashboxes } from '../finance/warehouse-default-cashboxes.js';

/** Idempotently prepares both default cashboxes for every existing warehouse. */
async function main() {
  const sql = postgres(appConfig().databaseUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    const [allWarehouses, fallbackUsers] = await Promise.all([
      db.select({ id: warehouses.id, managerUserId: warehouses.managerUserId }).from(warehouses),
      db.select({ id: users.id }).from(users).limit(1),
    ]);
    const fallbackUserId = fallbackUsers[0]?.id;
    if (!fallbackUserId && allWarehouses.length) throw new Error('Cannot create cashboxes because no user exists to own the audit fields.');
    for (const warehouse of allWarehouses) {
      const prepared = await db.transaction(tx => ensureWarehouseDefaultCashboxes(tx, warehouse.id, warehouse.managerUserId ?? fallbackUserId!));
      if (prepared.size !== 2) throw new Error(`Default cashboxes could not be verified for warehouse ${warehouse.id}.`);
    }
    console.log(`Default USD and SYP cashboxes verified for ${allWarehouses.length} warehouse(s).`);
  } finally { await sql.end(); }
}
void main();
