import { Controller, Get, Post, Param, Query, Body, Headers } from '@nestjs/common';
import { ParcelService } from './parcel.service';
import { CreateParcelDto } from './dto/create-parcel.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/parcels')
export class ParcelController {
  constructor(private readonly parcelService: ParcelService) {}

  /** Enregistrement colis — agent de gare */
  @Post()
  @RequirePermission(Permission.PARCEL_CREATE_AGENCY)
  register(
    @TenantId() tenantId: string,
    @Body() dto: CreateParcelDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.register(tenantId, dto, actor);
  }

  /** Transition générique — action passée dans le body */
  @Post(':id/transition')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  transition(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('action') action: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.transition(tenantId, id, action, actor, idempotencyKey);
  }

  /** Scan chargement/déchargement — agent de quai */
  @Post(':id/scan')
  @RequirePermission(Permission.PARCEL_SCAN_AGENCY)
  scan(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('action') action: string,
    @Body('stationId') stationId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.scan(tenantId, id, action, stationId, actor, idempotencyKey);
  }

  /** Déclaration colis endommagé → déclenche SAV + WhatsApp */
  @Post(':id/report-damage')
  @RequirePermission(Permission.PARCEL_REPORT_AGENCY)
  reportDamage(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('description') description: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.parcelService.reportDamage(tenantId, id, description, actor);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hub / entrepôt / retrait / retour (2026-04-19)
  // ─────────────────────────────────────────────────────────────────────────

  /** Arrivée dans un hub intermédiaire — IN_TRANSIT → AT_HUB_INBOUND. */
  @Post(':id/hub/arrive')
  @RequirePermission(Permission.PARCEL_HUB_MOVE_AGENCY)
  arriveAtHub(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('hubStationId') hubStationId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.arriveAtHub(tenantId, id, hubStationId, actor, idempotencyKey);
  }

  /** Stockage au hub — AT_HUB_INBOUND → STORED_AT_HUB. */
  @Post(':id/hub/store')
  @RequirePermission(Permission.PARCEL_HUB_MOVE_AGENCY)
  storeAtHub(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.storeAtHub(tenantId, id, actor, idempotencyKey);
  }

  /** Chargement bus sortant du hub — AT_HUB_INBOUND | STORED_AT_HUB → AT_HUB_OUTBOUND. */
  @Post(':id/hub/load-outbound')
  @RequirePermission(Permission.PARCEL_HUB_MOVE_AGENCY)
  loadOutboundFromHub(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.loadOutboundFromHub(tenantId, id, actor, idempotencyKey);
  }

  /** Départ depuis le hub — AT_HUB_OUTBOUND → IN_TRANSIT. */
  @Post(':id/hub/depart')
  @RequirePermission(Permission.PARCEL_HUB_MOVE_AGENCY)
  departFromHub(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.departFromHub(tenantId, id, actor, idempotencyKey);
  }

  /** Notification de mise à disposition — ARRIVED → AVAILABLE_FOR_PICKUP. */
  @Post(':id/pickup/notify')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  notifyForPickup(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.notifyForPickup(tenantId, id, actor, idempotencyKey);
  }

  /** Retrait destinataire — AVAILABLE_FOR_PICKUP → DELIVERED. */
  @Post(':id/pickup/complete')
  @RequirePermission(Permission.PARCEL_PICKUP_AGENCY)
  pickup(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.pickup(tenantId, id, actor, idempotencyKey);
  }

  /** Contestation destinataire/expéditeur — DELIVERED | AVAILABLE_FOR_PICKUP → DISPUTED. */
  @Post(':id/dispute')
  @RequirePermission(Permission.PARCEL_DISPUTE_OWN)
  dispute(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.dispute(tenantId, id, reason, actor, idempotencyKey);
  }

  /** Initiation retour — AVAILABLE_FOR_PICKUP | STORED_AT_HUB → RETURN_TO_SENDER. */
  @Post(':id/return/initiate')
  @RequirePermission(Permission.PARCEL_RETURN_INIT_TENANT)
  initiateReturn(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.initiateReturn(tenantId, id, actor, idempotencyKey);
  }

  /** Finalisation retour — RETURN_TO_SENDER → RETURNED. */
  @Post(':id/return/complete')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  completeReturn(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.parcelService.completeReturn(tenantId, id, actor, idempotencyKey);
  }

  /** Liste tous les colis du tenant — filtrable par status */
  @Get()
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
  ) {
    return this.parcelService.findAll(tenantId, status ? { status } : undefined);
  }

  /**
   * "Mes colis" — colis expédiés par le CUSTOMER courant (filtré senderId).
   */
  @Get('my')
  @RequirePermission(Permission.PARCEL_READ_OWN)
  findMine(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.parcelService.findMine(tenantId, actor.id);
  }

  /** Public tracking — path param tenantId, RlsMiddleware autorisé */
  @Get('track/:code')
  track(@Param('tenantId') tenantId: string, @Param('code') code: string) {
    return this.parcelService.trackByCode(tenantId, code);
  }

  @Get(':id')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.parcelService.findOne(tenantId, id);
  }
}
