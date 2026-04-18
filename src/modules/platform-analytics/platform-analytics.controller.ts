/**
 * PlatformAnalyticsController
 *
 *   GET /platform/analytics/growth              KPI tenants + revenus + churn
 *   GET /platform/analytics/adoption            DAU/WAU/MAU + modules + trend 30j
 *   GET /platform/analytics/health              tenants at-risk + DLQ + support
 *   GET /platform/analytics/tenant/:id          vue détaillée d'un tenant
 *
 * Toutes en lecture — permission data.platform.metrics.read.global. SA/L1/L2.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('platform/analytics')
@RequirePermission(Permission.PLATFORM_METRICS_READ_GLOBAL)
export class PlatformAnalyticsController {
  constructor(private readonly analytics: PlatformAnalyticsService) {}

  @Get('growth')
  growth() {
    return this.analytics.getGrowth();
  }

  @Get('adoption')
  adoption() {
    return this.analytics.getAdoption();
  }

  @Get('health')
  health() {
    return this.analytics.getHealth();
  }

  @Get('tenant/:id')
  tenant(@Param('id') id: string) {
    return this.analytics.getTenantOverview(id);
  }
}
