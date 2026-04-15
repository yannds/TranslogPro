import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import {
  StaffAssignmentService,
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from './staff-assignment.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';

/**
 * Endpoints CRUD StaffAssignment (Phase 3 — DESIGN_Staff_Assignment.md §6).
 *
 * Routes :
 *   POST   /tenants/:tid/staff/:userId/assignments        crée une affectation
 *   GET    /tenants/:tid/staff/:userId/assignments        liste les affectations d'un staff
 *   PATCH  /tenants/:tid/assignments/:id                  modifie
 *   PATCH  /tenants/:tid/assignments/:id/close            clôt
 *   GET    /tenants/:tid/assignments?role&agencyId        liste filtrée tenant-wide
 *   POST   /tenants/:tid/assignments/:id/agencies         ajoute couverture (multi-spécifique)
 *   DELETE /tenants/:tid/assignments/:id/agencies/:aid    retire couverture
 */
@Controller('tenants/:tenantId')
export class StaffAssignmentController {
  constructor(private readonly assignments: StaffAssignmentService) {}

  // ─── Sous-ressource d'un Staff ───────────────────────────────────────────

  @Post('staff/:userId/assignments')
  @RequirePermission(Permission.STAFF_MANAGE)
  create(
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignments.create(tenantId, userId, dto);
  }

  @Get('staff/:userId/assignments')
  @RequirePermission(Permission.STAFF_READ)
  listForStaff(@TenantId() tenantId: string, @Param('userId') userId: string) {
    return this.assignments.listForStaff(tenantId, userId);
  }

  // ─── Ressource racine assignments ────────────────────────────────────────

  @Get('assignments')
  @RequirePermission(Permission.STAFF_READ)
  list(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('role')     role?:     string,
    @Query('agencyId') agencyId?: string,
    @Query('status')   status?:   string,
  ) {
    // Scope agency : si l'acteur est limité à une agence, on force le filtre
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.assignments.list(tenantId, { role, agencyId: effectiveAgencyId, status });
  }

  @Patch('assignments/:id')
  @RequirePermission(Permission.STAFF_MANAGE)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignments.update(tenantId, id, dto);
  }

  @Patch('assignments/:id/close')
  @RequirePermission(Permission.STAFF_MANAGE)
  close(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.assignments.close(tenantId, id);
  }

  // ─── Multi-agences spécifiques (sous-ressource) ──────────────────────────

  @Post('assignments/:id/agencies')
  @RequirePermission(Permission.STAFF_MANAGE)
  addCoverageAgency(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('agencyId') agencyId: string,
  ) {
    return this.assignments.addCoverageAgency(tenantId, id, agencyId);
  }

  @Delete('assignments/:id/agencies/:agencyId')
  @RequirePermission(Permission.STAFF_MANAGE)
  removeCoverageAgency(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('agencyId') agencyId: string,
  ) {
    return this.assignments.removeCoverageAgency(tenantId, id, agencyId);
  }
}
