import { Module } from '@nestjs/common';
import { SavService } from './sav.service';
import { SavController } from './sav.controller';
import { RefundService } from './refund.service';
import { RefundTripListener } from './refund-trip.listener';

@Module({
  controllers: [SavController],
  providers:   [SavService, RefundService, RefundTripListener],
  exports:     [SavService, RefundService],
})
export class SavModule {}
