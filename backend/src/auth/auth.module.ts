import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { appConfig } from '../config/app-config.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Module({ imports: [JwtModule.register({ secret: appConfig().jwtSecret, signOptions: { expiresIn: appConfig().jwtExpiresIn as any } }), AuditModule], controllers: [AuthController], providers: [AuthService, AuthGuard], exports: [AuthService, AuthGuard, JwtModule] })
export class AuthModule {}
