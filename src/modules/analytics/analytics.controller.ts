import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermission(Permission.STATS_READ_TENANT)
  dashboard(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('agencyId') agencyId?: string,
  ) {
    // scope.scope='agency' → l'acteur ne voit que son agence, peu importe le query param
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getDashboard(tenantId, effectiveAgencyId);
  }

  @Get('trips')
  @RequirePermission(Permission.STATS_READ_TENANT)
  tripsReport(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getTripsReport(
      tenantId, new Date(from), new Date(to), effectiveAgencyId,
    );
  }

  @Get('revenue')
  @RequirePermission(Permission.STATS_READ_TENANT)
  revenueReport(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getRevenueReport(
      tenantId, new Date(from), new Date(to), effectiveAgencyId,
    );
  }

  @Get('trips/:tripId/occupancy')
  @RequirePermission(Permission.STATS_READ_TENANT)
  occupancy(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.analyticsService.getOccupancyRate(tenantId, tripId);
  }

  /**
   * Segmentation client par activité (voyageur / expéditeur / les deux).
   * Source de vérité : tables Ticket + Parcel — pas le rôle.
   */
  @Get('customer-segmentation')
  @RequirePermission(Permission.STATS_READ_TENANT)
  customerSegmentation(@TenantId() tenantId: string) {
    return this.analyticsService.getCustomerSegmentation(tenantId);
  }

  @Get('top-routes')
  @RequirePermission(Permission.STATS_READ_TENANT)
  topRoutes(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getTopRoutes(
      tenantId, new Date(from), new Date(to), limit ? parseInt(limit, 10) : 10,
    );
  }
}
