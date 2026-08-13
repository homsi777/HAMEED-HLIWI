import { Module } from '@nestjs/common';
import { PermissionGuard } from './permission.guard.js';
@Module({ providers: [PermissionGuard], exports: [PermissionGuard] })
export class PermissionsModule {}
