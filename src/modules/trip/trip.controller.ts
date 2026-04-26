import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Headers, Req } from '@nestjs/common';
import { Request } from 'express';
import { TripService } from './trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/trips')
export class TripController {
  constructor(private readonly tripService: TripService) {}

  @Post()
  @RequirePermission(Permission.TRIP_CREATE_TENANT)
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateTripDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.tripService.create(tenantId, dto);
  }

  @Get()
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_AGENCY, Permission.TRIP_READ_OWN])
  findAll(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('status')   status?:   string | string[],
    @Query('driverId') driverId?: string,
    @Query('from')     from?:     string,
    @Query('to')       to?:       string,
  ) {
    return this.tripService.findAll(tenantId, { status, driverId, from, to }, scope);
  }

  /**
   * Trips "live" — pour le dashboard temps réel admin/manager mobile.
   *
   * Filtre serveur sur les statuts en cours (PLANNED/OPEN/BOARDING/IN_PROGRESS)
   * + retour enrichi par trip avec :
   *   - delayMinutes (différence departureScheduled vs departureActual)
   *   - state ('on-time' | 'delayed' | 'early' | 'arrived' | 'suspended')
   *   - assignedSeats / capacity
   *   - bus.plate, route.origin/destination, driver.name
   *
   * Optimisé pour le polling court (~5-10s côté mobile). Pas de cache, pas
   * de pagination — la quantité de trips actifs simultanés est faible.
   */
  @Get('live')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_AGENCY])
  findLive(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.tripService.findLive(tenantId, scope);
  }

  @Get(':id')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_AGENCY, Permission.TRIP_READ_OWN])
  findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.tripService.findOne(tenantId, id, scope);
  }

  @Patch(':id')
  @RequirePermission(Permission.TRIP_CREATE_TENANT)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripService.update(tenantId, id, dto);
  }

  @Get(':id/seats')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_AGENCY, Permission.TRIP_READ_OWN])
  getSeats(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.tripService.getSeats(tenantId, id);
  }

  @Delete(':id')
  @RequirePermission(Permission.TRIP_DELETE_TENANT)
  remove(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.tripService.remove(tenantId, id);
  }
}
