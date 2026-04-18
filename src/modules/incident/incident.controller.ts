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

  /**
   * Signalement d'incident par le voyageur authentifié (CUSTOMER).
   * Scope own — rate-limit 5/h/userId (moins strict que le SOS chauffeur,
   * plus strict que le portail citoyen : intermédiaire volontaire).
   */
  @Post('mine')
  @RequirePermission(Permission.INCIDENT_REPORT_OWN)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    5,
    windowMs: 60 * 60 * 1_000,
    keyBy:    'userId',
    suffix:   'customer_incident',
    message:  'Limite de 5 signalements par heure atteinte. Merci de réessayer plus tard.',
  })
  createMine(
    @TenantId() tenantId: string,
    @Body() dto: CreateIncidentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.incidentService.create(tenantId, { ...dto, isSos: false }, actor);
  }

  /** Liste des incidents signalés par l'acteur — scope own. */
  @Get('mine/list')
  @RequirePermission(Permission.INCIDENT_REPORT_OWN)
  findMine(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.incidentService.findMine(tenantId, actor.id);
  }
}
