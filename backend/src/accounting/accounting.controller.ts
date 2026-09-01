import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { AccountingService } from './accounting.service.js';
import { CompanyAccountingGuard } from './company-accounting.guard.js';

@Controller('accounting') @UseGuards(AuthGuard, PermissionGuard, CompanyAccountingGuard)
export class AccountingController {
  constructor(@Inject(AccountingService) private readonly accounting: AccountingService) {}

  @Get('accounts') @RequirePermissions('accounting.view') listAccounts(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.accounting.listAccounts(request.identity!, query); }
  @Post('accounts') @RequirePermissions('accounting.accounts.manage') createAccount(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.accounting.createAccount(request.identity!, body); }
  @Patch('accounts/:id') @RequirePermissions('accounting.accounts.manage') updateAccount(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.accounting.updateAccount(request.identity!, id, body); }

  @Get('mappings') @RequirePermissions('accounting.view') listMappings() { return this.accounting.listMappings(); }
  @Post('mappings') @RequirePermissions('accounting.accounts.manage') setMapping(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.accounting.setMapping(request.identity!, body); }

  @Get('journals') @RequirePermissions('accounting.view') listJournals(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.accounting.listJournals(request.identity!, query); }
  @Get('journals/by-source') @RequirePermissions('accounting.view') bySource(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.accounting.journalsForSource(request.identity!, query); }
  @Get('journals/:id') @RequirePermissions('accounting.view') getJournal(@Req() request: FastifyRequest, @Param('id') id: string) { return this.accounting.getJournal(request.identity!, id); }
  @Post('journals') @RequirePermissions('accounting.journal.create') createJournal(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.accounting.createManualJournal(request.identity!, body); }
  @Post('journals/:id/reverse') @RequirePermissions('accounting.journal.reverse') reverseJournal(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.accounting.reverseJournal(request.identity!, id, body); }

  @Get('general-ledger') @RequirePermissions('accounting.view') generalLedger(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.accounting.generalLedger(request.identity!, query); }
  @Get('trial-balance') @RequirePermissions('accounting.view') trialBalance(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.accounting.trialBalance(request.identity!, query); }
  @Get('reconciliation') @RequirePermissions('accounting.view') reconciliation(@Req() request: FastifyRequest) { return this.accounting.reconciliation(request.identity!); }
}
