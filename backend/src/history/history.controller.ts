import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { HistoryService } from './history.service.js';

/**
 * Read-only commercial history. Every endpoint is a query: browsing history has no financial,
 * accounting, gold or inventory side effect whatsoever.
 */
@Controller('history') @UseGuards(AuthGuard, PermissionGuard)
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get('invoices') @RequirePermissions('sales.view')
  invoices(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.history.invoices(request.identity!, query); }

  @Get('sold-weights') @RequirePermissions('sales.view')
  soldWeights(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.history.soldWeights(request.identity!, query); }

  @Get('sold-weights/summary') @RequirePermissions('sales.view')
  soldWeightSummary(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.history.soldWeightSummary(request.identity!, query); }

  @Get('filters') @RequirePermissions('sales.view')
  filters(@Req() request: FastifyRequest) { return this.history.filterOptions(request.identity!); }
}
