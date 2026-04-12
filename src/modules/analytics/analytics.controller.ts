import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermission(Permission.ANALYTICS_READ)
  dashboard(@TenantId() tenantId: string, @Query('agencyId') agencyId?: string) {
    return this.analyticsService.getDashboard(tenantId, agencyId);
  }

  @Get('trips')
  @RequirePermission(Permission.ANALYTICS_READ)
  tripsReport(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    return this.analyticsService.getTripsReport(tenantId, new Date(from), new Date(to), agencyId);
  }

  @Get('revenue')
  @RequirePermission(Permission.ANALYTICS_EXPORT)
  revenueReport(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getRevenueReport(tenantId, new Date(from), new Date(to));
  }

  @Get('trips/:tripId/occupancy')
  @RequirePermission(Permission.ANALYTICS_READ)
  occupancy(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.analyticsService.getOccupancyRate(tenantId, tripId);
  }
}
