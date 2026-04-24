/**
 * CrewBriefingController — REST API briefing pré-départ (legacy + v2 QHSE).
 *
 * Trois familles d'endpoints :
 *   1. Legacy `equipment-types` + `briefings` v1 — conservés pour compat
 *      ancien mobile / UI historique, à déprécier Sprint 6.
 *   2. Templates v2 (`templates`) — CRUD sections + items, tenant admin.
 *   3. Briefings v2 (`briefings/v2`) — signature multi-chapitres + override.
 *   4. Safety alerts (`safety-alerts`) — list + resolve.
 *
 * Tous les endpoints sont tenant-scopés (:tenantId) et protégés par
 * RequireModule + RequirePermission + RBAC runtime (PermissionGuard).
 */

import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  ParseIntPipe,
} from '@nestjs/common';
import {
  CrewBriefingService,
  CreateBriefingDto,
} from './crew-briefing.service';
import {
  BriefingTemplateService,
} from './briefing-template.service';
import {
  TripSafetyAlertService,
  SafetyAlertSeverity,
  SafetyAlertSource,
} from './trip-safety-alert.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  DuplicateTemplateDto,
  UpsertSectionDto,
  UpsertItemDto,
  ToggleItemDto,
} from './dto/briefing-template.dto';
import {
  CreateBriefingV2HttpDto,
  ResolveSafetyAlertDto,
} from './dto/briefing-v2.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireModule }     from '../../common/decorators/require-module.decorator';
import { TenantId }          from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission }        from '../../common/constants/permissions';

