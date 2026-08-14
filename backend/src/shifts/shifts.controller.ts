import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { ShiftsService } from './shifts.service.js';

@Controller('shifts') @UseGuards(AuthGuard, PermissionGuard)
export class ShiftsController {
  constructor(@Inject(ShiftsService) private readonly shifts: ShiftsService) {}

  @Get() @RequirePermissions('shifts.view')
  list(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.shifts.list(request.identity!, query); }

  // Declared before `:shiftId` so the literal path is not captured as an id.
  @Get('current') @RequirePermissions('shifts.view')
  current(@Req() request: FastifyRequest) { return this.shifts.current(request.identity!); }

  @Get(':shiftId') @RequirePermissions('shifts.view')
  detail(@Req() request: FastifyRequest, @Param('shiftId') shiftId: string) { return this.shifts.detail(request.identity!, shiftId); }

  @Post() @RequirePermissions('shifts.open')
  open(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.shifts.open(request.identity!, body); }

  @Post(':shiftId/closing-request') @RequirePermissions('shifts.close.request')
  requestClose(@Req() request: FastifyRequest, @Param('shiftId') shiftId: string, @Body() body: Record<string, unknown>) { return this.shifts.requestClose(request.identity!, shiftId, body); }

  @Post(':shiftId/approve') @RequirePermissions('shifts.approve')
  approve(@Req() request: FastifyRequest, @Param('shiftId') shiftId: string, @Body() body: Record<string, unknown>) { return this.shifts.approveClose(request.identity!, shiftId, body); }

  @Post(':shiftId/reject') @RequirePermissions('shifts.approve')
  reject(@Req() request: FastifyRequest, @Param('shiftId') shiftId: string, @Body() body: Record<string, unknown>) { return this.shifts.rejectClose(request.identity!, shiftId, body); }
}
