import {
  Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus, Query, NotFoundException,
} from '@nestjs/common';
import {
  RouteService, CreateRouteDto, UpdateRouteDto,
} from './route.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { SetWaypointsDto } from './dto/set-waypoints.dto';
import { SetSegmentPricesDto } from './dto/set-segment-prices.dto';

/**
 * CRUD des lignes (routes) — scope `.tenant`.
 * Lecture et gestion protégées par ROUTE_MANAGE_TENANT.
 * Suppression refusée (409) si des trajets sont encore rattachés à la ligne.
 */
@Controller('tenants/:tenantId/routes')
export class RouteController {
  constructor(private readonly routes: RouteService) {}

  @Get()
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  findAll(@TenantId() tenantId: string) {
    return this.routes.findAll(tenantId);
  }

  /**
   * Liste des stations du tenant — sert de source pour les selects
   * origine / destination dans le formulaire de ligne.
   */
  @Get('stations/available')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  listStations(@TenantId() tenantId: string) {
    return this.routes.listStations(tenantId);
  }

  /**
   * Autocomplete péages/contrôles — retourne les points non-STATION déjà enregistrés
   * sur ce tenant (dédoublonnés par kind+name). Utilisé dans RouteDetailDialog.
   * GET /tenants/:tenantId/routes/checkpoints?kind=PEAGE  (kind optionnel)
   */
  @Get('checkpoints')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  listCheckpoints(@TenantId() tenantId: string, @Query('kind') kind?: string) {
    return this.routes.listCheckpoints(tenantId, kind);
  }

  /**
   * Suggère une distance routière (ou estimation haversine si routing non activé).
   *
   * GET /tenants/:tenantId/routes/suggest-distance
   *   ?originId=<stationId>&destinationId=<stationId>
   *
   * Retourne { distanceKm, durationMin, provider, estimated }.
   * `estimated: true` signifie que la valeur est un calcul ligne droite (haversine).
   */
  @Get('suggest-distance')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  async suggestDistance(
    @TenantId() tenantId: string,
    @Query('originId') originId: string,
    @Query('destinationId') destinationId: string,
  ) {
    const result = await this.routes.suggestDistance(tenantId, originId, destinationId);
    if (!result) {
      throw new NotFoundException('Coordonnées GPS manquantes sur l\'une des gares.');
    }
    return result;
  }

  @Get(':id')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.routes.findOneWithWaypoints(tenantId, id);
  }

  // ── Waypoints (escales) ────────────────────────────────────────────────

  @Patch(':id/waypoints')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  setWaypoints(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetWaypointsDto,
  ) {
    return this.routes.setWaypoints(tenantId, id, dto.waypoints);
  }

  /**
   * Recalibre distances des waypoints + Route.distanceKm + RouteSegmentPrice depuis
   * le provider de routing actif (Google Maps typiquement). Ne touche PAS au basePrice
   * ni aux tollCostXaf. Idempotent — rappelable après édition des waypoints.
   */
  @Post(':id/recalibrate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  recalibrate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.routes.recalibrateFromGoogle(tenantId, id);
  }

  // ── Matrice de prix segment ────────────────────────────────────────────

  @Get(':id/segment-prices')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  getSegmentPrices(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.routes.getSegmentPrices(tenantId, id);
  }

  @Patch(':id/segment-prices')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  bulkSetSegmentPrices(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetSegmentPricesDto,
  ) {
    return this.routes.bulkSetSegmentPrices(tenantId, id, dto.prices);
  }

  @Post()
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  create(@TenantId() tenantId: string, @Body() dto: CreateRouteDto) {
    return this.routes.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routes.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.routes.remove(tenantId, id);
  }
}
