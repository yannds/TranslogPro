import { Module } from '@nestjs/common';
import { PlatformAnalyticsController } from './platform-analytics.controller';
import { PlatformAnalyticsService } from './platform-analytics.service';

@Module({
  controllers: [PlatformAnalyticsController],
  providers:   [PlatformAnalyticsService],
  exports:     [PlatformAnalyticsService],
})
export class PlatformAnalyticsModule {}