@RequireModule('CREW_BRIEFING')
@Controller('tenants/:tenantId/crew-briefing')
export class CrewBriefingController {
  constructor(
    private readonly svc:      CrewBriefingService,
    private readonly templates: BriefingTemplateService,
    private readonly alerts:   TripSafetyAlertService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // LEGACY v1 — Equipment Types (rétro-compat, UI admin Sprint 4 pilote v2)
  // ═══════════════════════════════════════════════════════════════════════

  @Post('equipment-types')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  createEquipmentType(
    @TenantId() tenantId: string,
    @Body() body: { name: string; code: string; requiredQty?: number; isMandatory?: boolean },
  ) {
    return this.svc.createEquipmentType(tenantId, body);
  }

  @Get('equipment-types')
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.DRIVER_REST_OWN])
  listEquipmentTypes(@TenantId() tenantId: string) {
    return this.svc.listEquipmentTypes(tenantId);
  }

  @Patch('equipment-types/:id')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  updateEquipmentType(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: { name?: string; requiredQty?: number; isMandatory?: boolean; isActive?: boolean },
  ) {
    return this.svc.updateEquipmentType(tenantId, id, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEGACY v1 — Briefings (rétro-compat)
  // ═══════════════════════════════════════════════════════════════════════

  @Post('briefings')
  @RequirePermission([Permission.DRIVER_REST_OWN, Permission.BRIEFING_SIGN_OWN])
  createBriefing(
    @TenantId() tenantId: string,
    @Body() dto: CreateBriefingDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.createBriefing(tenantId, dto, scope);
  }

  @Get('briefings/assignment/:assignmentId')
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.BRIEFING_READ_AGENCY, Permission.BRIEFING_READ_TENANT])
  getBriefingForAssignment(
    @TenantId() tenantId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.svc.getBriefingForAssignment(tenantId, assignmentId);
  }

  @Get('briefings/history')
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.BRIEFING_READ_AGENCY, Permission.BRIEFING_READ_TENANT])
  getBriefingHistory(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getBriefingHistory(tenantId, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('briefings/incomplete')
  @RequirePermission([Permission.FLEET_STATUS_AGENCY, Permission.BRIEFING_READ_AGENCY, Permission.BRIEFING_READ_TENANT])
  getIncompleteBriefings(@TenantId() tenantId: string) {
    return this.svc.getIncompleteBriefings(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // v2 — Templates (tenant admin)
  // ═══════════════════════════════════════════════════════════════════════

  @Get('templates')
  @RequirePermission([Permission.BRIEFING_TEMPLATE_READ_TENANT, Permission.BRIEFING_TEMPLATE_MANAGE_TENANT])
  listTemplates(@TenantId() tenantId: string) {
    return this.templates.list(tenantId);
  }

  @Get('templates/default')
  @RequirePermission([
    Permission.BRIEFING_TEMPLATE_READ_TENANT,
    Permission.BRIEFING_SIGN_OWN,
    Permission.BRIEFING_SIGN_DELEGATE_AGENCY,
    Permission.BRIEFING_READ_AGENCY,
  ])
  getDefaultTemplate(@TenantId() tenantId: string) {
    return this.templates.getDefault(tenantId);
  }

  @Get('templates/:templateId')
  @RequirePermission([Permission.BRIEFING_TEMPLATE_READ_TENANT, Permission.BRIEFING_TEMPLATE_MANAGE_TENANT])
  getTemplate(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.templates.getById(tenantId, templateId);
  }

  @Post('templates')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  createTemplate(
    @TenantId() tenantId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templates.create(tenantId, dto);
  }

  @Patch('templates/:templateId')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  updateTemplate(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(tenantId, templateId, dto);
  }

  @Post('templates/:templateId/duplicate')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  duplicateTemplate(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
    @Body() dto: DuplicateTemplateDto,
  ) {
    return this.templates.duplicate(tenantId, templateId, dto.newName);
  }

  // ── Sections ────────────────────────────────────────────────────────────

  @Post('templates/:templateId/sections')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  upsertSection(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
    @Body() dto: UpsertSectionDto,
  ) {
    return this.templates.upsertSection(tenantId, templateId, dto);
  }

  @Delete('sections/:sectionId')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  removeSection(
    @TenantId() tenantId: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.templates.removeSection(tenantId, sectionId);
  }

  // ── Items ───────────────────────────────────────────────────────────────

  @Post('sections/:sectionId/items')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  upsertItem(
    @TenantId() tenantId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpsertItemDto,
  ) {
    return this.templates.upsertItem(tenantId, sectionId, dto);
  }

  @Patch('items/:itemId/toggle')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  toggleItem(
    @TenantId() tenantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleItemDto,
  ) {
    return this.templates.toggleItem(tenantId, itemId, dto.isActive);
  }

  @Delete('items/:itemId')
  @RequirePermission(Permission.BRIEFING_TEMPLATE_MANAGE_TENANT)
  removeItem(
    @TenantId() tenantId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.templates.removeItem(tenantId, itemId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // v2 — Briefings (signature multi-chapitres + double sig + override)
  // ═══════════════════════════════════════════════════════════════════════

  @Post('briefings/v2')
  @RequirePermission([
    Permission.BRIEFING_SIGN_OWN,
    Permission.BRIEFING_SIGN_DELEGATE_AGENCY,
    Permission.BRIEFING_OVERRIDE_TENANT,
  ])
  signBriefingV2(
    @TenantId() tenantId: string,
    @Body() dto: CreateBriefingV2HttpDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.createBriefingV2(tenantId, dto, scope);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // v2 — Safety alerts
  // ═══════════════════════════════════════════════════════════════════════

  @Get('safety-alerts')
  @RequirePermission([Permission.SAFETY_ALERT_READ_AGENCY, Permission.SAFETY_ALERT_READ_TENANT])
  listSafetyAlerts(
    @TenantId() tenantId: string,
    @Query('tripId')   tripId?:   string,
    @Query('severity') severity?: SafetyAlertSeverity,
    @Query('source')   source?:   SafetyAlertSource,
    @Query('resolved') resolved?: string,
    @Query('limit')    limit?:    string,
  ) {
    return this.alerts.list(tenantId, {
      tripId,
      severity,
      source,
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      limit:    limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch('safety-alerts/:alertId/resolve')
  @RequirePermission([Permission.SAFETY_ALERT_RESOLVE_AGENCY, Permission.SAFETY_ALERT_RESOLVE_TENANT])
  resolveSafetyAlert(
    @TenantId() tenantId: string,
    @Param('alertId') alertId: string,
    @Body() dto: ResolveSafetyAlertDto,
  ) {
    return this.alerts.resolve(tenantId, alertId, dto);
  }
}
