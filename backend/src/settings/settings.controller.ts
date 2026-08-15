import { Body, Controller, Get, Inject, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { SettingsService } from './settings.service.js';

// `PermissionGuard` must sit here beside `AuthGuard`. Without it `@RequirePermissions` is
// decorative and silently does nothing — which is how a seller briefly gained the ability to
// change the shop's exchange rate while this was being written.
@Controller('settings')
@UseGuards(AuthGuard, PermissionGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  // TASK 18 §14: reading carries no permission requirement beyond being signed in. A seller
  // cannot price a sale without the gold price, so this is a read every session performs.
  @Get() get() { return this.settings.get(); }

  // §15/§16: changing the shop's configuration is a commercial act, enforced here rather than by
  // hiding a screen.
  @Patch() @RequirePermissions('settings.manage')
  update(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.settings.update(request.identity!, body); }

  @Put('gold-prices') @RequirePermissions('settings.manage')
  updateGoldPrices(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.settings.updateGoldPrices(request.identity!, body); }

  @Get('history') @RequirePermissions('settings.manage')
  history(@Query() query: Record<string, unknown>) { return this.settings.history(query); }
}
