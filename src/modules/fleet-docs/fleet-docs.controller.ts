import {
  Controller, Get, Post, Patch, Param, Body,
} from '@nestjs/common';
import {
  FleetDocsService,
  CreateVehicleDocumentDto,
  UpdateVehicleDocumentDto,
  RecordConsumableReplacementDto,
} from './fleet-docs.service';
import { RequirePermission }  from '../../common/decorators/require-permission.decorator';
import { RequireModule }      from '../../common/decorators/require-module.decorator';
import { TenantId }           from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission }         from '../../common/constants/permissions';

@RequireModule('FLEET_DOCS')
@Controller('tenants/:tenantId/fleet-docs')
export class FleetDocsController {
  constructor(private readonly svc: FleetDocsService) {}

  // ── Document types (config) ────────────────────────────────────────────────

  @Post('document-types')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  createDocumentType(
    @TenantId() tenantId: string,
    @Body() body: { name: string; code: string; alertDaysBeforeExpiry?: number; isMandatory?: boolean },
  ) {
    return this.svc.createDocumentType(tenantId, body);
  }

  @Get('document-types')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  listDocumentTypes(@TenantId() tenantId: string) {
    return this.svc.listDocumentTypes(tenantId);
  }

  // ── Vehicle documents ──────────────────────────────────────────────────────

  @Post('documents')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  createDocument(
    @TenantId() tenantId: string,
    @Body() dto: CreateVehicleDocumentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.svc.createDocument(tenantId, dto, actor.id);
  }

  @Patch('documents/:id')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  updateDocument(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDocumentDto,
  ) {
    return this.svc.updateDocument(tenantId, id, dto);
  }

  @Post('documents/:id/upload-url')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  getUploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getUploadUrl(tenantId, id);
  }

  @Get('buses/:busId/documents')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  getDocumentsForBus(
    @TenantId() tenantId: string,
    @Param('busId') busId: string,
  ) {
    return this.svc.getDocumentsForBus(tenantId, busId);
  }

  @Get('documents/alerts')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  getAlerts(@TenantId() tenantId: string) {
    return this.svc.getMissingOrExpiredDocuments(tenantId);
  }

  // ── Consumable types (config) ──────────────────────────────────────────────

  @Post('consumable-types')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  createConsumableType(
    @TenantId() tenantId: string,
    @Body() body: { name: string; code: string; nominalLifetimeKm: number; alertKmBefore: number },
  ) {
    return this.svc.createConsumableType(tenantId, body);
  }

  @Get('consumable-types')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  listConsumableTypes(@TenantId() tenantId: string) {
    return this.svc.listConsumableTypes(tenantId);
  }

  // ── Consumable tracking ────────────────────────────────────────────────────

  @Post('consumables/replacement')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  recordReplacement(
    @TenantId() tenantId: string,
    @Body() dto: RecordConsumableReplacementDto,
  ) {
    return this.svc.recordConsumableReplacement(tenantId, dto);
  }

  @Get('buses/:busId/consumables')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  getConsumables(
    @TenantId() tenantId: string,
    @Param('busId') busId: string,
  ) {
    return this.svc.getConsumablesForBus(tenantId, busId);
  }

  // ── Maintenance intervenants & parts ───────────────────────────────────────

  @Post('maintenance/:reportId/intervenants')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  addIntervenant(
    @TenantId() tenantId: string,
    @Param('reportId') reportId: string,
    @Body() body: { staffId?: string; externalName?: string; role: string; hoursWorked?: number; notes?: string },
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.addIntervenant(tenantId, reportId, body, scope);
  }

  @Post('maintenance/:reportId/parts')
  @RequirePermission(Permission.MAINTENANCE_UPDATE_OWN)
  addPart(
    @TenantId() tenantId: string,
    @Param('reportId') reportId: string,
    @Body() body: { consumableTypeId?: string; partName: string; partReference?: string; quantity?: number; unitCostXaf?: number; kmAtReplacement?: number },
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.addPart(tenantId, reportId, body, scope);
  }

  @Get('maintenance/:reportId/detail')
  @RequirePermission(Permission.MAINTENANCE_APPROVE_TENANT)
  getMaintenanceDetail(
    @TenantId() tenantId: string,
    @Param('reportId') reportId: string,
  ) {
    return this.svc.getMaintenanceDetail(tenantId, reportId);
  }
}
