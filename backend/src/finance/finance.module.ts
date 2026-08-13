import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { WarehousesModule } from '../warehouses/warehouses.module.js';
import { FinanceController } from './finance.controller.js';
import { FinancePostingService } from './finance-posting.service.js';
import { FinanceService } from './finance.service.js';

// FinancePostingService is exported so Sales, Purchases and Returns can post their
// financial effect inside their own transaction without depending on the HTTP layer.
@Module({ imports: [AuthModule, PermissionsModule, WarehousesModule, AuditModule, RealtimeModule], controllers: [FinanceController], providers: [FinanceService, FinancePostingService], exports: [FinancePostingService] })
export class FinanceModule {}
