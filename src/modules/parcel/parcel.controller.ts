import { Controller, Get, Post, Param, Body, Headers } from '@nestjs/common';
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

  /**
   * "Mes colis" — colis expédiés par le CUSTOMER courant (filtré senderId).
   * Permission .own : tout client connecté peut consulter ses propres colis.
   * Le filtre est forcé côté service ; aucun query param ne l'override.
   */
  @Get('my')
  @RequirePermission(Permission.PARCEL_READ_OWN)
  findMine(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.parcelService.findMine(tenantId, actor.id);
  }

  @Get(':id')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.parcelService.findOne(tenantId, id);
  }

  /** Public tracking — path param tenantId, RlsMiddleware autorisé */
  @Get('track/:code')
  track(@Param('tenantId') tenantId: string, @Param('code') code: string) {
    return this.parcelService.trackByCode(tenantId, code);
  }
}
