import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common'; import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js'; import { PermissionGuard } from '../permissions/permission.guard.js'; import { RequirePermissions } from '../permissions/require-permissions.decorator.js'; import { SalesService } from './sales.service.js';
@Controller('sales') @UseGuards(AuthGuard, PermissionGuard)
export class SalesController { constructor(@Inject(SalesService) private readonly sales: SalesService) {}
  @Get() @RequirePermissions('sales.view') list(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>) { return this.sales.list(req.identity!, query); }
  // TASK 17 §3: gated by `sales.create`, never by `inventory.view` — selling stock is not
  // managing it. Declared before `:id` so the literal path is not swallowed as an invoice id.
  @Get('available-items') @RequirePermissions('sales.create') availableItems(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>) { return this.sales.availableItems(req.identity!, query); }
  @Get(':id') @RequirePermissions('sales.view') get(@Req() req: FastifyRequest, @Param('id') id: string) { return this.sales.get(req.identity!, id); }
  @Post() @RequirePermissions('sales.create') create(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) { return this.sales.create(req.identity!, body); }
  @Post(':id/correct') @RequirePermissions('sales.update') async correct(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { const reason = typeof body.correctionReason === 'string' && body.correctionReason.trim() ? body.correctionReason.trim() : 'تصحيح فاتورة'; const original = await this.sales.cancel(req.identity!, id, { reason: `تصحيح: ${reason}` }); const replacement = await this.sales.create(req.identity!, { ...body, notes: [typeof body.notes === 'string' ? body.notes.trim() : '', `تصحيح للفاتورة ${original.invoiceNumber}: ${reason}`].filter(Boolean).join('\n') }); return { original, replacement }; }
  @Post(':id/cancel') @RequirePermissions('sales.cancel') cancel(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.sales.cancel(req.identity!, id, body); }
}
