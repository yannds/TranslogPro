import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { CrmService, CreateCampaignDto, UpdateCampaignDto, CreateCustomerDto, UpdateCustomerDto } from './crm.service';
import { CustomerRecommendationService } from './customer-recommendation.service';
import { CustomerSegmentService } from './customer-segment.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/crm')
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly recommend:  CustomerRecommendationService,
    private readonly segments:   CustomerSegmentService,
  ) {}

  // ─── Customers CRM canoniques (v2 — inclut shadow profiles) ────────────────

  @Get('contacts')
  @RequirePermission([Permission.CRM_READ_TENANT, Permission.CRM_READ_AGENCY])
  listContacts(
    @TenantId() tenantId: string,
    @Query('segment') segment?: 'all' | 'shadow' | 'registered',
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crmService.listCrmCustomers(
      tenantId,
      { segment, q },
      page  ? parseInt(page,  10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('contacts/:customerId/history')
  @RequirePermission([Permission.CRM_READ_TENANT, Permission.CRM_READ_AGENCY])
  getContactHistory(
    @TenantId() tenantId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.crmService.getCustomerHistory(tenantId, customerId);
  }

  // ─── Phase 4 — Recommandations (préférences dérivées à la volée) ───────────

  @Get('contacts/:customerId/recommendations')
  @RequirePermission([Permission.CRM_READ_TENANT, Permission.CRM_READ_AGENCY])
  getRecommendations(
    @TenantId() tenantId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.recommend.byCustomer(tenantId, customerId);
  }

  /**
   * Lookup inverse pour la caisse : recherche un Customer par téléphone et
   * renvoie les recommandations. Null si aucun Customer matche (pas d'erreur,
   * comportement silencieux pour l'UI).
   */
  @Get('lookup')
  @RequirePermission([Permission.CRM_READ_TENANT, Permission.CRM_READ_AGENCY])
  lookupByPhone(
    @TenantId() tenantId: string,
    @Query('phone') phone: string,
  ) {
    if (!phone || !phone.trim()) return Promise.resolve(null);
    return this.recommend.byPhone(tenantId, phone);
  }

  // ─── Phase 5 — Segments CRM ────────────────────────────────────────────────

  /**
   * Recalcule les segments auto (VIP, FREQUENT, NEW, DORMANT) pour tous les
   * Customers du tenant. Idempotent. Accessible aux admins qui peuvent
   * écrire sur le CRM.
   */
  @Post('segments/recompute')
  @RequirePermission(Permission.CRM_WRITE_TENANT)
  recomputeSegments(@TenantId() tenantId: string) {
    return this.segments.recomputeForTenant(tenantId);
  }

  // ─── Customers (v1 — legacy basé sur User userType='CUSTOMER') ─────────────

  @Get('customers')
  @RequirePermission(Permission.CRM_READ_TENANT)
  listCustomers(
    @TenantId() tenantId: string,
    @Query('agencyId') agencyId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crmService.listCustomers(
      tenantId,
      agencyId,
      page  ? parseInt(page,  10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('customers/:userId')
  @RequirePermission(Permission.CRM_READ_TENANT)
  getCustomer(
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.crmService.getCustomer(tenantId, userId);
  }

  @Post('customers')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  createCustomer(
    @TenantId() tenantId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.crmService.createCustomer(tenantId, dto);
  }

  @Patch('customers/:userId')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  updateCustomer(
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.crmService.updateCustomer(tenantId, userId, dto);
  }

  @Delete('customers/:userId')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  archiveCustomer(
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.crmService.archiveCustomer(tenantId, userId);
  }

  // ─── Campaigns ───────────────────────────────────────────────────────────────

  @Post('campaigns')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  createCampaign(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.crmService.createCampaign(tenantId, user.id, dto);
  }

  @Get('campaigns')
  @RequirePermission(Permission.CRM_READ_TENANT)
  listCampaigns(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
  ) {
    return this.crmService.listCampaigns(tenantId, status);
  }

  @Get('campaigns/:id')
  @RequirePermission(Permission.CRM_READ_TENANT)
  getCampaign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.crmService.getCampaign(tenantId, id);
  }

  @Patch('campaigns/:id')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  updateCampaign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.crmService.updateCampaign(tenantId, id, dto);
  }

  @Delete('campaigns/:id')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  deleteCampaign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.crmService.deleteCampaign(tenantId, id);
  }

  @Get('campaigns/:id/audience')
  @RequirePermission(Permission.CAMPAIGN_MANAGE_TENANT)
  estimateAudience(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.crmService.estimateAudience(tenantId, id);
  }
}
