import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AuthIdentity } from '../auth/auth.service.js';
import { GLOBAL_SCOPE_PERMISSION, OWN_SCOPE_PERMISSION, visibleModules, type DataScope } from './authorization.constants.js';

export interface ResolvedScope {
  type: DataScope;
  allWarehouses: boolean;
  ownDataOnly: boolean;
  warehouses: AuthIdentity['warehouses'];
  warehouseIds: string[];
  managedWarehouseIds: string[];
  modules: string[];
}

/**
 * The one authority on "what may this identity reach".
 *
 * Controllers and services ask this service instead of testing role names, so a scope
 * decision is made in exactly one place and cannot drift between endpoints.
 */
@Injectable()
export class AuthorizationScopeService {
  /** Company-wide access. Needs no `user_warehouses` rows and covers warehouses created later. */
  canAccessAll(identity: AuthIdentity) { return identity.permissions.includes(GLOBAL_SCOPE_PERMISSION); }

  /** Restricted to documents the user created. Global scope always wins over this restriction. */
  isOwnDataOnly(identity: AuthIdentity) { return !this.canAccessAll(identity) && identity.permissions.includes(OWN_SCOPE_PERMISSION); }

  scopeType(identity: AuthIdentity): DataScope {
    if (this.canAccessAll(identity)) return 'global';
    return this.isOwnDataOnly(identity) ? 'own' : 'warehouses';
  }

  /** `null` means "no warehouse restriction"; an array is the exhaustive allow-list. */
  allowedWarehouseIds(identity: AuthIdentity) { return this.canAccessAll(identity) ? null : identity.warehouses.map(warehouse => warehouse.id); }

  managedWarehouseIds(identity: AuthIdentity) { return identity.warehouses.filter(warehouse => warehouse.isManager).map(warehouse => warehouse.id); }

  assertWarehouse(identity: AuthIdentity, warehouseId: string) {
    if (!this.canAccessAll(identity) && !identity.warehouses.some(warehouse => warehouse.id === warehouseId)) throw new ForbiddenException('Warehouse scope denied.');
  }

  /**
   * The list-query half of ownership isolation. Returns a predicate for own-scope users and
   * `undefined` for everyone else, so callers append it unconditionally.
   */
  ownerCondition(identity: AuthIdentity, ownerColumn: PgColumn): SQL | undefined {
    return this.isOwnDataOnly(identity) ? eq(ownerColumn, identity.id) : undefined;
  }

  /**
   * The direct-object half. Every path that exposes a document — read, print, cancel,
   * return — calls this so a guessed id is refused exactly like a hidden list row.
   */
  assertDocumentOwner(identity: AuthIdentity, ownerUserId: string | null | undefined) {
    if (this.isOwnDataOnly(identity) && ownerUserId !== identity.id) throw new ForbiddenException('This document belongs to another user.');
  }

  /** Guards the whole document in one call: warehouse first, then ownership. */
  assertDocumentAccess(identity: AuthIdentity, document: { warehouseId: string; createdByUserId?: string | null }) {
    this.assertWarehouse(identity, document.warehouseId);
    this.assertDocumentOwner(identity, document.createdByUserId);
  }

  /**
   * User administration boundary. A global manager administers everyone. A warehouse manager
   * administers only users confined to warehouses they manage, and can never reach a
   * globally-scoped account. An own-scope user administers nobody.
   */
  assertCanManageUser(actor: AuthIdentity, target: { isGlobal: boolean; warehouseIds: string[] }) {
    if (this.canAccessAll(actor)) return;
    if (this.isOwnDataOnly(actor)) throw new ForbiddenException('User administration is not permitted for this account.');
    if (target.isGlobal) throw new ForbiddenException('A company-wide account can only be administered by a global manager.');
    const allowed = new Set(this.allowedWarehouseIds(actor) ?? []);
    if (!target.warehouseIds.length || !target.warehouseIds.every(id => allowed.has(id))) throw new ForbiddenException('This user belongs to a warehouse outside your scope.');
  }

  resolve(identity: AuthIdentity): ResolvedScope {
    return {
      type: this.scopeType(identity),
      allWarehouses: this.canAccessAll(identity),
      ownDataOnly: this.isOwnDataOnly(identity),
      warehouses: identity.warehouses,
      warehouseIds: identity.warehouses.map(warehouse => warehouse.id),
      managedWarehouseIds: this.managedWarehouseIds(identity),
      modules: visibleModules(identity.permissions).filter(module => this.canAccessAll(identity) || module !== 'accounting'),
    };
  }
}
