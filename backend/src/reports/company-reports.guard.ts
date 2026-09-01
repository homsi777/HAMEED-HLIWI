import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { WarehouseScopeService } from '../warehouses/warehouse-scope.service.js';

/** Company reports may not be exposed to a branch account. */
@Injectable()
export class CompanyReportsGuard implements CanActivate {
  constructor(private readonly scope: WarehouseScopeService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!this.scope.canAccessAll(request.identity!)) throw new ForbiddenException('Company reports are available only to company-wide accounts.');
    return true;
  }
}
