import { BadRequestException, Body, Controller, Get, Inject, Post, Req, Res, UnauthorizedException, UseGuards, ValidationPipe } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { appConfig } from '../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationScopeService } from '../authorization/authorization-scope.service.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(AuditService) private readonly audit: AuditService, @Inject(AuthorizationScopeService) private readonly authorization: AuthorizationScopeService) {}
  @Post('login')
  async login(@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, validationError: { target: false, value: false } })) body: LoginDto, @Req() request: FastifyRequest, @Res({ passthrough: true }) response: FastifyReply) {
    this.validateLoginBody(body);
    const result = await this.auth.login(body.username, body.password, body.warehouseId, this.sessionContext(request));
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    const { identity, session } = result;
    await this.audit.record({ actorUserId: identity.id, action: 'auth.login', module: 'auth', entityId: identity.id, metadata: { selectedWarehouseId: body.warehouseId } });
    return { user: identity, scope: this.authorization.resolve(identity), session };
  }
  @Post('refresh')
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) response: FastifyReply) {
    const refreshToken = request.cookies?.hh_refresh;
    if (!refreshToken) throw new UnauthorizedException('Refresh session is required.');
    const result = await this.auth.refresh(refreshToken, this.sessionContext(request));
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    await this.audit.record({ actorUserId: result.identity.id, action: 'auth.session.refresh', module: 'auth', entityId: result.identity.id, metadata: { sessionId: result.session.id } });
    return { user: result.identity, session: result.session };
  }
  @Post('logout') @UseGuards(AuthGuard)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) response: FastifyReply) {
    await this.auth.logoutCurrentSession(request.identity!);
    this.clearSessionCookies(response);
    await this.audit.record({ actorUserId: request.identity!.id, action: 'auth.logout', module: 'auth', entityId: request.identity!.id });
    return { success: true };
  }
  @Post('logout-all') @UseGuards(AuthGuard)
  async logoutAll(@Req() request: FastifyRequest, @Res({ passthrough: true }) response: FastifyReply) {
    await this.auth.revokeAllSessions(request.identity!.id);
    this.clearSessionCookies(response);
    await this.audit.record({ actorUserId: request.identity!.id, action: 'auth.logout_all', module: 'auth', entityId: request.identity!.id });
    return { success: true };
  }
  @Get('me') @UseGuards(AuthGuard)
  // The single source of truth for who the browser is talking as, and what that identity may
  // reach. The frontend derives its navigation from this payload rather than from local state.
  me(@Req() request: FastifyRequest) { const identity = request.identity!; const { sessionId, sessionExpiresAt, ...user } = identity; return { user, scope: this.authorization.resolve(identity), session: { id: sessionId, expiresAt: sessionExpiresAt } }; }
  @Get('login-warehouses') loginWarehouses() { return this.auth.loginWarehouses(); }

  private setSessionCookies(response: FastifyReply, accessToken: string, refreshToken: string) {
    const config = appConfig();
    const common = { httpOnly: true, sameSite: 'strict' as const, secure: config.cookieSecure };
    // No Max-Age/Expires: closing the browser ends the session on shared phones.
    response.setCookie('hh_access', accessToken, { ...common, path: '/' });
    response.setCookie('hh_refresh', refreshToken, { ...common, path: '/api/v1/auth' });
  }

  private clearSessionCookies(response: FastifyReply) {
    const config = appConfig();
    response.clearCookie('hh_access', { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' });
    response.clearCookie('hh_refresh', { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/api/v1/auth' });
  }

  private sessionContext(request: FastifyRequest) {
    const userAgent = request.headers['user-agent'];
    return { userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent, ipAddress: request.ip };
  }

  private validateLoginBody(body: LoginDto) {
    const unexpected = Object.keys(body).filter(key => key !== 'username' && key !== 'password' && key !== 'warehouseId');
    if (unexpected.length || typeof body.username !== 'string' || !/^[\p{L}\p{M}\p{N}_.-]{3,80}$/u.test(body.username) || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200 || typeof body.warehouseId !== 'string' || !/^(system|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(body.warehouseId)) {
      throw new BadRequestException('Invalid login request.');
    }
  }
}
