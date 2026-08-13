import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { RequestContextInterceptor } from './common/request-context.interceptor.js';
import { RequestContextService } from './common/request-context.service.js';
import { appConfig } from './config/app-config.js';

export async function createApp(): Promise<NestFastifyApplication> {
  const config = appConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: { level: config.isProduction ? 'info' : 'debug' }, trustProxy: config.trustProxy }));
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: config.isProduction ? undefined : false });
  await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: '1 minute' });
  app.getHttpAdapter().getInstance().addHook('onRequest', async (request: { id: string }, reply: { header: (name: string, value: string) => void }) => { reply.header('x-request-id', request.id); });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({ origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, validationError: { target: false, value: false } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new RequestContextInterceptor(app.get(RequestContextService)));
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() { const app = await createApp(); const config = appConfig(); await app.listen({ port: config.port, host: '0.0.0.0' }); }
if (process.env.NODE_ENV !== 'test') void bootstrap();
