import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { TemplatesService }                from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto, DuplicateTemplateDto } from './dto/create-template.dto';
import { PermissionGuard }                 from '../../core/iam/guards/permission.guard';
import { RequirePermission }               from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission }                      from '../../common/constants/permissions';

@UseGuards(PermissionGuard)
@Controller('tenants/:tenantId/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Post()
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateTemplateDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.create(tenantId, dto, actor);
  }

  @Get()
  @RequirePermission(Permission.TEMPLATE_READ_AGENCY)
  findAll(@Param('tenantId') tenantId: string) {
    return this.templates.findAll(tenantId);
  }

  /**
   * Liste les templates système disponibles (inspirations / bases de départ).
   * IMPORTANT : déclarer cette route AVANT @Get(':id') — sinon "system" matche le paramètre :id.
   */
  @Get('system')
  @RequirePermission(Permission.TEMPLATE_READ_AGENCY)
  findSystem(
    @Param('tenantId') _tenantId: string,
    @Query('docType') docType?: string,
  ) {
    return this.templates.findSystemTemplates(docType);
  }

  @Get(':id')
  @RequirePermission(Permission.TEMPLATE_READ_AGENCY)
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templates.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.update(tenantId, id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.TEMPLATE_DELETE_AGENCY)
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templates.remove(tenantId, id);
  }

  /** URL présignée pour uploader la source .hbs directement vers MinIO */
  @Get(':id/upload-url')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  getUploadUrl(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templates.getUploadUrl(tenantId, id);
  }

  // ─── Duplication ──────────────────────────────────────────────────────────

  /**
   * Duplique un template (système ou tenant) pour créer une version personnalisable.
   * POST /tenants/:tenantId/templates/:id/duplicate
   */
  @Post(':id/duplicate')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  duplicate(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: DuplicateTemplateDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.duplicate(tenantId, id, dto, actor);
  }

  // ─── Pack de démarrage ────────────────────────────────────────────────────

  /**
   * Restaure le pack de démarrage : copies éditables des templates système de base.
   * Idempotent — ne touche pas aux templates existants (même slug).
   * POST /tenants/:tenantId/templates/restore-starter-pack
   */
  @Post('restore-starter-pack')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  restoreStarterPack(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.restoreStarterPack(tenantId, actor);
  }

  // ─── pdfme Designer ───────────────────────────────────────────────────────

  /**
   * Sauvegarde le schéma pdfme édité par le Designer frontend.
   * PUT /tenants/:tenantId/templates/:id/schema
   * Body : { schemaJson: Template (objet pdfme) }
   */
  @Put(':id/schema')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  savePdfmeSchema(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: { schemaJson: Record<string, unknown> },
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.savePdfmeSchema(tenantId, id, body.schemaJson, actor);
  }

  /**
   * Retourne le schéma pdfme résolu (tenant ou système) pour le Designer.
   * GET /tenants/:tenantId/templates/:id/schema
   */
  @Get(':id/schema')
  @RequirePermission(Permission.TEMPLATE_READ_AGENCY)
  async getPdfmeSchema(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    const template = await this.templates.findOne(tenantId, id);
    return { schemaJson: template.schemaJson, engine: template.engine };
  }
}
