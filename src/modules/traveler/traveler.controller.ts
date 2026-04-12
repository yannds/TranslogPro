import { Controller, Get, Post, Param, Body, Headers } from '@nestjs/common';
import { TravelerService } from './traveler.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/travelers')
export class TravelerController {
  constructor(private readonly travelerService: TravelerService) {}

  /** Valider identité passager — scope agency */
  @Post(':id/verify')
  @RequirePermission(Permission.TRAVELER_VERIFY_AGENCY)
  verify(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.travelerService.verify(tenantId, id, actor, idempotencyKey);
  }

  /** Check-in en gare (SCAN_IN) — scope agency */
  @Post(':id/scan-in')
  @RequirePermission(Permission.TICKET_SCAN_AGENCY)
  scanIn(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.travelerService.scanIn(tenantId, id, actor, idempotencyKey);
  }

  /** Embarquement bus (SCAN_BOARD) — scope agency */
  @Post(':id/scan-board')
  @RequirePermission(Permission.TICKET_SCAN_AGENCY)
  scanBoard(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.travelerService.scanBoard(tenantId, id, actor, idempotencyKey);
  }

  /** Déchargement à station (SCAN_OUT) — scope agency */
  @Post(':id/scan-out')
  @RequirePermission(Permission.TICKET_SCAN_AGENCY)
  scanOut(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('stationId') stationId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.travelerService.scanOut(tenantId, id, stationId, actor);
  }

  @Get('trips/:tripId')
  @RequirePermission(Permission.TICKET_READ_AGENCY)
  findByTrip(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.travelerService.findByTrip(tenantId, tripId);
  }

  /**
   * PRD §IV.10 — Liste voyageurs à décharger à une station.
   * Utilisé par le Manifeste 3.0 et l'affichage driver.
   */
  @Get('trips/:tripId/drop-off/:stationId')
  @RequirePermission(Permission.MANIFEST_READ_OWN)
  dropOffList(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Param('stationId') stationId: string,
  ) {
    return this.travelerService.getDropOffList(tenantId, tripId, stationId);
  }
}
