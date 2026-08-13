import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { FinanceService } from './finance.service.js';

@Controller('finance') @UseGuards(AuthGuard, PermissionGuard)
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @Get('summary') @RequirePermissions('finance.view') summary(@Req() request: FastifyRequest) { return this.finance.summary(request.identity!); }
  @Get('cashboxes') @RequirePermissions('finance.view') listCashboxes(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.finance.listCashboxes(request.identity!, query); }
  @Post('cashboxes') @RequirePermissions('finance.cashbox.manage') createCashbox(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.finance.createCashbox(request.identity!, body); }
  @Patch('cashboxes/:id') @RequirePermissions('finance.cashbox.manage') updateCashbox(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.finance.updateCashbox(request.identity!, id, body); }

  @Get('vouchers') @RequirePermissions('finance.view') listVouchers(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.finance.listVouchers(request.identity!, query); }
  @Get('vouchers/:id') @RequirePermissions('finance.view') getVoucher(@Req() request: FastifyRequest, @Param('id') id: string) { return this.finance.getVoucher(request.identity!, id); }
  @Post('vouchers') @RequirePermissions('finance.voucher.create') createVoucher(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.finance.createVoucher(request.identity!, body); }
  @Post('vouchers/:id/cancel') @RequirePermissions('finance.voucher.cancel') cancelVoucher(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.finance.cancelVoucher(request.identity!, id, body); }

  @Get('transfers') @RequirePermissions('finance.view') listTransfers(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.finance.listTransfers(request.identity!, query); }
  @Post('transfers') @RequirePermissions('finance.transfer') createTransfer(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.finance.createTransfer(request.identity!, body); }

  @Get('movements') @RequirePermissions('finance.view') listMovements(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.finance.listMovements(request.identity!, query); }
  @Get('partner-balances') @RequirePermissions('finance.view') partnerBalances(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.finance.partnerBalances(request.identity!, query); }
  @Get('partners/:id/statement') @RequirePermissions('finance.view') partnerStatement(@Req() request: FastifyRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) { return this.finance.partnerStatement(request.identity!, id, query); }

  @Get('expense-categories') @RequirePermissions('finance.view') listExpenseCategories() { return this.finance.listExpenseCategories(); }
  @Post('expense-categories') @RequirePermissions('finance.voucher.create') createExpenseCategory(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.finance.createExpenseCategory(request.identity!, body); }
}
