import { Module }                from '@nestjs/common';
import { ProfitabilityService }  from './profitability.service';
import { YieldService }          from './yield.service';
import { PeakPeriodService }     from './peak-period.service';
import { PricingSimulatorAdvancedService } from './simulator-advanced.service';
import { PricingController }     from './pricing.controller';

@Module({
  controllers: [PricingController],
  providers:   [ProfitabilityService, YieldService, PeakPeriodService, PricingSimulatorAdvancedService],
  exports:     [ProfitabilityService, YieldService, PeakPeriodService, PricingSimulatorAdvancedService],
})
export class ProfitabilityModule {}
