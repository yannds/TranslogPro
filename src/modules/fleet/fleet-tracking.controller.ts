import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { FleetTrackingService } from './fleet-tracking.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { CreateOdometerReadingDto } from './dto/create-odometer-reading.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/fleet/tracking')
export class FleetTrackingController {
  constructor(private readonly trackingService: FleetTrackingService) {}

  // ── Odometer ────────────────────────────────────────────────────────────

  /** Enregistrer un relevé kilométrique */
  @Post('odometer')
  @RequirePermission([Permission.FLEET_TRACKING_CREATE_AGENCY, Permission.FLEET_TRACKING_MANAGE_TENANT])
  createOdometerReading(
    @TenantId() tenantId: string,
    @Body() dto: CreateOdometerReadingDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.trackingService.createOdometerReading(tenantId, dto, actor.id);
  }

  /** Historique des relevés d'un bus (100 derniers) */
  @Get('odometer/:busId')
  @RequirePermission([Permission.FLEET_STATUS_AGENCY, Permission.FLEET_TRACKING_MANAGE_TENANT])
  getOdometerReadings(
    @TenantId() tenantId: string,
    @Param('busId') busId: string,
  ) {
    return this.trackingService.getOdometerReadings(tenantId, busId);
  }

  // ── Fuel Logs ───────────────────────────────────────────────────────────

  /** Enregistrer un plein de carburant ou AdBlue */
  @Post('fuel')
  @RequirePermission([Permission.FLEET_TRACKING_CREATE_AGENCY, Permission.FLEET_TRACKING_MANAGE_TENANT])
  createFuelLog(
    @TenantId() tenantId: string,
    @Body() dto: CreateFuelLogDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.trackingService.createFuelLog(tenantId, dto, actor.id);
  }

  /** Historique des pleins d'un bus (200 derniers) */
  @Get('fuel/:busId')
  @RequirePermission([Permission.FLEET_STATUS_AGENCY, Permission.FLEET_TRACKING_MANAGE_TENANT])
  getFuelLogs(
    @TenantId() tenantId: string,
    @Param('busId') busId: string,
  ) {
    return this.trackingService.getFuelLogs(tenantId, busId);
  }

  /** Statistiques consommation d'un bus */
  @Get('fuel/:busId/stats')
  @RequirePermission([Permission.FLEET_STATUS_AGENCY, Permission.FLEET_TRACKING_MANAGE_TENANT])
  getFuelStats(
    @TenantId() tenantId: string,
    @Param('busId') busId: string,
  ) {
    return this.trackingService.getFuelStats(tenantId, busId);
  }
}
