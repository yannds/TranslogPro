import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { CreateTripTemplateDto } from './dto/trip-template.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * Scheduler API — CRUD des `TripTemplate` (Module M PRD).
 *
 * Les templates pilotent la génération automatique de trips à 02h00 par
 * `SchedulerService.generateRecurringTrips` (cron). Création / désactivation
 * par planificateur tenant.
 *
 * Permission gating :
 *   - Lecture : `data.trip.read.tenant` (planificateur, admin)
 *   - Écriture / désactivation : `data.trip.create.tenant`
 */
@Controller({ version: '1', path: 'tenants/:tenantId/scheduler/templates' })
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get()
  @RequirePermission(Permission.TRIP_READ_TENANT)
  list(@TenantId() tenantId: string) {
    return this.scheduler.listTemplates(tenantId);
  }

  @Post()
  @RequirePermission(Permission.TRIP_CREATE_TENANT)
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateTripTemplateDto,
  ) {
    return this.scheduler.createTemplate(tenantId, {
      routeId:         dto.routeId,
      weekdays:        dto.weekdays,
      departureTime:   dto.departureTime,
      defaultBusId:    dto.defaultBusId,
      defaultDriverId: dto.defaultDriverId,
      effectiveUntil:  dto.effectiveUntil ? new Date(dto.effectiveUntil) : undefined,
    });
  }

  @Delete(':id')
  @RequirePermission(Permission.TRIP_CREATE_TENANT)
  deactivate(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.scheduler.deactivateTemplate(tenantId, id);
  }
}
