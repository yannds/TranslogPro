import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { TenantService, CreateTenantDto } from './tenant.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
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
