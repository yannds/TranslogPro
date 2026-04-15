import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { CrmService, CreateCampaignDto, UpdateCampaignDto, CreateCustomerDto, UpdateCustomerDto } from './crm.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  // ─── Customers ───────────────────────────────────────────────────────────────

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
