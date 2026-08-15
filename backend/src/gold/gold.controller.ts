import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { UsedInventoryService } from './used-inventory.service.js';
import { WeightCustodyService } from './weight-custody.service.js';
import { GoldService } from './gold.service.js';

@Controller('gold') @UseGuards(AuthGuard, PermissionGuard)
export class GoldController {
  constructor(@Inject(GoldService) private readonly gold: GoldService, @Inject(UsedInventoryService) private readonly used: UsedInventoryService, @Inject(WeightCustodyService) private readonly custody: WeightCustodyService) {}

  @Get('karats') @RequirePermissions('gold_accounts.view') karats() { return this.gold.karats(); }
  @Get('accounts') @RequirePermissions('gold_accounts.view') listAccounts(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.gold.listAccounts(request.identity!, query); }
  @Get('holdings') @RequirePermissions('gold_accounts.view') holdings(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.gold.holdings(request.identity!, query); }

  // Scrap available for reclassification, and the manager decision that reclassifies it.
  // Literal paths are declared before any `:id` route so they are not captured as ids.
  // ذمم الأوزان — physical weight custody. A recipient may be an existing partner, an existing
  // custody person, or a name typed on the spot; none of them requires a Customer.
  @Get('custody/people') @RequirePermissions('gold_accounts.view')
  custodyPeople(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.custody.searchPeople(request.identity!, query); }

  @Get('custody/balances') @RequirePermissions('gold_accounts.view')
  custodyBalances(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.custody.balances(request.identity!, query); }

  @Get('custody/people/:personId') @RequirePermissions('gold_accounts.view')
  custodyPerson(@Req() request: FastifyRequest, @Param('personId') personId: string) { return this.custody.personDetail(request.identity!, personId); }

  @Post('custody/people') @RequirePermissions('gold_accounts.transaction.create')
  createCustodyPerson(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.custody.createPerson(request.identity!, body); }

  @Post('custody/hand-out') @RequirePermissions('gold_accounts.transaction.create')
  custodyHandOut(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.custody.handOut(request.identity!, body); }

  @Post('custody/receive') @RequirePermissions('gold_accounts.transaction.create')
  custodyReceive(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.custody.receive(request.identity!, body); }

  @Get('holdings/scrap') @RequirePermissions('gold_accounts.view')
  availableScrap(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.used.available(request.identity!, query); }

  @Get('used-conversions') @RequirePermissions('gold_accounts.view')
  conversions(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) { return this.used.conversions(request.identity!, query); }

  @Get('used-conversions/:conversionId') @RequirePermissions('gold_accounts.view')
  usedConversion(@Req() request: FastifyRequest, @Param('conversionId') conversionId: string) { return this.used.detail(request.identity!, conversionId); }

  @Post('used-conversions') @RequirePermissions('gold_accounts.used_inventory.convert')
  convertToUsedInventory(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>) { return this.used.convert(request.identity!, body); }

  @Post('used-conversions/:conversionId/reverse') @RequirePermissions('gold_accounts.used_inventory.reverse')
  reverseConversion(@Req() request: FastifyRequest, @Param('conversionId') conversionId: string, @Body() body: Record<string, unknown>) { return this.used.reverse(request.identity!, conversionId, body); }
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
