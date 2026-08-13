import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context.service.js';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestContextService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ id?: string }>();
    return new Observable(subscriber => this.context.run({ requestId: request.id ?? crypto.randomUUID() }, () => next.handle().subscribe(subscriber)));
  }
}
