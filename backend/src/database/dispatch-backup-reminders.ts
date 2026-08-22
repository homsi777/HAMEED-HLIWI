import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appConfig } from '../config/app-config.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const config = appConfig();
const sql = postgres(config.databaseUrl, { max: 1 });
const db = drizzle(sql);
try { console.log(JSON.stringify(await new NotificationsService(db as any).sendBackupReminders())); }
finally { await sql.end(); }
