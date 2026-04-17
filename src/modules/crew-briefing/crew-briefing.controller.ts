import {
  Controller, Get, Post, Patch, Param, Body, Query,
} from '@nestjs/common';
import {
  CrewBriefingService,
  CreateBriefingDto,
} from './crew-briefing.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireModule }     from '../../common/decorators/require-module.decorator';
import { TenantId }          from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission }        from '../../common/constants/permissions';

@RequireModule('CREW_BRIEFING')
@Controller('tenants/:tenantId/crew-briefing')
export class CrewBriefingController {
  constructor(private readonly svc: CrewBriefingService) {}

  // ── Equipment Types ────────────────────────────────────────────────────────

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

  // ── Briefing Records ───────────────────────────────────────────────────────

  @Post('briefings')
  @RequirePermission(Permission.DRIVER_REST_OWN)
  createBriefing(
    @TenantId() tenantId: string,
    @Body() dto: CreateBriefingDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.createBriefing(tenantId, dto, scope);
  }

  @Get('briefings/assignment/:assignmentId')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getBriefingForAssignment(
    @TenantId() tenantId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.svc.getBriefingForAssignment(tenantId, assignmentId);
  }

  @Get('briefings/history')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getBriefingHistory(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getBriefingHistory(tenantId, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('briefings/incomplete')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  getIncompleteBriefings(@TenantId() tenantId: string) {
    return this.svc.getIncompleteBriefings(tenantId);
  }
}
