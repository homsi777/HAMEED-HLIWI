import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';

@Module({ imports: [AuthModule, PermissionsModule], controllers: [HistoryController], providers: [HistoryService], exports: [HistoryService] })
export class HistoryModule {}
