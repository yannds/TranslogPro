import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { TenantService, CreateTenantDto } from './tenant.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':tenantId/agencies')
  @RequirePermission(Permission.CRM_READ_TENANT)
  async listAgencies(@TenantId() tenantId: string) {
    return this.prisma.agency.findMany({
      where:   { tenantId },
      select:  { id: true, name: true, stationId: true },
      orderBy: { name: 'asc' },
    });
  }

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
