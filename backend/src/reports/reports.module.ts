import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { WarehousesModule } from '../warehouses/warehouses.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { CompanyReportsGuard } from './company-reports.guard.js';

@Module({ imports: [AuthModule, PermissionsModule, WarehousesModule], controllers: [ReportsController], providers: [ReportsService, CompanyReportsGuard] })
export class ReportsModule {}
