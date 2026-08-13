import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS_KEY } from './require-permissions.decorator.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (!required.length) return true;
    const identity = context.switchToHttp().getRequest<FastifyRequest>().identity;
    if (!identity || !required.every(permission => identity.permissions.includes(permission))) throw new ForbiddenException('Permission denied.');
    return true;
  }
}
