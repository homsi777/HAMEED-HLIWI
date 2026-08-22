import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get('public-key') key() { return { publicKey: this.notifications.publicKey() }; }
  @Post('subscribe') subscribe(@Req() request: FastifyRequest, @Body() input: any) { return this.notifications.subscribe(request.identity!, input, request.headers['user-agent']); }
  @Delete('subscribe') unsubscribe(@Req() request: FastifyRequest, @Body() input: any) { return this.notifications.unsubscribe(request.identity!, input?.endpoint).then(() => ({ enabled: false })); }
}
