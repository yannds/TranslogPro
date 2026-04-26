import {
  Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  StationService, CreateStationDto, UpdateStationDto,
} from './station.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * CRUD des stations — scope `.tenant`.
 * Suppression refusée (409) si la station est encore référencée.
 */
@Controller('tenants/:tenantId/stations')
export class StationController {
  constructor(private readonly stations: StationService) {}

  @Get()
  @RequirePermission(Permission.STATION_READ_TENANT)
  findAll(@TenantId() tenantId: string) {
    return this.stations.findAll(tenantId);
  }

  @Get(':id')
  @RequirePermission(Permission.STATION_READ_TENANT)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.stations.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission(Permission.STATION_MANAGE_TENANT)
  create(@TenantId() tenantId: string, @Body() dto: CreateStationDto) {
    return this.stations.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.STATION_MANAGE_TENANT)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStationDto,
  ) {
    return this.stations.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.STATION_MANAGE_TENANT)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.stations.remove(tenantId, id);
  }

  /**
   * POST /api/tenants/:tid/stations/:id/regeocode
   * Re-geocode l'adresse "name, city" via la chaine Google → Mapbox → Nominatim
   * et retourne une suggestion (current vs suggested + distance). Ne sauve pas.
   * L'admin applique via PATCH /stations/:id si la suggestion est correcte.
   */
  @Post(':id/regeocode')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.STATION_MANAGE_TENANT)
  regeocode(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.stations.regeocode(tenantId, id);
  }
}
