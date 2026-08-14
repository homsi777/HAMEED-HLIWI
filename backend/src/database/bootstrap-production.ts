import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appConfig } from '../config/app-config.js';
import { permissions, rolePermissions, roles, userRoles, users } from './schema.js';
import { ALL_PERMISSION_CODES, GENERAL_MANAGER_PERMISSIONS, GENERAL_MANAGER_ROLE, OWN_SCOPE_PERMISSION } from '../authorization/authorization.constants.js';

const permissionCodes = [...ALL_PERMISSION_CODES];

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the one-time production bootstrap.`);
  return value;
};

async function main() {
  if (process.env.NODE_ENV !== 'production') throw new Error('Production bootstrap is only allowed when NODE_ENV=production.');
  const username = required('PRODUCTION_BOOTSTRAP_USERNAME');
  const fullName = required('PRODUCTION_BOOTSTRAP_FULL_NAME');
  const password = required('PRODUCTION_BOOTSTRAP_PASSWORD');
  if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username) || password.length < 16) throw new Error('Bootstrap username or password does not meet the production policy.');
  const config = appConfig();
  const sql = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    for (const code of permissionCodes) await db.insert(permissions).values({ code, description: code }).onConflictDoNothing();
    // The first production account is the operational General Manager, not a technical role.
    await db.insert(roles).values({ name: GENERAL_MANAGER_ROLE, displayName: 'المدير العام', description: 'المدير العام للشركة بنطاق شامل', isSystem: false }).onConflictDoNothing();
    const adminRole = (await db.select().from(roles).where(eq(roles.name, GENERAL_MANAGER_ROLE)).limit(1))[0];
    if (!adminRole) throw new Error('General manager role could not be initialized.');
    const allPermissions = await db.select().from(permissions);
    for (const permission of allPermissions.filter(row => GENERAL_MANAGER_PERMISSIONS.includes(row.code as typeof GENERAL_MANAGER_PERMISSIONS[number]) && row.code !== OWN_SCOPE_PERMISSION)) await db.insert(rolePermissions).values({ roleId: adminRole.id, permissionId: permission.id }).onConflictDoNothing();
    const existingUser = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
    const user = existingUser ?? (await db.insert(users).values({ username, fullName, passwordHash: await bcrypt.hash(password, 12) }).returning())[0];
    if (!user) throw new Error('Initial production administrator could not be created.');
    const mapping = await db.select().from(userRoles).where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, adminRole.id))).limit(1);
    if (!mapping[0]) await db.insert(userRoles).values({ userId: user.id, roleId: adminRole.id });
    console.log('Production bootstrap completed without printing credentials.');
  } finally {
    await sql.end();
  }
}

void main();
