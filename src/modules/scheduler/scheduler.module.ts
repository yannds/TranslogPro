import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';
import { DriverProfileModule } from '../driver-profile/driver-profile.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports:     [DriverProfileModule, AnalyticsModule],
  controllers: [SchedulerController],
  providers:   [SchedulerService],
  exports:     [SchedulerService],
})
export class SchedulerModule {}
