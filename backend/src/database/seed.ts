import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { appConfig } from '../config/app-config.js';
import { permissions, rolePermissions, roles, userRoles, userWarehouses, users, warehouses } from './schema.js';

const permissionCodes = ['inventory.view', 'inventory.create', 'inventory.update', 'inventory.delete', 'inventory.transfer', 'inventory.adjust', 'sales.view', 'sales.create', 'sales.update', 'sales.cancel', 'sales.return', 'sales.discount', 'sales.approve', 'customers.view', 'customers.create', 'customers.update', 'customers.archive', 'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.archive', 'reports.view', 'users.view', 'users.manage', 'warehouses.view', 'warehouses.manage', 'warehouses.scope.all'];
async function main() {
  if ((process.env.NODE_ENV ?? 'development') === 'production') throw new Error('Refusing to seed production. Use an explicit production bootstrap process.');
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters for development seed.');
  const config = appConfig(); const sql = postgres(config.databaseUrl, { max: 1 }); const db = drizzle(sql);
  try {
    for (const code of permissionCodes) await db.insert(permissions).values({ code, description: code }).onConflictDoNothing();
    const roleDefinitions = [{ name: 'system_admin', displayName: 'System Administrator' }, { name: 'warehouse_manager', displayName: 'Warehouse Manager' }, { name: 'sales', displayName: 'Sales User' }];
    for (const role of roleDefinitions) await db.insert(roles).values(role).onConflictDoNothing();
    const allRoles = await db.select().from(roles); const allPermissions = await db.select().from(permissions);
    const admin = allRoles.find(role => role.name === 'system_admin')!; const manager = allRoles.find(role => role.name === 'warehouse_manager')!; const sales = allRoles.find(role => role.name === 'sales')!;
    const permissionId = (code: string) => allPermissions.find(permission => permission.code === code)!.id;
    const mapPermissions = async (roleId: string, codes: string[]) => { for (const code of codes) await db.insert(rolePermissions).values({ roleId, permissionId: permissionId(code) }).onConflictDoNothing(); };
    await mapPermissions(admin.id, permissionCodes);
    await mapPermissions(manager.id, ['inventory.view', 'inventory.create', 'inventory.update', 'inventory.transfer', 'sales.view', 'sales.create', 'sales.update', 'customers.view', 'customers.create', 'customers.update', 'suppliers.view', 'suppliers.create', 'suppliers.update', 'reports.view', 'warehouses.view']);
    await mapPermissions(sales.id, ['sales.view', 'sales.create', 'customers.view', 'customers.create', 'warehouses.view']);
    const hash = await bcrypt.hash(password, 12);
    const developmentUsers = [{ username: 'admin_dev', fullName: 'Development Administrator' }, { username: 'nabil_manager_dev', fullName: 'Nabil Warehouse Manager' }, { username: 'ahmad_manager_dev', fullName: 'Ahmad Warehouse Manager' }, { username: 'furqan_sales_dev', fullName: 'Furqan Sales User' }, { username: 'dana_sales_dev', fullName: 'Dana Sales User' }];
    for (const user of developmentUsers) await db.insert(users).values({ ...user, passwordHash: hash }).onConflictDoNothing();
    const allUsers = await db.select().from(users); const byUsername = (username: string) => allUsers.find(user => user.username === username)!;
    const warehouseDefinitions = [{ name: 'مستودع حلب الفرقان', location: 'حلب - الفرقان', phone: null }, { name: 'مستودع إدلب الدانة', location: 'إدلب - الدانة', phone: null }];
    for (const warehouse of warehouseDefinitions) await db.insert(warehouses).values(warehouse).onConflictDoNothing();
    const allWarehouses = await db.select().from(warehouses); const furqan = allWarehouses.find(warehouse => warehouse.name === 'مستودع حلب الفرقان')!; const dana = allWarehouses.find(warehouse => warehouse.name === 'مستودع إدلب الدانة')!;
    for (const [username, role] of [['admin_dev', admin], ['nabil_manager_dev', manager], ['ahmad_manager_dev', manager], ['furqan_sales_dev', sales], ['dana_sales_dev', sales]] as const) await db.insert(userRoles).values({ userId: byUsername(username).id, roleId: role.id }).onConflictDoNothing();
    for (const [username, warehouse, isManager] of [['admin_dev', furqan, false], ['admin_dev', dana, false], ['nabil_manager_dev', furqan, true], ['furqan_sales_dev', furqan, false], ['ahmad_manager_dev', dana, true], ['dana_sales_dev', dana, false]] as const) await db.insert(userWarehouses).values({ userId: byUsername(username).id, warehouseId: warehouse.id, isManager }).onConflictDoNothing();
    await db.update(warehouses).set({ managerUserId: byUsername('nabil_manager_dev').id }).where(eq(warehouses.id, furqan.id));
    await db.update(warehouses).set({ managerUserId: byUsername('ahmad_manager_dev').id }).where(eq(warehouses.id, dana.id));
    console.log('Development seed completed. Development users were created or retained.');
  } finally { await sql.end(); }
}
void main();
