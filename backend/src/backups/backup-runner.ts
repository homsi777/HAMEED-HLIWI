import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { backupRuns } from '../database/schema.js';

/**
 * TASK 20: one place that actually takes a backup, used by both the manual endpoint and the
 * scheduled timer. Two code paths would eventually disagree about retention or naming, and the
 * one nobody exercises is the one that breaks.
 */

export const backupDirectory = () => process.env.BACKUP_DIR?.trim() || path.join(process.env.HOME || '/home/ubuntu', 'backups');

/** §4: daily for two weeks, then weekly for three months. A disk that fills up stops backing up. */
const DAILY_RETENTION_DAYS = 14;
const WEEKLY_RETENTION_DAYS = 90;
/** §37: refuse to write when the disk is nearly full rather than taking the site down with it. */
const MINIMUM_FREE_BYTES = 512 * 1024 * 1024;

export type BackupKind = 'scheduled' | 'manual';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const freeBytes = (directory: string) => {
  try { return Number(fs.statfsSync(directory).bavail) * Number(fs.statfsSync(directory).bsize); }
  catch { return Number.POSITIVE_INFINITY; }
};

/**
 * Runs `pg_dump`, compresses the stream, and records the outcome either way. A failed run is
 * written down too — a backup system that only records its successes cannot be monitored.
 */
export async function runBackup(db: any, options: { kind: BackupKind; actorUserId?: string | null; databaseUrl: string }) {
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true });

  if (freeBytes(directory) < MINIMUM_FREE_BYTES) {
    throw new Error('Not enough free disk space to take a backup safely.');
  }

  const fileName = `hameed-hliwi-${options.kind}-${stamp()}.sql.gz`;
  const target = path.join(directory, fileName);

  const [run] = await db.insert(backupRuns).values({
    fileName, kind: options.kind, status: 'running', actorUserId: options.actorUserId ?? null,
  }).returning();

  try {
    await new Promise<void>((resolve, reject) => {
      // `--no-owner` keeps the dump restorable by a role other than the one that produced it,
      // which is exactly the situation a real recovery tends to be.
      // `PG_DUMP_PATH` exists so a machine where the binary is not on PATH can still run this —
      // the development laptop, chiefly. Production leaves it unset and uses /usr/bin/pg_dump.
      const binary = process.env.PG_DUMP_PATH?.trim() || 'pg_dump';
      const dump = spawn(binary, ['--no-owner', '--clean', '--if-exists', options.databaseUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
      const gzip = zlib.createGzip();
      const out = fs.createWriteStream(target);
      let stderr = '';
      dump.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
      dump.on('error', reject);
      dump.on('close', code => { if (code !== 0) reject(new Error(`pg_dump exited with ${code}: ${stderr.trim()}`)); });
      out.on('error', reject);
      out.on('finish', () => resolve());
      dump.stdout.pipe(gzip).pipe(out);
    });

    const size = fs.statSync(target).size;
    if (size <= 0) throw new Error('The backup file is empty.');
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

    await db.update(backupRuns)
      .set({ status: 'completed', sizeBytes: size, checksum, completedAt: new Date() })
      .where(eq(backupRuns.id, run.id));

    await prune(db, directory);
    return { id: run.id, fileName, sizeBytes: size, checksum };
  } catch (error: any) {
    // Leave nothing half-written to be mistaken for a real backup later.
    try { fs.rmSync(target, { force: true }); } catch { /* the file may never have been created */ }
    await db.update(backupRuns)
      .set({ status: 'failed', errorMessage: String(error?.message ?? error).slice(0, 1000), completedAt: new Date() })
      .where(eq(backupRuns.id, run.id));
    throw error;
  }
}

/** §4: prune by age, keeping one per week beyond the daily window. */
async function prune(db: any, directory: string) {
  const now = Date.now();
  const rows = await db.select().from(backupRuns)
    .where(and(eq(backupRuns.status, 'completed'), lt(backupRuns.startedAt, new Date(now - DAILY_RETENTION_DAYS * 86400000))))
    .orderBy(desc(backupRuns.startedAt));

  const keptWeeks = new Set<string>();
  for (const row of rows) {
    const started = new Date(row.startedAt);
    const ageDays = (now - started.getTime()) / 86400000;
    const week = `${started.getUTCFullYear()}-${Math.floor(started.getTime() / (7 * 86400000))}`;
    const keepAsWeekly = ageDays <= WEEKLY_RETENTION_DAYS && !keptWeeks.has(week);
    if (keepAsWeekly) { keptWeeks.add(week); continue; }

    try { fs.rmSync(path.join(directory, row.fileName), { force: true }); } catch { /* already gone */ }
    await db.delete(backupRuns).where(eq(backupRuns.id, row.id));
  }
}

/** §5: what a human needs to know — did it run, when, and was it any good. */
export async function backupHealth(db: any) {
  const [last] = await db.select().from(backupRuns)
    .where(eq(backupRuns.status, 'completed')).orderBy(desc(backupRuns.startedAt)).limit(1);
  const [failures] = await db.select({ count: sql<number>`count(*)::int` }).from(backupRuns)
    .where(and(eq(backupRuns.status, 'failed'), sql`${backupRuns.startedAt} > now() - interval '7 days'`));

  const hoursSince = last ? (Date.now() - new Date(last.startedAt).getTime()) / 3600000 : null;
  return {
    lastSuccessfulAt: last ? new Date(last.startedAt).toISOString() : null,
    lastSuccessfulSizeBytes: last ? Number(last.sizeBytes) : null,
    hoursSinceLastSuccess: hoursSince === null ? null : Number(hoursSince.toFixed(1)),
    // A schedule that stopped three weeks ago has to be visible, not inferred.
    stale: hoursSince === null || hoursSince > 48,
    recentFailures: failures?.count ?? 0,
    // §8: stated plainly, because a backup on the machine it protects survives a bad migration
    // and not a dead disk.
    offServerCopy: false,
  };
}
