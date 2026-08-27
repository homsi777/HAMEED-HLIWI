import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

@Module({ imports: [AuthModule, PermissionsModule, AuditModule, FinanceModule], controllers: [EmployeesController], providers: [EmployeesService] })
export class EmployeesModule {}
