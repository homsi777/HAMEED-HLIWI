import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appConfig } from '../config/app-config.js';
import { runBackup } from '../backups/backup-runner.js';

/**
 * TASK 20 §2: the entry point the scheduler calls.
 *
 * It shares `runBackup` with the manual endpoint on purpose. Two implementations would eventually
 * disagree about retention or naming, and the one nobody exercises by hand is the one that breaks
 * quietly — which is the failure mode this whole task exists to remove.
 *
 * Installed as a daily cron entry; see BACKUP_AND_RECOVERY_RUNBOOK.md.
 */
async function main() {
  const config = appConfig();
  const sql = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    const result = await runBackup(db, { kind: 'scheduled', databaseUrl: config.databaseUrl });
    console.log(`[backup] ${new Date().toISOString()} ok ${result.fileName} ${result.sizeBytes} bytes`);
  } catch (error: any) {
    // The failure is already recorded in `backup_runs`, which is what the health check reads.
    // Exiting non-zero also lets cron's own mail or a wrapper notice.
    console.error(`[backup] ${new Date().toISOString()} FAILED ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

await main();
