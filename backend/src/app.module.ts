import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
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
@Module({ imports: [CommonModule, DatabaseModule, AuditModule, AuthModule, PermissionsModule, WarehousesModule, RealtimeModule, InventoryModule, PartnersModule, SalesModule, PurchasesModule, ReturnsModule, FinanceModule, AccountingModule, HealthModule] })
export class AppModule {}
