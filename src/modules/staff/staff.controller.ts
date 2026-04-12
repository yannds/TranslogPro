import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { StaffService, CreateStaffDto } from './staff.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';

@Controller('tenants/:tenantId/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @RequirePermission(Permission.STAFF_MANAGE)
  create(@TenantId() tenantId: string, @Body() dto: CreateStaffDto) {
    return this.staffService.create(tenantId, dto);
  }

  @Get()
  @RequirePermission(Permission.STAFF_READ)
  findAll(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('agencyId') agencyId?: string,
  ) {
    // scope dérivé par PermissionGuard depuis la permission string — zéro hardcode de rôle
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.staffService.findAll(tenantId, effectiveAgencyId);
  }

  @Get(':userId')
  @RequirePermission(Permission.STAFF_READ)
  findOne(@TenantId() tenantId: string, @Param('userId') userId: string) {
    return this.staffService.findOne(tenantId, userId);
  }

  @Patch(':userId/suspend')
  @RequirePermission(Permission.STAFF_MANAGE)
  suspend(@TenantId() tenantId: string, @Param('userId') userId: string) {
    return this.staffService.suspend(tenantId, userId);
  }
}
