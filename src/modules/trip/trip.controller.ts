import { Controller, Get, Post, Param, Body, Query, Headers, Req } from '@nestjs/common';
import { Request } from 'express';
import { TripService } from './trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
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
  @RequirePermission(Permission.TRIP_READ_OWN)
  findAll(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('status') status?: string,
  ) {
    // scope.scope = 'own' → chauffeur voit ses trajets uniquement
    return this.tripService.findAll(tenantId, { status });
  }

  @Get(':id')
  @RequirePermission(Permission.TRIP_READ_OWN)
  findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.tripService.findOne(tenantId, id);
  }
}
