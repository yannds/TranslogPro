import { Module } from '@nestjs/common';
import { PricingEngine } from './pricing.engine';

@Module({
  providers: [PricingEngine],
  exports:   [PricingEngine],
})
export class PricingModule {}
