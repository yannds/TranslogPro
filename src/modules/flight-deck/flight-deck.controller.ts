import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { FlightDeckService } from './flight-deck.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/flight-deck')
export class FlightDeckController {
  constructor(private readonly flightDeckService: FlightDeckService) {}

  @Get('active-trip')
  @RequirePermission(Permission.TRIP_READ_OWN)
  getActiveTrip(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.getActiveTripForDriver(tenantId, user.id);
  }

  @Get('trips/:tripId/checklist')
  @RequirePermission(Permission.TRIP_READ_OWN)
  getChecklist(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.flightDeckService.getChecklist(tenantId, tripId, scope);
  }

  @Patch('checklist/:checklistId/complete')
  @RequirePermission(Permission.TRIP_UPDATE_AGENCY)
  completeChecklist(
    @TenantId() tenantId: string,
    @Param('checklistId') checklistId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.completeChecklist(tenantId, checklistId, user.id);
  }

  @Get('trips/:tripId/passengers')
  @RequirePermission(Permission.TICKET_READ_AGENCY)
  getPassengers(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.flightDeckService.getPassengerList(tenantId, tripId);
  }

  @Get('schedule')
  @RequirePermission(Permission.TRIP_READ_OWN)
  getSchedule(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.flightDeckService.getDriverSchedule(
      tenantId,
      user.id,
      new Date(from),
      new Date(to),
    );
  }
}
