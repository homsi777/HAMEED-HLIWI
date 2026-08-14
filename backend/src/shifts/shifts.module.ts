import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ShiftTotalsService } from './shift-totals.service.js';
import { ShiftsController } from './shifts.controller.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  imports: [AuthModule, PermissionsModule, RealtimeModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftTotalsService],
  exports: [ShiftsService, ShiftTotalsService],
})
export class ShiftsModule {}
