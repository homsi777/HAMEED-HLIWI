import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../database/database.module.js';
import { auditLogs } from '../database/schema.js';
import { RequestContextService } from '../common/request-context.service.js';

export interface AuditInput { actorUserId?: string; action: string; module: string; entityId?: string; warehouseId?: string; metadata?: Record<string, unknown>; }
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(RequestContextService) private readonly context: RequestContextService) {}
  async record(input: AuditInput, database: any = this.db) { const requestId = this.context.get()?.requestId; await database.insert(auditLogs).values({ ...input, requestId, metadata: input.metadata ?? {} }); }
}
