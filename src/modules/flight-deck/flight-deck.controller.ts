import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { FlightDeckService } from './flight-deck.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/flight-deck')
export class FlightDeckController {
  constructor(private readonly flightDeckService: FlightDeckService) {}

  @Get('active-trip')
  @RequirePermission(Permission.TRIP_READ)
  getActiveTrip(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.getActiveTripForDriver(tenantId, user.id);
  }

  @Get('trips/:tripId/checklist')
  @RequirePermission(Permission.TRIP_READ)
  getChecklist(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.flightDeckService.getChecklist(tenantId, tripId);
  }

  @Patch('checklist/:itemId/check')
  @RequirePermission(Permission.TRIP_UPDATE)
  checkItem(
    @TenantId() tenantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.checkItem(tenantId, itemId, user.id);
  }

  @Get('trips/:tripId/passengers')
  @RequirePermission(Permission.TICKET_READ)
  getPassengers(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.flightDeckService.getPassengerList(tenantId, tripId);
  }

  @Get('schedule')
  @RequirePermission(Permission.TRIP_READ)
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
