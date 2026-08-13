import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehouseScopeService } from './warehouse-scope.service.js';
@Module({ imports: [AuthModule, PermissionsModule], controllers: [WarehousesController], providers: [WarehouseScopeService], exports: [WarehouseScopeService] })
export class WarehousesModule {}
