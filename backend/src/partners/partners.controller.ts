import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PartnersService } from './partners.service.js';

@Controller('partners')
@UseGuards(AuthGuard)
export class PartnersController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

  @Get() list(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.partners.list(request.identity!, query); }
  @Get(':id') get(@Req() request: FastifyRequest, @Param('id') id: string, @Query('includeArchived') includeArchived?: string) { return this.partners.get(request.identity!, id, includeArchived === 'true'); }
  // TASK 17 §31: one request behind a tap on a customer card.
  @Get(':id/workspace') workspace(@Req() request: FastifyRequest, @Param('id') id: string) { return this.partners.workspace(request.identity!, id); }
  @Post() create(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.partners.create(request.identity!, body); }
  @Patch(':id') update(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.partners.update(request.identity!, id, body); }
  @Delete(':id') archive(@Req() request: FastifyRequest, @Param('id') id: string, @Body('version') version: number) { return this.partners.archive(request.identity!, id, Number(version)); }
  @Post(':id/reactivate') reactivate(@Req() request: FastifyRequest, @Param('id') id: string, @Body('version') version: number) { return this.partners.reactivate(request.identity!, id, Number(version)); }
}
