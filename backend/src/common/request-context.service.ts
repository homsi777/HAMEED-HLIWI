import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthIdentity } from '../auth/auth.service.js';

export interface RequestContext { requestId: string; identity?: AuthIdentity; }

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();
  run<T>(context: RequestContext, callback: () => T): T { return this.storage.run(context, callback); }
  get(): RequestContext | undefined { return this.storage.getStore(); }
  setIdentity(identity: AuthIdentity) { const current = this.storage.getStore(); if (current) current.identity = identity; }
}
