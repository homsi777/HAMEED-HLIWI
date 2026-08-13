import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js'; import { PermissionGuard } from '../permissions/permission.guard.js'; import { RequirePermissions } from '../permissions/require-permissions.decorator.js'; import { InventoryService } from './inventory.service.js';
@Controller('inventory') @UseGuards(AuthGuard, PermissionGuard)
export class InventoryController { constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}
  @Get() @RequirePermissions('inventory.view') list(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>) { return this.inventory.list(req.identity!, query); }
  @Get('stocktakes') @RequirePermissions('inventory.view') stocktakes(@Req() req: FastifyRequest, @Query('warehouseId') warehouseId?: string) { return this.inventory.stocktakesFor(req.identity!, warehouseId); }
  @Post('stocktakes/:warehouseId') @RequirePermissions('inventory.adjust') stocktake(@Req() req: FastifyRequest, @Param('warehouseId') warehouseId: string) { return this.inventory.stocktake(req.identity!, warehouseId); }
  @Get(':id') @RequirePermissions('inventory.view') get(@Req() req: FastifyRequest, @Param('id') id: string) { return this.inventory.get(req.identity!, id); }
  @Post() @RequirePermissions('inventory.create') create(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) { return this.inventory.create(req.identity!, body); }
  @Patch(':id') @RequirePermissions('inventory.update') update(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.inventory.update(req.identity!, id, body); }
  @Delete(':id') @RequirePermissions('inventory.delete') archive(@Req() req: FastifyRequest, @Param('id') id: string, @Body('version') version: number) { return this.inventory.archive(req.identity!, id, Number(version)); }
  @Post(':id/transfer') @RequirePermissions('inventory.transfer') transfer(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.inventory.transfer(req.identity!, id, body); }
  @Get(':id/movements') @RequirePermissions('inventory.view') movements(@Req() req: FastifyRequest, @Param('id') id: string) { return this.inventory.movements(req.identity!, id); }
}
