import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  @Get() async check() { try { await this.db.execute(sql`select 1`); return { status: 'ok', database: 'ok' }; } catch { throw new ServiceUnavailableException('Database unavailable.'); } }
}
