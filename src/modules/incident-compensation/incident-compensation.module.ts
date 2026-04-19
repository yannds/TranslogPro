import { Module } from '@nestjs/common';
import { IncidentCompensationService } from './incident-compensation.service';
import { IncidentCompensationController } from './incident-compensation.controller';
import { VoucherModule } from '../voucher/voucher.module';
import { SavModule } from '../sav/sav.module';

@Module({
  imports:     [VoucherModule, SavModule],
  providers:   [IncidentCompensationService],
  controllers: [IncidentCompensationController],
  exports:     [IncidentCompensationService],
})
export class IncidentCompensationModule {}
