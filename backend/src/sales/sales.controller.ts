import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common'; import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js'; import { PermissionGuard } from '../permissions/permission.guard.js'; import { RequirePermissions } from '../permissions/require-permissions.decorator.js'; import { SalesService } from './sales.service.js';
@Controller('sales') @UseGuards(AuthGuard, PermissionGuard)
export class SalesController { constructor(@Inject(SalesService) private readonly sales: SalesService) {}
  @Get() @RequirePermissions('sales.view') list(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>) { return this.sales.list(req.identity!, query); }
  @Get(':id') @RequirePermissions('sales.view') get(@Req() req: FastifyRequest, @Param('id') id: string) { return this.sales.get(req.identity!, id); }
  @Post() @RequirePermissions('sales.create') create(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) { return this.sales.create(req.identity!, body); }
  @Post(':id/cancel') @RequirePermissions('sales.cancel') cancel(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.sales.cancel(req.identity!, id, body); }
}
