import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { WarehousesModule } from '../warehouses/warehouses.module.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingDocumentsService } from './accounting-documents.service.js';
import { AccountingPostingService } from './accounting-posting.service.js';
import { AccountingService } from './accounting.service.js';
import { CompanyAccountingGuard } from './company-accounting.guard.js';

// The posting services are exported so Finance, Sales, Purchases and Returns can post
// their accounting effect inside their own transaction.
@Module({ imports: [AuthModule, PermissionsModule, WarehousesModule, AuditModule], controllers: [AccountingController], providers: [AccountingService, AccountingPostingService, AccountingDocumentsService, CompanyAccountingGuard], exports: [AccountingPostingService, AccountingDocumentsService] })
export class AccountingModule {}
