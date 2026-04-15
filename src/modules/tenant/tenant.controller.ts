import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { TenantService, CreateTenantDto } from './tenant.service';
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
}
