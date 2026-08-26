import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { WarehousesModule } from './warehouses/warehouses.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PartnersModule } from './partners/partners.module.js';
import { SalesModule } from './sales/sales.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { GoldModule } from './gold/gold.module.js';
import { UsersModule } from './users/users.module.js';
import { ShiftsModule } from './shifts/shifts.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { BackupsModule } from './backups/backups.module.js';
import { HistoryModule } from './history/history.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { EmployeesModule } from './employees/employees.module.js';
@Module({ imports: [CommonModule, DatabaseModule, AuditModule, AuthModule, AuthorizationModule, UsersModule, PermissionsModule, WarehousesModule, RealtimeModule, InventoryModule, PartnersModule, SalesModule, PurchasesModule, ReturnsModule, FinanceModule, AccountingModule, GoldModule, ShiftsModule, EmployeesModule, SettingsModule, ReportsModule, BackupsModule, HistoryModule, NotificationsModule, HealthModule] })
export class AppModule {}
