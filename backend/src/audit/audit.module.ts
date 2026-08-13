import { Global, Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { AuditService } from './audit.service.js';
@Global() @Module({ imports: [CommonModule], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
