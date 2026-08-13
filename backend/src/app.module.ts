import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { WarehousesModule } from './warehouses/warehouses.module.js';
@Module({ imports: [CommonModule, DatabaseModule, AuditModule, AuthModule, PermissionsModule, WarehousesModule, RealtimeModule, HealthModule] })
export class AppModule {}
