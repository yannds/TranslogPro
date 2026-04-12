import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermission(Permission.STATS_READ_TENANT)
  dashboard(@TenantId() tenantId: string, @Query('agencyId') agencyId?: string) {
    return this.analyticsService.getDashboard(tenantId, agencyId);
  }

  @Get('trips')
  @RequirePermission(Permission.STATS_READ_TENANT)
  tripsReport(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    return this.analyticsService.getTripsReport(tenantId, new Date(from), new Date(to), agencyId);
  }

  @Get('revenue')
  @RequirePermission(Permission.STATS_READ_TENANT)
  revenueReport(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analyticsService.getRevenueReport(tenantId, new Date(from), new Date(to));
  }

  @Get('trips/:tripId/occupancy')
  @RequirePermission(Permission.STATS_READ_TENANT)
  occupancy(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.analyticsService.getOccupancyRate(tenantId, tripId);
  }
}
