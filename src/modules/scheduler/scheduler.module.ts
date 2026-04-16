import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { DriverProfileModule } from '../driver-profile/driver-profile.module';

@Module({
  imports:   [DriverProfileModule],
  providers: [SchedulerService],
  exports:   [SchedulerService],
})
export class SchedulerModule {}
