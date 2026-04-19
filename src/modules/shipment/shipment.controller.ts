import { Controller, Get, Post, Param, Body, Headers } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/shipments')
export class ShipmentController {
  constructor(private readonly shipmentService: ShipmentService) {}

  /** Créer groupement colis — scope agency */
  @Post()
  @RequirePermission(Permission.SHIPMENT_GROUP_AGENCY)
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateShipmentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.shipmentService.create(tenantId, dto, actor);
  }

  /**
   * Ajouter un colis au shipment — scope agency.
   * Guards : destination identique + poids disponible + shipment OPEN.
   */
  @Post(':id/parcels/:parcelId')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  addParcel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('parcelId') parcelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shipmentService.addParcel(tenantId, id, parcelId, actor, idempotencyKey);
  }

  @Get('trips/:tripId')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findByTrip(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.shipmentService.findByTrip(tenantId, tripId);
  }

  /**
   * Clôture du chargement — OPEN → LOADED. Utilisé par l'agent de quai ou
   * le chauffeur quand tous les colis sont en soute. Rejeté (400) si des
   * colis ne sont pas encore LOADED.
   * Permission : PARCEL_UPDATE_AGENCY (mêmes rôles que addParcel).
   */
  @Post(':id/close')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  close(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.shipmentService.closeShipment(tenantId, id, actor);
  }

  @Get(':id')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.shipmentService.findOne(tenantId, id);
  }
}
