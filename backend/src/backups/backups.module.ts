import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';

@Module({ imports: [AuthModule, PermissionsModule, AuditModule], controllers: [BackupsController], providers: [BackupsService] })
export class BackupsModule {}
