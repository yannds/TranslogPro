/**
 * TollPointController — registre péages/points de contrôle tenant.
 *
 *   GET    /api/tenants/:tid/toll-points
 *   POST   /api/tenants/:tid/toll-points
 *   GET    /api/tenants/:tid/toll-points/:id
 *   PATCH  /api/tenants/:tid/toll-points/:id
 *   DELETE /api/tenants/:tid/toll-points/:id
 *   GET    /api/tenants/:tid/routes/:routeId/detect-tolls
 *   POST   /api/tenants/:tid/routes/:routeId/attach-tolls   { tollPointIds: [] }
 *
 * Permission : `control.route.manage.tenant` (même perm que les routes — le
 * registre péages est un composant du chantier Routes).
 */
import {
  Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { TollPointService } from './toll-point.service';
import {
  CreateTollPointDto, UpdateTollPointDto, AttachDetectedDto,
} from './dto/toll-point.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId')
@RequirePermission(Permission.ROUTE_MANAGE_TENANT)
export class TollPointController {
  constructor(private readonly svc: TollPointService) {}

  // ── CRUD registre ───────────────────────────────────────────────────────

  @Get('toll-points')
  findAll(@TenantId() tenantId: string) {
    return this.svc.findAll(tenantId);
  }

  @Post('toll-points')
  @HttpCode(HttpStatus.CREATED)
  create(@TenantId() tenantId: string, @Body() dto: CreateTollPointDto) {
    return this.svc.create(tenantId, dto);
  }

  @Get('toll-points/:id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.findOne(tenantId, id);
  }

  @Patch('toll-points/:id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTollPointDto,
  ) {
    return this.svc.update(tenantId, id, dto);
  }

  @Delete('toll-points/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.svc.remove(tenantId, id);
  }

  // ── Détection automatique + attachement à une route ─────────────────────

  @Get('routes/:routeId/detect-tolls')
  detectOnRoute(
    @TenantId() tenantId: string,
    @Param('routeId') routeId: string,
  ) {
    return this.svc.detectOnRoute(tenantId, routeId);
  }

  @Post('routes/:routeId/attach-tolls')
  @HttpCode(HttpStatus.OK)
  attachDetected(
    @TenantId() tenantId: string,
    @Param('routeId') routeId: string,
    @Body() dto: AttachDetectedDto,
  ) {
    return this.svc.attachDetected(tenantId, routeId, dto.tollPointIds);
  }

  /**
   * Peuple le registre avec les péages/contrôles déjà saisis sur les routes
   * mais non rattachés au registre (Waypoint.tollPointId = null).
   * Idempotent : n'écrase pas les TollPoint existants, backlink uniquement
   * les waypoints orphelins.
   */
  @Post('toll-points/import-from-waypoints')
  @HttpCode(HttpStatus.OK)
  importFromWaypoints(@TenantId() tenantId: string) {
    return this.svc.importFromWaypoints(tenantId);
  }
}
