import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { DriverProfileModule } from '../driver-profile/driver-profile.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports:   [DriverProfileModule, AnalyticsModule],
  providers: [SchedulerService],
  exports:   [SchedulerService],
})
export class SchedulerModule {}
