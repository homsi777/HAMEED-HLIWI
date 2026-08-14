import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';

@Module({ imports: [AuthModule, PermissionsModule, AuditModule, RealtimeModule, AccountingModule], controllers: [PartnersController], providers: [PartnersService] })
export class PartnersModule {}
