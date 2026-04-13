/**
 * WorkflowMarketplaceController
 *
 * Routes marketplace accessibles :
 *   GET    /workflow-marketplace/browse          — catalogue public (no tenantId requis)
 *   GET    /workflow-marketplace/categories      — liste des catégories
 *   GET    /tenants/:tenantId/workflow-marketplace/blueprints/:id/export
 *   POST   /tenants/:tenantId/workflow-marketplace/blueprints/import
 *   POST   /tenants/:tenantId/workflow-marketplace/blueprints/:id/publish
 *   DELETE /tenants/:tenantId/workflow-marketplace/blueprints/:id/publish (unpublish)
 */
import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { WorkflowMarketplaceService } from './workflow-marketplace.service';
import { RequirePermission }          from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission }                 from '../../common/constants/permissions';
import { ImportBlueprintDto }         from './dto/create-blueprint.dto';

// ─── Routes marketplace publiques ────────────────────────────────────────────

@Controller('workflow-marketplace')
export class WorkflowMarketplacePublicController {
  constructor(private readonly marketplace: WorkflowMarketplaceService) {}

  @Get('browse')
  @RequirePermission(Permission.WORKFLOW_MARKETPLACE_READ)
  browse(
    @Query('entityType') entityType?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search')     search?:     string,
  ) {
    return this.marketplace.browseMarketplace({ entityType, categoryId, search });
  }

  @Get('categories')
  @RequirePermission(Permission.WORKFLOW_MARKETPLACE_READ)
  listCategories() {
    return this.marketplace.listCategories();
  }
}

// ─── Routes marketplace scoped par tenant ────────────────────────────────────

@Controller('tenants/:tenantId/workflow-marketplace')
export class WorkflowMarketplaceTenantController {
  constructor(private readonly marketplace: WorkflowMarketplaceService) {}

  @Get('blueprints/:blueprintId/export')
  @RequirePermission(Permission.WORKFLOW_MARKETPLACE_PUBLISH)
  exportBlueprint(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.marketplace.exportBlueprint(blueprintId, tenantId);
  }

  @Post('blueprints/import')
  @RequirePermission(Permission.WORKFLOW_BLUEPRINT_IMPORT)
  importBlueprint(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      ImportBlueprintDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.marketplace.importBlueprint(tenantId, dto, actor.id);
  }

  @Post('blueprints/:blueprintId/publish')
  @RequirePermission(Permission.WORKFLOW_MARKETPLACE_PUBLISH)
  publish(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.marketplace.publish(blueprintId, tenantId, actor.id);
  }

  @Delete('blueprints/:blueprintId/publish')
  @RequirePermission(Permission.WORKFLOW_MARKETPLACE_PUBLISH)
  unpublish(
    @Param('tenantId')    tenantId:    string,
    @Param('blueprintId') blueprintId: string,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.marketplace.unpublish(blueprintId, tenantId, actor.id);
  }
}
