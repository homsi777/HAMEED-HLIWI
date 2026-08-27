import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { EmployeesService } from './employees.service.js';

@Controller('employees') @UseGuards(AuthGuard, PermissionGuard)
export class EmployeesController {
  constructor(@Inject(EmployeesService) private readonly employees: EmployeesService) {}
  @Get('cashboxes') @RequirePermissions('employees.payroll') cashboxes(@Req() request: FastifyRequest) { return this.employees.cashboxes(request.identity!); }
  @Get() @RequirePermissions('employees.view') list(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.employees.list(request.identity!, query); }
  @Get(':id') @RequirePermissions('employees.view') get(@Req() request: FastifyRequest, @Param('id') id: string) { return this.employees.get(request.identity!, id); }
  @Post() @RequirePermissions('employees.manage') create(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.employees.create(request.identity!, body); }
  @Patch(':id') @RequirePermissions('employees.manage') update(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.employees.update(request.identity!, id, body); }
  @Post(':id/archive') @RequirePermissions('employees.manage') archive(@Req() request: FastifyRequest, @Param('id') id: string) { return this.employees.archive(request.identity!, id); }
  @Post(':id/terminate') @RequirePermissions('employees.manage') terminate(@Req() request: FastifyRequest, @Param('id') id: string) { return this.employees.terminate(request.identity!, id); }
  @Post(':id/transactions') @RequirePermissions('employees.payroll') transaction(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.employees.transaction(request.identity!, id, body); }
}
