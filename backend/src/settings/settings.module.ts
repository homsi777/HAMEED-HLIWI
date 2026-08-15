import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({ imports: [AuthModule, PermissionsModule, AuditModule, RealtimeModule], controllers: [SettingsController], providers: [SettingsService] })
export class SettingsModule {}
