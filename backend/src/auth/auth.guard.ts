import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService, type AuthIdentity } from './auth.service.js';
import { RequestContextService } from '../common/request-context.service.js';

declare module 'fastify' { interface FastifyRequest { identity?: AuthIdentity; } }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(RequestContextService) private readonly context: RequestContextService) {}
  async canActivate(executionContext: ExecutionContext) {
    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = bearer ?? request.cookies?.hh_access;
    if (!token) throw new UnauthorizedException('Authentication is required.');
    const identity = await this.auth.authenticateToken(token);
    request.identity = identity;
    this.context.setIdentity(identity);
    return true;
  }
}
