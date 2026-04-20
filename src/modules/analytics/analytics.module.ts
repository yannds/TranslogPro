import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { SeasonalityService } from './seasonality.service';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [WorkflowModule],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService, SeasonalityService],
  exports:     [AnalyticsService, SeasonalityService],
})
export class AnalyticsModule {}
