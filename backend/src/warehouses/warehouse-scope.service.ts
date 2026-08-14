import { Inject, Injectable } from '@nestjs/common';
import type { AuthIdentity } from '../auth/auth.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';

/**
 * Warehouse-facing view of the central scope model. It delegates every decision to
 * {@link AuthorizationScopeService} so the many services already injecting this class keep
 * working while there remains exactly one implementation of the rules.
 */
@Injectable()
export class WarehouseScopeService {
  constructor(@Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService) {}
  canAccessAll(identity: AuthIdentity) { return this.authorization.canAccessAll(identity); }
  allowedWarehouseIds(identity: AuthIdentity) { return this.authorization.allowedWarehouseIds(identity); }
  assertAccess(identity: AuthIdentity, warehouseId: string) { this.authorization.assertWarehouse(identity, warehouseId); }
}
