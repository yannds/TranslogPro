import { Module }                from '@nestjs/common';
import { ProfitabilityService }  from './profitability.service';
import { YieldService }          from './yield.service';
import { PricingController }     from './pricing.controller';

@Module({
  controllers: [PricingController],
  providers:   [ProfitabilityService, YieldService],
  exports:     [ProfitabilityService, YieldService],
})
export class ProfitabilityModule {}
