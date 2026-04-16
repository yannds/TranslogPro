import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { TenantService, CreateTenantDto, UpdateCompanyInfoDto, UpdateBusinessConfigDto } from './tenant.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
  ) {}

  // NOTE : GET /:tenantId/agencies a été déplacé dans AgencyController
  // (src/modules/agency/agency.controller.ts) avec la permission dédiée
  // AGENCY_READ_TENANT. CRM_READ_TENANT restait une permission inadaptée.

  @Post()
  @RequirePermission(Permission.TENANT_MANAGE)
  create(@Body() dto: CreateTenantDto) {
    return this.tenantService.create(dto);
  }

  @Get()
  @RequirePermission(Permission.TENANT_MANAGE)
  list() {
    return this.tenantService.list();
  }

  @Get(':id')
  @RequirePermission(Permission.TENANT_MANAGE)
  findOne(@Param('id') id: string) {
    return this.tenantService.findById(id);
  }

  @Patch(':id/suspend')
  @RequirePermission(Permission.TENANT_MANAGE)
  suspend(@Param('id') id: string) {
    return this.tenantService.suspend(id);
  }

  // ── Informations société ───────────────────────────────────────────────────
  // Lecture PUBLIQUE volontairement — nécessaire au bootstrap i18n/branding
  // côté frontend avant l'authentification (identique au /brand endpoint).
  // Aucune donnée sensible exposée (name, slug, lang, tz, currency, rccm, phone).

  @Get(':id/company')
  getCompany(@Param('id') id: string) {
    return this.tenantService.getCompanyInfo(id);
  }

  @Patch(':id/company')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  updateCompany(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyInfoDto,
  ) {
    return this.tenantService.updateCompanyInfo(id, dto);
  }

  /**
   * Configuration agrégée — utilisée par TenantConfigProvider au bootstrap
   * frontend pour pré-remplir i18n, brand, devise en une seule requête.
   */
  @Get(':id/config')
  getConfig(@Param('id') id: string) {
    return this.tenantService.getAggregatedConfig(id);
  }

  // ── Business config ─────────────────────────────────────────────────────────

  @Get(':id/business-config')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  getBusinessConfig(@Param('id') id: string) {
    return this.tenantService.getBusinessConfig(id);
  }

  @Patch(':id/business-config')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  updateBusinessConfig(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessConfigDto,
  ) {
    return this.tenantService.updateBusinessConfig(id, dto);
  }
}
