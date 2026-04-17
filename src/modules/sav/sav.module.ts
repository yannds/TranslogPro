import { Module } from '@nestjs/common';
import { SavService } from './sav.service';
import { SavController } from './sav.controller';
import { RefundService } from './refund.service';
import { RefundTripListener } from './refund-trip.listener';
import { CancellationPolicyService } from './cancellation-policy.service';

@Module({
  controllers: [SavController],
  providers:   [SavService, RefundService, RefundTripListener, CancellationPolicyService],
  exports:     [SavService, RefundService, CancellationPolicyService],
})
export class SavModule {}
