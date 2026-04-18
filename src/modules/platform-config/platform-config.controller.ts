/**
 * PlatformConfigController
 *
 *   GET    /platform/config                → registre + valeurs courantes
 *   PATCH  /platform/config                → batch update [{ key, value }, …]
 *   DELETE /platform/config/:key           → reset à la valeur par défaut
 *
 * Permission : control.platform.config.manage.global (SUPER_ADMIN).
 */
import {
  Body, Controller, Delete, Get, Param, Patch, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PlatformConfigService } from './platform-config.service';
import { PermissionGuard } from '../../core/iam/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

type AuthedReq = Request & { user?: { id?: string } };

@Controller('platform/config')
@UseGuards(PermissionGuard)
@RequirePermission(Permission.PLATFORM_CONFIG_MANAGE_GLOBAL)
export class PlatformConfigController {
  constructor(private readonly svc: PlatformConfigService) {}

  @Get()
  list() {
    return this.svc.getAll();
  }

  @Patch()
  updateBatch(
    @Body() body: { entries: Array<{ key: string; value: unknown }> },
    @Req()  req:  AuthedReq,
  ) {
    return this.svc.setBatch(body.entries ?? [], req.user?.id ?? null);
  }

  @Delete(':key')
  reset(@Param('key') key: string) {
    return this.svc.reset(key);
  }
}
