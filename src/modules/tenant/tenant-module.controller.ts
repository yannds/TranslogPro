import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { TenantModuleService, TenantModuleDto } from './tenant-module.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

class ToggleModuleDto {
  @IsBoolean()
  isActive!: boolean;
}

/**
 * TenantModuleController
 *
 * Routes scopées par tenant : /api/v1/tenants/:tenantId/modules/…
 *
 *   GET   /                — liste des modules installés (actifs + inactifs)
 *   PATCH /:moduleKey      — active ou désactive un module
 *
 * Toutes les routes exigent `control.module.install.tenant`.
 */
@Controller({ version: '1', path: 'tenants/:tenantId/modules' })
export class TenantModuleController {
  constructor(private readonly modules: TenantModuleService) {}

  @Get()
  @RequirePermission(Permission.MODULE_INSTALL_TENANT)
  list(@Param('tenantId') tenantId: string): Promise<TenantModuleDto[]> {
    return this.modules.listForTenant(tenantId);
  }

  @Patch(':moduleKey')
  @RequirePermission(Permission.MODULE_INSTALL_TENANT)
  toggle(
    @Param('tenantId')  tenantId:  string,
    @Param('moduleKey') moduleKey: string,
    @Body()             dto:       ToggleModuleDto,
  ): Promise<TenantModuleDto> {
    return this.modules.setActive(tenantId, moduleKey, dto.isActive);
  }
}
