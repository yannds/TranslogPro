import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/incidents')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  /**
   * Déclaration incident / SOS — scope own (chauffeur déclare son incident).
   * PRD §IV.6 — data.trip.report.own
   */
  @Post()
  @RequirePermission(Permission.TRIP_REPORT_OWN)
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateIncidentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.incidentService.create(tenantId, dto, actor);
  }

  @Get()
  @RequirePermission(Permission.TRIP_UPDATE_AGENCY)
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('tripId') tripId?: string,
    @Query('sos') sos?: string,
  ) {
    return this.incidentService.findAll(tenantId, {
      status,
      tripId,
      isSos: sos === 'true' ? true : undefined,
    });
  }

  @Get(':id')
  @RequirePermission(Permission.TRIP_UPDATE_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.incidentService.findOne(tenantId, id);
  }

  @Patch(':id/assign')
  @RequirePermission(Permission.TRIP_UPDATE_AGENCY)
  assign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('assigneeId') assigneeId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.incidentService.assign(tenantId, id, assigneeId, actor);
  }

  @Patch(':id/resolve')
  @RequirePermission(Permission.TRIP_UPDATE_AGENCY)
  resolve(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('resolution') resolution: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.incidentService.resolve(tenantId, id, resolution, actor);
  }
}
