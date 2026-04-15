import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { GarageService, CreateMaintenanceDto } from './garage.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/garage')
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  /** Mécanicien crée un rapport — scope own */
  @Post('reports')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateMaintenanceDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.garageService.createReport(tenantId, dto, actor);
  }

  /** Mécanicien complète l'intervention — scope own */
  @Patch('reports/:id/complete')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  complete(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('notes') notes: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.garageService.complete(tenantId, id, notes, actor, scope);
  }

  /**
   * Valider remise en service — scope tenant.
   * PRD §IV.4 — data.maintenance.approve.tenant
   * Side effect : Bus.RESTORE → Bus.status = AVAILABLE
   */
  @Patch('reports/:id/approve')
  @RequirePermission(Permission.MAINTENANCE_APPROVE_TENANT)
  approve(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.garageService.approve(tenantId, id, actor);
  }

  /** URL upload document intervention */
  @Get('reports/:id/upload-url')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  uploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.garageService.getDocumentUploadUrl(tenantId, id, scope);
  }

  @Get('reports')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  findAll(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('status') status?: string,
  ) {
    return this.garageService.findAll(tenantId, status, scope);
  }

  @Get('buses/:busId/reports')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  findByBus(
    @TenantId() tenantId: string,
    @Param('busId') busId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.garageService.findByBus(tenantId, busId, scope);
  }
}
