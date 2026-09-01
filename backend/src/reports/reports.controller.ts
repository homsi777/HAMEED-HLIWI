import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { ReportsService } from './reports.service.js';
import { CompanyReportsGuard } from './company-reports.guard.js';

// `PermissionGuard` sits beside `AuthGuard` deliberately: without it `@RequirePermissions` is
// decorative and silently does nothing, which is how TASK 18 briefly let a seller change the
// shop's exchange rate. Every report here is manager-facing and must stay behind the guard.
@Controller('reports')
@UseGuards(AuthGuard, PermissionGuard, CompanyReportsGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('overview') @RequirePermissions('reports.view')
  overview(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.overview(request.identity!, query); }

  @Get('sales') @RequirePermissions('reports.view')
  sales(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.sales(request.identity!, query); }

  @Get('sales-by-customer') @RequirePermissions('reports.view')
  salesByCustomer(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.salesByCustomer(request.identity!, query); }

  @Get('purchases') @RequirePermissions('reports.view')
  purchases(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.purchases(request.identity!, query); }

  // Workmanship revenue, under its own name. It is not profit and the payload says so.
  @Get('workmanship') @RequirePermissions('reports.view')
  workmanship(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.workmanship(request.identity!, query); }

  @Get('inventory') @RequirePermissions('reports.view')
  inventory(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.inventory(request.identity!, query); }

  @Get('receivables') @RequirePermissions('reports.view')
  receivables(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.receivables(request.identity!, query); }

  @Get('cash') @RequirePermissions('reports.view')
  cash(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.cash(request.identity!, query); }

  @Get('gold') @RequirePermissions('reports.view')
  gold(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.gold(request.identity!, query); }

  @Get('activity') @RequirePermissions('reports.view')
  activity(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.activity(request.identity!, query); }

  // A real daily series, because the dashboard used to draw invented numbers.
  @Get('sales-timeline') @RequirePermissions('reports.view')
  salesTimeline(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.salesTimeline(request.identity!, query); }

  @Get('shifts') @RequirePermissions('reports.view')
  shifts(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.reports.shifts(request.identity!, query); }
}
