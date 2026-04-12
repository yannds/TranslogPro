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

  @Get(':id')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.shipmentService.findOne(tenantId, id);
  }

  @Get('trips/:tripId')
  @RequirePermission(Permission.PARCEL_UPDATE_AGENCY)
  findByTrip(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.shipmentService.findByTrip(tenantId, tripId);
  }
}
