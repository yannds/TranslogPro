import {
  Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  RouteService, CreateRouteDto, UpdateRouteDto,
} from './route.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

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

  @Get(':id')
  @RequirePermission(Permission.ROUTE_MANAGE_TENANT)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.routes.findOne(tenantId, id);
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
