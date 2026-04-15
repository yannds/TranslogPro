import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('trips/:tripId/gps')
  @RequirePermission(Permission.TRIP_UPDATE_AGENCY)
  updateGps(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Body('lat') lat: number,
    @Body('lng') lng: number,
    @Body('speed') speed?: number,
    @Body('heading') heading?: number,
  ) {
    return this.trackingService.updateGps(tenantId, tripId, lat, lng, speed, heading);
  }

  @Get('trips/:tripId/position')
  @RequirePermission(Permission.TRIP_READ_OWN)
  lastPosition(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.trackingService.getLastPosition(tenantId, tripId, scope);
  }

  @Get('trips/:tripId/history')
  @RequirePermission(Permission.TRIP_READ_OWN)
  history(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('limit') limit?: string,
  ) {
    return this.trackingService.getTripHistory(tenantId, tripId, limit ? parseInt(limit) : 500, scope);
  }
}
