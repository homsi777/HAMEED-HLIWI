import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';

/** The chart of accounts and general ledger are company books, never branch data. */
@Injectable()
export class CompanyAccountingGuard implements CanActivate {
  constructor(private readonly scope: WarehouseScopeService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!this.scope.canAccessAll(request.identity!)) {
      throw new ForbiddenException('Company accounting is available only to company-wide accounts.');
    }
    return true;
  }
}
