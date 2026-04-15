/**
 * WorkflowStudioController
 *
 * Routes scopées par tenant : /tenants/:tenantId/workflow-studio/…
 *
 * Endpoints :
 *   GET    /graph/:entityType          — graphe actif du tenant
 *   PUT    /graph                      — sauvegarder graphe édité
 *   GET    /graph/:entityType/reset    — reset au blueprint installé
 *   GET    /entity-types               — liste des entityTypes configurés
 *   GET    /blueprints                 — liste des blueprints accessibles
 *   POST   /blueprints                 — créer un blueprint
 *   GET    /blueprints/:id             — détail d'un blueprint
 *   PUT    /blueprints/:id             — modifier un blueprint
 *   DELETE /blueprints/:id             — supprimer un blueprint
 *   POST   /blueprints/:id/install     — installer un blueprint
 *   POST   /simulate                   — simulation Live-Path
 */
import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
} from '@nestjs/common';
import { WorkflowStudioService }      from './workflow-studio.service';
import { SimulationSessionService, CreateSessionDto } from './simulation-session.service';
import { RequirePermission }          from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission }                 from '../../common/constants/permissions';
import { CreateBlueprintDto, UpdateBlueprintDto, WorkflowGraphDto } from './dto/create-blueprint.dto';
import { SimulateWorkflowDto }        from './dto/simulate-workflow.dto';

@Controller('tenants/:tenantId/workflow-studio')
export class WorkflowStudioController {
  constructor(
    private readonly studio: WorkflowStudioService,
    private readonly sessions: SimulationSessionService,
  ) {}

  // ─── Graphe actif ────────────────────────────────────────────────────────────

  @Get('entity-types')
  @RequirePermission(Permission.WORKFLOW_STUDIO_READ_TENANT)
  listEntityTypes(@Param('tenantId') tenantId: string) {
    return this.studio.listEntityTypes(tenantId);
  }

  @Get('graph/:entityType')
  @RequirePermission(Permission.WORKFLOW_STUDIO_READ_TENANT)
  getTenantGraph(
    @Param('tenantId')   tenantId:   string,
    @Param('entityType') entityType: string,
  ) {
    return this.studio.getTenantGraph(tenantId, entityType);
  }

  @Get('graph/:entityType/metadata')
  @RequirePermission(Permission.WORKFLOW_STUDIO_READ_TENANT)
  getEntityTypeMetadata(
    @Param('tenantId')   tenantId:   string,
    @Param('entityType') entityType: string,
  ) {
    return this.studio.getEntityTypeMetadata(tenantId, entityType);
  }

  @Get('suggestions')
  @RequirePermission(Permission.WORKFLOW_STUDIO_READ_TENANT)
  getSuggestions(
    @Param('tenantId')    tenantId:   string,
    @Query('entityType')  entityType: string,
    @Query('action')      action:     string,
  ) {
    return this.studio.getSuggestions(tenantId, entityType, action);
  }

  @Put('graph')
  @RequirePermission(Permission.WORKFLOW_STUDIO_WRITE_TENANT)
  saveTenantGraph(
    @Param('tenantId') tenantId: string,
    @Body()            body:     WorkflowGraphDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.studio.saveTenantGraph(tenantId, body, actor.id);
  }

  @Post('graph/:entityType/reset')
  @RequirePermission(Permission.WORKFLOW_STUDIO_WRITE_TENANT)
  resetToBlueprint(
    @Param('tenantId')   tenantId:   string,
    @Param('entityType') entityType: string,
    @CurrentUser()       actor:      CurrentUserPayload,
  ) {
    return this.studio.resetToBlueprint(tenantId, entityType, actor.id);
  }

  // ─── CRUD Blueprints ────────────────────────────────────────────────────────

  @Get('blueprints')
  @RequirePermission(Permission.WORKFLOW_STUDIO_READ_TENANT)
  listBlueprints(
    @Param('tenantId') tenantId:   string,
    @Query('entityType') entityType?: string,
  ) {
    return this.studio.listBlueprints(tenantId, entityType);
  }

  @Post('blueprints')
  @RequirePermission(Permission.WORKFLOW_STUDIO_WRITE_TENANT)
  createBlueprint(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      CreateBlueprintDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.studio.createBlueprint(tenantId, dto, actor.id);
  }

  @Get('blueprints/:blueprintId')
  @RequirePermission(Permission.WORKFLOW_STUDIO_READ_TENANT)
  getBlueprint(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
  ) {
    return this.studio.getBlueprint(blueprintId, tenantId);
  }

  @Put('blueprints/:blueprintId')
  @RequirePermission(Permission.WORKFLOW_STUDIO_WRITE_TENANT)
  updateBlueprint(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
    @Body()               dto:         UpdateBlueprintDto,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.studio.updateBlueprint(blueprintId, tenantId, dto, actor.id);
  }

  @Delete('blueprints/:blueprintId')
  @RequirePermission(Permission.WORKFLOW_STUDIO_WRITE_TENANT)
  deleteBlueprint(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
  ) {
    return this.studio.deleteBlueprint(blueprintId, tenantId);
  }

  @Post('blueprints/:blueprintId/install')
  @RequirePermission(Permission.WORKFLOW_BLUEPRINT_IMPORT)
  installBlueprint(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.studio.installBlueprint(blueprintId, tenantId, actor.id);
  }

  // ─── Simulation ─────────────────────────────────────────────────────────────

  @Post('simulate')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  simulate(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      SimulateWorkflowDto,
  ) {
    return this.studio.simulateWorkflow(tenantId, dto);
  }

  @Post('simulate/explore')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  explore(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      SimulateWorkflowDto,
  ) {
    return this.studio.exploreWorkflow(tenantId, dto);
  }

  // ─── Sessions breakpoint ─────────────────────────────────────────────────

  @Post('simulate/sessions')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  createSession(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      CreateSessionDto,
  ) {
    return this.sessions.createSession(tenantId, dto);
  }

  @Get('simulate/sessions/:sessionId')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  getSession(
    @Param('tenantId')  tenantId:  string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.getSession(tenantId, sessionId);
  }

  @Post('simulate/sessions/:sessionId/step')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  stepSession(
    @Param('tenantId')  tenantId:  string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.stepSession(tenantId, sessionId);
  }

  @Post('simulate/sessions/:sessionId/continue')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  continueSession(
    @Param('tenantId')  tenantId:  string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.continueSession(tenantId, sessionId);
  }

  @Delete('simulate/sessions/:sessionId')
  @RequirePermission(Permission.WORKFLOW_SIMULATE_TENANT)
  deleteSession(
    @Param('tenantId')  tenantId:  string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.deleteSession(tenantId, sessionId);
  }
}
