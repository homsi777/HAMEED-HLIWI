import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { WarehousesModule } from '../warehouses/warehouses.module.js';
import { GoldController } from './gold.controller.js';
import { GoldDocumentsService } from './gold-documents.service.js';
import { GoldPostingService } from './gold-posting.service.js';
import { GoldService } from './gold.service.js';

// GoldDocumentsService is exported so Sales and Returns can post the gold effect of a
// document inside their own transaction, exactly as they do for finance and accounting.
@Module({ imports: [AuthModule, PermissionsModule, WarehousesModule, AuditModule, RealtimeModule], controllers: [GoldController], providers: [GoldService, GoldPostingService, GoldDocumentsService], exports: [GoldPostingService, GoldDocumentsService] })
export class GoldModule {}
