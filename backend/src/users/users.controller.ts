import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users') @UseGuards(AuthGuard, PermissionGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get() @RequirePermissions('users.view')
  list(@Req() request: FastifyRequest) { return this.users.list(request.identity!); }

  // Declared before `:userId` so the literal path is not captured as an id.
  @Get('catalog') @RequirePermissions('users.view')
  catalog(@Req() request: FastifyRequest) { return this.users.catalog(request.identity!); }

  @Get(':userId') @RequirePermissions('users.view')
  get(@Req() request: FastifyRequest, @Param('userId') userId: string) { return this.users.get(request.identity!, userId); }

  @Post() @RequirePermissions('users.manage')
  create(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.users.create(request.identity!, body); }

  @Patch(':userId') @RequirePermissions('users.manage')
  update(@Req() request: FastifyRequest, @Param('userId') userId: string, @Body() body: Record<string, unknown>) { return this.users.update(request.identity!, userId, body); }

  @Post(':userId/status') @RequirePermissions('users.manage')
  setStatus(@Req() request: FastifyRequest, @Param('userId') userId: string, @Body() body: Record<string, unknown>) { return this.users.setStatus(request.identity!, userId, body); }

  @Post(':userId/password') @RequirePermissions('users.manage')
  resetPassword(@Req() request: FastifyRequest, @Param('userId') userId: string, @Body() body: Record<string, unknown>) { return this.users.resetPassword(request.identity!, userId, body); }
}
