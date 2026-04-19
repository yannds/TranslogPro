import { Controller, Post, Param, Body } from '@nestjs/common';
import { IncidentCompensationService } from './incident-compensation.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId/trips/:tripId/incident' })
export class IncidentCompensationController {
  constructor(private readonly svc: IncidentCompensationService) {}

  /** Panne majeure en route — Trip → SUSPENDED. */
  @Post('suspend')
  @RequirePermission(Permission.TRIP_SUSPEND_AGENCY)
  suspend(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Body('reason') reason: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.svc.suspendTrip(tenantId, tripId, reason, actor);
  }

  /** Bus secours dispo / réparation faite — SUSPENDED → IN_PROGRESS. */
  @Post('resume')
  @RequirePermission(Permission.TRIP_SUSPEND_AGENCY)
  resume(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.svc.resumeTrip(tenantId, tripId, actor);
  }

  /**
   * Annulation définitive post-départ → CANCELLED_IN_TRANSIT.
   * Auto-refund prorata km si activé (ou 100 % sinon).
   */
  @Post('cancel-in-transit')
  @RequirePermission(Permission.TRIP_CANCEL_IN_TRANSIT_TENANT)
  cancelInTransit(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Body() body: { reason: string; distanceTraveledKm?: number; totalDistanceKm?: number },
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.svc.cancelInTransit(tenantId, tripId, actor, body);
  }

  /**
   * Déclaration retard majeur → déclenche compensation selon tiers config + forme.
   * Body: { delayMinutes }
   */
  @Post('declare-major-delay')
  @RequirePermission(Permission.TRIP_DECLARE_MAJOR_DELAY_AGENCY)
  declareMajorDelay(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Body('delayMinutes') delayMinutes: number,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.svc.declareMajorDelay(tenantId, tripId, delayMinutes, actor);
  }
}
