import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { GoldService } from './gold.service.js';

@Controller('gold') @UseGuards(AuthGuard, PermissionGuard)
export class GoldController {
  constructor(@Inject(GoldService) private readonly gold: GoldService) {}

  @Get('karats') @RequirePermissions('gold_accounts.view') karats() { return this.gold.karats(); }
  @Get('accounts') @RequirePermissions('gold_accounts.view') listAccounts(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.gold.listAccounts(request.identity!, query); }
  @Get('holdings') @RequirePermissions('gold_accounts.view') holdings(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.gold.holdings(request.identity!, query); }
  @Get('partners') @RequirePermissions('gold_accounts.view') partnerBalances(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.gold.partnerBalances(request.identity!, query); }
  @Get('partners/:id') @RequirePermissions('gold_accounts.view') partnerBalance(@Req() request: FastifyRequest, @Param('id') id: string) { return this.gold.partnerBalance(request.identity!, id); }
  @Get('partners/:id/statement') @RequirePermissions('gold_accounts.view') statement(@Req() request: FastifyRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) { return this.gold.partnerStatement(request.identity!, id, query); }

  @Get('transactions') @RequirePermissions('gold_accounts.view') listTransactions(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.gold.listTransactions(request.identity!, query); }
  @Get('transactions/:id') @RequirePermissions('gold_accounts.view') getTransaction(@Req() request: FastifyRequest, @Param('id') id: string) { return this.gold.getTransaction(request.identity!, id); }

  @Post('opening') @RequirePermissions('gold_accounts.adjust') opening(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.gold.createOpening(request.identity!, body); }
  @Post('receipt') @RequirePermissions('gold_accounts.transaction.create') receipt(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.gold.createReceipt(request.identity!, body); }
  @Post('payment') @RequirePermissions('gold_accounts.transaction.create') payment(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.gold.createPayment(request.identity!, body); }
  @Post('conversion') @RequirePermissions('gold_accounts.convert') conversion(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.gold.createConversion(request.identity!, body); }
  @Post('transactions/:id/reverse') @RequirePermissions('gold_accounts.reverse') reverse(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.gold.reverseTransaction(request.identity!, id, body); }

  @Get('reconciliation') @RequirePermissions('gold_accounts.view') reconciliation(@Req() request: FastifyRequest) { return this.gold.reconciliation(request.identity!); }
}
