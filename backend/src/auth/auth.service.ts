import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { appConfig } from '../config/app-config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { authSessions, permissions, rolePermissions, roles, userRoles, userWarehouses, users, warehouses } from '../database/schema.js';

export interface AuthIdentity {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  sessionVersion: number;
  sessionId?: string;
  sessionExpiresAt?: Date;
  roles: string[];
  permissions: string[];
  warehouses: Array<{ id: string; name: string; isManager: boolean }>;
}

interface JwtPayload { sub: string; sid: string; sv: number; username: string; type: 'access'; }
export interface SessionContext { userAgent?: string; ipAddress?: string; }
export interface AuthSessionResult { identity: AuthIdentity; accessToken: string; refreshToken: string; session: { id: string; expiresAt: Date }; }

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(JwtService) private readonly jwt: JwtService) {}

  async login(username: string, password: string, context: SessionContext): Promise<AuthSessionResult> {
    const user = await this.findUserByUsername(username);
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Invalid username or password.');
    const identity = await this.getIdentity(user.id);
    if (!identity) throw new UnauthorizedException('User is unavailable.');
    return this.createSession(identity, context);
  }

  async refresh(refreshToken: string, context: SessionContext): Promise<AuthSessionResult> {
    const now = new Date();
    const tokenHash = this.hashRefreshToken(refreshToken);
    const sessionRows = await this.db.select().from(authSessions)
      .where(and(eq(authSessions.refreshTokenHash, tokenHash), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now))).limit(1);
    const session = sessionRows[0];
    if (!session) throw new UnauthorizedException('Refresh session is invalid or expired.');
    const identity = await this.getIdentity(session.userId);
    if (!identity || !identity.isActive) throw new UnauthorizedException('User is unavailable.');
    const nextRefreshToken = this.createRefreshToken();
    const rotated = await this.db.update(authSessions).set({
      refreshTokenHash: this.hashRefreshToken(nextRefreshToken),
      lastUsedAt: now,
      userAgent: context.userAgent ?? session.userAgent,
      ipAddress: context.ipAddress ?? session.ipAddress,
    }).where(and(eq(authSessions.id, session.id), eq(authSessions.refreshTokenHash, tokenHash), isNull(authSessions.revokedAt))).returning({ id: authSessions.id, expiresAt: authSessions.expiresAt });
    if (!rotated[0]) throw new UnauthorizedException('Refresh session is no longer valid.');
    return { identity, accessToken: await this.sign(identity, session.id), refreshToken: nextRefreshToken, session: rotated[0] };
  }

  async sign(identity: AuthIdentity, sessionId: string) {
    return this.jwt.signAsync({ sub: identity.id, sid: sessionId, sv: identity.sessionVersion, username: identity.username, type: 'access' } satisfies JwtPayload);
  }

  async logoutCurrentSession(identity: AuthIdentity) {
    if (!identity.sessionId) throw new UnauthorizedException('Session identity is required.');
    await this.db.update(authSessions).set({ revokedAt: new Date(), revokedReason: 'logout_current' })
      .where(and(eq(authSessions.id, identity.sessionId), eq(authSessions.userId, identity.id), isNull(authSessions.revokedAt)));
  }

  async revokeAllSessions(userId: string) {
    const now = new Date();
    await this.db.transaction(async transaction => {
      await transaction.update(authSessions).set({ revokedAt: now, revokedReason: 'logout_all' }).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
      await transaction.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now }).where(eq(users.id, userId));
    });
  }

  async authenticateToken(token: string): Promise<AuthIdentity> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (payload.type !== 'access' || !payload.sid) throw new UnauthorizedException('Invalid access token.');
      const identity = await this.getIdentity(payload.sub);
      if (!identity || !identity.isActive || identity.sessionVersion !== payload.sv) throw new UnauthorizedException('Session is no longer valid.');
      const session = await this.db.select({ id: authSessions.id, expiresAt: authSessions.expiresAt }).from(authSessions)
        .where(and(eq(authSessions.id, payload.sid), eq(authSessions.userId, identity.id), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date()))).limit(1);
      if (!session[0]) throw new UnauthorizedException('Session is no longer valid.');
      return { ...identity, sessionId: session[0].id, sessionExpiresAt: session[0].expiresAt };
    } catch { throw new UnauthorizedException('Authentication is required.'); }
  }

  async getIdentity(userId: string): Promise<AuthIdentity | null> {
    const user = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user[0]) return null;
    const roleRows = await this.db.select({ name: roles.name }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(eq(userRoles.userId, userId));
    const permissionRows = await this.db.select({ code: permissions.code }).from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id)).where(eq(userRoles.userId, userId));
    const warehouseRows = await this.db.select({ id: warehouses.id, name: warehouses.name, isManager: userWarehouses.isManager }).from(userWarehouses)
      .innerJoin(warehouses, eq(userWarehouses.warehouseId, warehouses.id))
      .where(and(eq(userWarehouses.userId, userId), eq(warehouses.isActive, true)));
    return { id: user[0].id, username: user[0].username, fullName: user[0].fullName, isActive: user[0].isActive, sessionVersion: user[0].sessionVersion,
      roles: [...new Set(roleRows.map(value => value.name))], permissions: [...new Set(permissionRows.map(value => value.code))], warehouses: warehouseRows };
  }

  private async findUserByUsername(username: string) { const rows = await this.db.select().from(users).where(eq(users.username, username)).limit(1); return rows[0]; }

  private async createSession(identity: AuthIdentity, context: SessionContext): Promise<AuthSessionResult> {
    const refreshToken = this.createRefreshToken();
    const expiresAt = new Date(Date.now() + appConfig().refreshSessionDays * 24 * 60 * 60 * 1000);
    const sessionRows = await this.db.insert(authSessions).values({
      userId: identity.id,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt,
    }).returning({ id: authSessions.id, expiresAt: authSessions.expiresAt });
    const session = sessionRows[0]!;
    return { identity, accessToken: await this.sign(identity, session.id), refreshToken, session };
  }

  private createRefreshToken() { return randomBytes(48).toString('base64url'); }
  private hashRefreshToken(token: string) { return createHmac('sha256', appConfig().sessionTokenPepper).update(token).digest('hex'); }
}
