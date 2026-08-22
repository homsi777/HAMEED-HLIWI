import { ConflictException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

  async login(username: string, password: string, warehouseId: string, context: SessionContext): Promise<AuthSessionResult> {
    const user = await this.findUserByUsername(username);
    if (!user || !user.isActive) throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة.');
    const now = new Date();
    if (user.loginLockedUntil && user.loginLockedUntil > now) throw this.loginLocked(user.loginLockedUntil);
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const lockedUntil = await this.recordFailedPassword(user, now);
      if (lockedUntil) throw this.loginLocked(lockedUntil);
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة.');
    }
    if (user.failedLoginAttempts || user.loginLockedUntil) {
      await this.db.update(users).set({ failedLoginAttempts: 0, loginLockedUntil: null, updatedAt: now }).where(eq(users.id, user.id));
    }
    const identity = await this.getIdentity(user.id);
    if (!identity) throw new UnauthorizedException('User is unavailable.');
    const canAccessAll = identity.permissions.includes('warehouses.scope.all');
    if (warehouseId === 'system') {
      if (!canAccessAll) throw new UnauthorizedException('The selected warehouse is not assigned to this user.');
    } else if (!canAccessAll && !identity.warehouses.some(warehouse => warehouse.id === warehouseId)) {
      throw new UnauthorizedException('The selected warehouse is not assigned to this user.');
    } else if (canAccessAll) {
      const warehouse = await this.db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.isActive, true))).limit(1);
      if (!warehouse[0]) throw new UnauthorizedException('The selected warehouse is unavailable.');
    }
    // A browser that was closed or lost its network cannot send a logout request. It stops
    // sending the heartbeat, so it releases the account after a short grace period.
    const activeSessionCutoff = new Date(now.getTime() - 90 * 1000);
    const activeSession = (await this.db.select({ id: authSessions.id }).from(authSessions)
      .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now), gt(authSessions.lastUsedAt, activeSessionCutoff))).limit(1))[0];
    if (activeSession) throw new ConflictException('هذا الحساب قيد التشغيل بالفعل على جهاز آخر. سجّل الخروج من الجهاز الأول ثم حاول مجدداً.');
    await this.db.update(authSessions).set({ revokedAt: now, revokedReason: 'inactive_session_replaced' })
      .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)));
    return this.createSession(identity, context);
  }

  async loginWarehouses() {
    return this.db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.isActive, true)).orderBy(warehouses.name);
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

  async heartbeat(identity: AuthIdentity) {
    if (!identity.sessionId) throw new UnauthorizedException('Session identity is required.');
    await this.db.update(authSessions).set({ lastUsedAt: new Date() })
      .where(and(eq(authSessions.id, identity.sessionId), eq(authSessions.userId, identity.id), isNull(authSessions.revokedAt)));
    return { success: true };
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

  private async findUserByUsername(username: string) {
    const normalized = username.trim().replace(/\s+/g, ' ').toLowerCase();
    const rows = await this.db.select().from(users).where(sql`lower(${users.username}) = ${normalized}`).limit(1);
    return rows[0];
  }

  private async recordFailedPassword(user: typeof users.$inferSelect, now: Date): Promise<Date | null> {
    const attempts = user.failedLoginAttempts + 1;
    if (attempts < 3) {
      await this.db.update(users).set({ failedLoginAttempts: attempts, updatedAt: now }).where(eq(users.id, user.id));
      return null;
    }
    const lockedUntil = new Date(now.getTime() + 5 * 60 * 1000);
    await this.db.update(users).set({ failedLoginAttempts: 0, loginLockedUntil: lockedUntil, updatedAt: now }).where(eq(users.id, user.id));
    return lockedUntil;
  }

  private loginLocked(lockedUntil: Date) {
    const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
    return new HttpException({ message: 'تم حظر تسجيل الدخول مؤقتاً بعد 3 محاولات خاطئة. حاول مجدداً بعد انتهاء العدّاد.', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }

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
