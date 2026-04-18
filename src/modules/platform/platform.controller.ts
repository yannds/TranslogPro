/**
 * PlatformController — endpoints réservés au staff interne TranslogPro.
 *
 * Routes :
 *   POST   /platform/bootstrap         Clé secrète — crée le premier SUPER_ADMIN (BootstrapGuard)
 *   POST   /platform/staff             Crée un compte SUPER_ADMIN | SUPPORT_L1 | SUPPORT_L2
 *   GET    /platform/staff             Liste le staff plateforme
 *   DELETE /platform/staff/:id         Supprime un compte staff
 *
 * Sécurité :
 *   - /bootstrap : BootstrapGuard (X-Bootstrap-Key header + aucun SA existant)
 *   - Autres : @RequirePermission(PLATFORM_STAFF_GLOBAL) — SUPER_ADMIN uniquement
 *   - ImpersonationGuard s'applique globalement — toujours avant PermissionGuard
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { PlatformRole } from './dto/create-platform-staff.dto';
import { PlatformService }       from './platform.service';
import { BootstrapGuard }        from './guards/bootstrap.guard';
import { BootstrapDto }          from './dto/bootstrap.dto';
import { CreatePlatformStaffDto } from './dto/create-platform-staff.dto';
import { RequirePermission }     from '../../common/decorators/require-permission.decorator';
import { CurrentUser }           from '../../common/decorators/current-user.decorator';
import { CurrentUserPayload }    from '../../common/decorators/current-user.decorator';
import { Permission }            from '../../common/constants/permissions';

class UpdateStaffRoleDto {
  @IsEnum(PlatformRole)
  roleName!: PlatformRole;
}

@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  // ─── Bootstrap (une seule fois) ─────────────────────────────────────────────

  /**
   * Crée le premier SUPER_ADMIN.
   * Protégé uniquement par X-Bootstrap-Key (pas d'auth JWT requis).
   * Une fois le premier SUPER_ADMIN créé, cet endpoint retourne systématiquement 403.
   */
  @Post('bootstrap')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(BootstrapGuard)
  bootstrap(@Body() dto: BootstrapDto) {
    return this.platform.bootstrap(dto);
  }

  // ─── Gestion du staff plateforme ────────────────────────────────────────────

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.PLATFORM_STAFF_GLOBAL)
  createStaff(
    @Body() dto: CreatePlatformStaffDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.platform.createStaff(dto, actor);
  }

  @Get('staff')
  @RequirePermission(Permission.PLATFORM_STAFF_GLOBAL)
  listStaff() {
    return this.platform.listStaff();
  }

  @Patch('staff/:id/role')
  @RequirePermission(Permission.PLATFORM_STAFF_GLOBAL)
  updateStaffRole(
    @Param('id') id: string,
    @Body() dto: UpdateStaffRoleDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.platform.updateStaffRole(id, dto.roleName, actor);
  }

  @Delete('staff/:id')
  @RequirePermission(Permission.PLATFORM_STAFF_GLOBAL)
  removeStaff(
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.platform.removeStaff(id, actor);
  }
}
