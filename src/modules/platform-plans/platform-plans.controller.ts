/**
 * PlatformPlansController
 *
 * Routes plateforme (SUPER_ADMIN) — CRUD plans :
 *   GET    /platform/plans
 *   GET    /platform/plans/:id
 *   POST   /platform/plans
 *   PATCH  /platform/plans/:id
 *   DELETE /platform/plans/:id
 *   POST   /platform/plans/:id/modules       { moduleKey }
 *   DELETE /platform/plans/:id/modules/:moduleKey
 *
 * Route catalogue (tenant admin auto-service) :
 *   GET /platform/plans/catalog              (perm data.tenant.plan.read.tenant)
 *
 * Toutes les routes sont protégées par @RequirePermission — le PermissionGuard
 * rejette tout acteur hors tenant plateforme pour les perms *.global.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PlatformPlansService } from './platform-plans.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('platform/plans')
export class PlatformPlansController {
  constructor(private readonly plans: PlatformPlansService) {}

  // ── Catalogue (tenants admin qui veulent choisir un plan) ───────────────
  @Get('catalog')
  @RequirePermission(Permission.TENANT_PLAN_READ_TENANT)
  catalog() {
    return this.plans.listCatalog();
  }

  // ── CRUD plateforme ──────────────────────────────────────────────────────
  @Get()
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  list() {
    return this.plans.list();
  }

  @Get(':id')
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  get(@Param('id') id: string) {
    return this.plans.findById(id);
  }

  @Post()
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  create(@Body() dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  remove(@Param('id') id: string) {
    return this.plans.remove(id);
  }

  @Post(':id/modules')
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  attachModule(
    @Param('id') id: string,
    @Body() body: { moduleKey: string },
  ) {
    return this.plans.attachModule(id, body.moduleKey);
  }

  @Delete(':id/modules/:moduleKey')
  @RequirePermission(Permission.PLATFORM_PLANS_MANAGE_GLOBAL)
  detachModule(
    @Param('id') id: string,
    @Param('moduleKey') moduleKey: string,
  ) {
    return this.plans.detachModule(id, moduleKey);
  }
}
