import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { WarehouseScopeService } from './warehouse-scope.service.js';

@Controller('warehouses') @UseGuards(AuthGuard, PermissionGuard)
export class WarehousesController {
  constructor(@Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService) {}
  @Get('scope') @RequirePermissions('warehouses.view')
  scopeForCurrentUser(@Req() request: FastifyRequest) { const user = request.identity!; return { allWarehouses: this.scope.canAccessAll(user), warehouses: user.warehouses }; }
  @Get(':warehouseId/access') @RequirePermissions('warehouses.view')
  checkAccess(@Req() request: FastifyRequest, @Param('warehouseId') warehouseId: string) { this.scope.assertAccess(request.identity!, warehouseId); return { warehouseId, allowed: true }; }
}
