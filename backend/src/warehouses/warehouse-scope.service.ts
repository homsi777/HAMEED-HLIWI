import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthIdentity } from '../auth/auth.service.js';

@Injectable()
export class WarehouseScopeService {
  canAccessAll(identity: AuthIdentity) { return identity.permissions.includes('warehouses.scope.all'); }
  allowedWarehouseIds(identity: AuthIdentity) { return this.canAccessAll(identity) ? null : identity.warehouses.map(warehouse => warehouse.id); }
  assertAccess(identity: AuthIdentity, warehouseId: string) {
    if (!this.canAccessAll(identity) && !identity.warehouses.some(warehouse => warehouse.id === warehouseId)) throw new ForbiddenException('Warehouse scope denied.');
  }
}
