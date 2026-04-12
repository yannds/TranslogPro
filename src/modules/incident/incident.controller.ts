import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

@Controller('tenants/:tenantId/incidents')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  /**
   * Déclaration incident / SOS — scope own (chauffeur déclare son incident).
   * PRD §IV.6 — data.trip.report.own
   * Rate limit : 3 déclarations SOS / heure / userId (sliding window Redis)
   */
  @Post()
  @RequirePermission(Permission.TRIP_REPORT_OWN)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    3,
    windowMs: 60 * 60 * 1_000,   // 1 heure
    keyBy:    'userId',
    suffix:   'sos',
    message:  'Limite de signalements SOS atteinte (3/heure). Contactez le dispatch directement.',
  })
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
