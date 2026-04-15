import { Controller, Post, Get, Patch, Delete, Body, Param } from '@nestjs/common';
import { CrewService, AssignCrewDto } from './crew.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/trips/:tripId/crew')
export class CrewController {
  constructor(private readonly crewService: CrewService) {}

  @Post()
  @RequirePermission(Permission.CREW_MANAGE_TENANT)
  assign(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Body() dto: AssignCrewDto,
  ) {
    return this.crewService.assign(tenantId, tripId, dto);
  }

  @Get()
  @RequirePermission(Permission.TRIP_READ_OWN)
  getForTrip(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.crewService.getForTrip(tenantId, tripId, scope);
  }

  @Patch(':staffId/briefed')
  @RequirePermission(Permission.TRIP_CHECK_OWN)
  markBriefed(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Param('staffId') staffId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.crewService.markBriefed(tenantId, tripId, staffId, scope);
  }

  @Delete(':staffId')
  @RequirePermission(Permission.CREW_MANAGE_TENANT)
  remove(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.crewService.remove(tenantId, tripId, staffId);
  }
}
