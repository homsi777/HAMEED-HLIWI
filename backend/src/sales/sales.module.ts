import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js'; import { AuthModule } from '../auth/auth.module.js'; import { PermissionsModule } from '../permissions/permissions.module.js'; import { RealtimeModule } from '../realtime/realtime.module.js'; import { WarehousesModule } from '../warehouses/warehouses.module.js'; import { FinanceModule } from '../finance/finance.module.js';
import { SalesController } from './sales.controller.js'; import { SalesService } from './sales.service.js';
@Module({ imports: [AuthModule, PermissionsModule, WarehousesModule, AuditModule, RealtimeModule, FinanceModule], controllers: [SalesController], providers: [SalesService] })
export class SalesModule {}
