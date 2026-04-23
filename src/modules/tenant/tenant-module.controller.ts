import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsBoolean, IsObject } from 'class-validator';
import { TenantModuleService, TenantModuleDto } from './tenant-module.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/constants/permissions';

class ToggleModuleDto {
  @IsBoolean()
  isActive!: boolean;
}

class UpdateModuleConfigDto {
  @IsObject()
  config!: Record<string, unknown>;
}

export interface TenantModulesResponse {
  modules:       TenantModuleDto[];
  /** moduleKey[] verrouillés par la plateforme — toggle grisé côté tenant. */
  platformGated: string[];
}

/**
 * TenantModuleController
 *
 * Routes scopées par tenant : /api/v1/tenants/:tenantId/modules/…
 *
 *   GET   /                — liste des modules installés (actifs + inactifs) +
 *                            platformGated (modules non débloqués par la plateforme)
 *   PATCH /:moduleKey      — active ou désactive un module
 *
 * Toutes les routes exigent `control.module.install.tenant`.
 */
@Controller({ version: '1', path: 'tenants/:tenantId/modules' })
export class TenantModuleController {
  constructor(private readonly modules: TenantModuleService) {}

  @Get()
  @RequirePermission(Permission.MODULE_INSTALL_TENANT)
  async list(@Param('tenantId') tenantId: string): Promise<TenantModulesResponse> {
    const [modules, platformGated] = await Promise.all([
      this.modules.listForTenant(tenantId),
      this.modules.getPlatformGated(),
    ]);
    return { modules, platformGated };
  }

  @Patch(':moduleKey')
  @RequirePermission(Permission.MODULE_INSTALL_TENANT)
  toggle(
    @Param('tenantId')  tenantId:  string,
    @Param('moduleKey') moduleKey: string,
    @Body()             dto:       ToggleModuleDto,
    @CurrentUser()      user:      CurrentUserPayload,
  ): Promise<TenantModuleDto> {
    return this.modules.setActive(tenantId, moduleKey, dto.isActive, user.id);
  }

  @Patch(':moduleKey/config')
  @RequirePermission(Permission.MODULE_INSTALL_TENANT)
  updateConfig(
    @Param('tenantId')  tenantId:  string,
    @Param('moduleKey') moduleKey: string,
    @Body()             dto:       UpdateModuleConfigDto,
    @CurrentUser()      user:      CurrentUserPayload,
  ): Promise<TenantModuleDto> {
    return this.modules.updateConfig(tenantId, moduleKey, dto.config, user.id);
  }
}
