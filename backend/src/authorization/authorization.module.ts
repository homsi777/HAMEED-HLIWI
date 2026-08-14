import { Global, Module } from '@nestjs/common';
import { AuthorizationScopeService } from './authorization-scope.service.js';

@Global()
@Module({ providers: [AuthorizationScopeService], exports: [AuthorizationScopeService] })
export class AuthorizationModule {}
