import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { appConfig } from '../config/app-config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { backupRuns } from '../database/schema.js';
import { backupDirectory, backupHealth, runBackup } from './backup-runner.js';

/** §18: short-lived and single-use, so the URL is useless the moment it is used or shared. */
const TOKEN_TTL_MS = 5 * 60 * 1000;
/** §14: a full dump is expensive; one at a time, with a cooldown a held button cannot defeat. */
const COOLDOWN_MS = 60 * 1000;

type DownloadTicket = { runId: string; userId: string; expiresAt: number };

@Injectable()
export class BackupsService {
  private readonly tickets = new Map<string, DownloadTicket>();
  private running = false;
  private lastStartedAt = 0;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** §15: what exists, so "I think we have backups" becomes knowing. */
  async list() {
    const rows = await this.db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(50);
    return {
      health: await backupHealth(this.db),
      runs: rows.map(row => ({
        id: row.id, fileName: row.fileName, sizeBytes: Number(row.sizeBytes), kind: row.kind, status: row.status,
        startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
        errorMessage: row.errorMessage,
        // The file may have been pruned while its row is still inside the retention window.
        available: row.status === 'completed' && fs.existsSync(path.join(backupDirectory(), row.fileName)),
      })),
    };
  }

  async create(user: AuthIdentity) {
    if (this.running) throw new ConflictException('A backup is already running. Wait for it to finish.');
    if (Date.now() - this.lastStartedAt < COOLDOWN_MS) throw new ConflictException('A backup was just taken. Try again in a minute.');
    this.running = true;
    this.lastStartedAt = Date.now();
    try {
      const result = await runBackup(this.db, { kind: 'manual', actorUserId: user.id, databaseUrl: appConfig().databaseUrl });
      // §13: a record you may one day need — who took a copy of the whole business, and when.
      await this.audit.record({ actorUserId: user.id, action: 'backup.create', module: 'backups', entityId: result.id });
      return { id: result.id, fileName: result.fileName, sizeBytes: result.sizeBytes };
    } finally {
      this.running = false;
    }
  }

  /**
   * §18: the browser downloads with a one-time ticket rather than a guessable URL to a file that
   * contains everything. The ticket is bound to the user who asked for it and dies in minutes.
   */
  async issueTicket(user: AuthIdentity, runId: string) {
    const [row] = await this.db.select().from(backupRuns).where(eq(backupRuns.id, runId)).limit(1);
    if (!row || row.status !== 'completed') throw new NotFoundException('That backup is not available.');
    if (!fs.existsSync(path.join(backupDirectory(), row.fileName))) throw new NotFoundException('That backup file is no longer on disk.');

    this.sweep();
    const token = crypto.randomBytes(32).toString('base64url');
    this.tickets.set(token, { runId, userId: user.id, expiresAt: Date.now() + TOKEN_TTL_MS });
    return { token, fileName: row.fileName, sizeBytes: Number(row.sizeBytes), expiresInSeconds: TOKEN_TTL_MS / 1000 };
  }

  /**
   * Redeems a ticket. The session is still required by the guard on the route — the ticket is not
   * a way in, only a way to make the URL itself worthless once used.
   */
  async redeem(user: AuthIdentity, token: string) {
    this.sweep();
    const ticket = this.tickets.get(token);
    if (!ticket) throw new NotFoundException('This download link has expired. Ask for a new one.');
    // Bound to the requester: a link that leaks is useless to anyone else.
    if (ticket.userId !== user.id) throw new ForbiddenException('This download link was issued to someone else.');
    this.tickets.delete(token);

    const [row] = await this.db.select().from(backupRuns).where(eq(backupRuns.id, ticket.runId)).limit(1);
    if (!row) throw new NotFoundException('That backup is no longer recorded.');
    const filePath = path.join(backupDirectory(), row.fileName);
    if (!fs.existsSync(filePath)) throw new NotFoundException('That backup file is no longer on disk.');

    await this.audit.record({ actorUserId: user.id, action: 'backup.download', module: 'backups', entityId: row.id });
    return { filePath, fileName: row.fileName, sizeBytes: Number(row.sizeBytes) };
  }

  private sweep() {
    const now = Date.now();
    for (const [token, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(token);
  }
}
