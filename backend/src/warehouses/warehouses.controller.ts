import { Body, ConflictException, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';
import { userWarehouses, warehouses } from '../database/schema.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { WarehouseScopeService } from './warehouse-scope.service.js';

@Controller('warehouses') @UseGuards(AuthGuard, PermissionGuard)
export class WarehousesController {
  constructor(@Inject(WarehouseScopeService) private readonly scope: WarehouseScopeService, @Inject(DATABASE) private readonly db: Database) {}
  @Get() @RequirePermissions('warehouses.view')
  async list(@Req() request: FastifyRequest) { const user = request.identity!; const rows = await this.db.select().from(warehouses).where(this.scope.canAccessAll(user) ? undefined : inArray(warehouses.id, this.scope.allowedWarehouseIds(user) ?? [])); return rows; }
  @Post() @RequirePermissions('warehouses.manage')
  async create(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { const name = typeof body.name === 'string' ? body.name.trim() : ''; if (!name || name.length > 160) throw new ConflictException('Warehouse name is invalid.'); const managerUserId = typeof body.managerUserId === 'string' && body.managerUserId ? body.managerUserId : null; const created = (await this.db.insert(warehouses).values({ name, location: typeof body.location === 'string' ? body.location.trim().slice(0, 250) : null, phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 50) : null, managerUserId }).returning())[0]!; if (managerUserId) await this.db.insert(userWarehouses).values({ userId: managerUserId, warehouseId: created.id, isManager: true }).onConflictDoNothing(); return created; }
  @Patch(':warehouseId') @RequirePermissions('warehouses.manage')
  async update(@Req() request: FastifyRequest, @Param('warehouseId') warehouseId: string, @Body() body: Record<string, unknown>) { this.scope.assertAccess(request.identity!, warehouseId); const values = { name: typeof body.name === 'string' ? body.name.trim().slice(0, 160) : undefined, location: typeof body.location === 'string' ? body.location.trim().slice(0, 250) : undefined, phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 50) : undefined, isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined, managerUserId: typeof body.managerUserId === 'string' ? body.managerUserId || null : undefined, updatedAt: new Date() }; const row = (await this.db.update(warehouses).set(values).where(eq(warehouses.id, warehouseId)).returning())[0]; if (!row) throw new ConflictException('Warehouse not found.'); if (row.managerUserId) await this.db.insert(userWarehouses).values({ userId: row.managerUserId, warehouseId: row.id, isManager: true }).onConflictDoNothing(); return row; }
  @Get('scope') @RequirePermissions('warehouses.view')
  scopeForCurrentUser(@Req() request: FastifyRequest) { const user = request.identity!; return { allWarehouses: this.scope.canAccessAll(user), warehouses: user.warehouses }; }
  @Get(':warehouseId/access') @RequirePermissions('warehouses.view')
  checkAccess(@Req() request: FastifyRequest, @Param('warehouseId') warehouseId: string) { this.scope.assertAccess(request.identity!, warehouseId); return { warehouseId, allowed: true }; }
}
