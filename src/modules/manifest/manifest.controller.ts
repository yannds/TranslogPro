import { Controller, Get, Post, Patch, Param } from '@nestjs/common';
import { ManifestService } from './manifest.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/manifests')
export class ManifestController {
  constructor(private readonly manifestService: ManifestService) {}

  @Post('trips/:tripId')
  @RequirePermission(Permission.MANIFEST_GENERATE)
  generate(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.manifestService.generate(tenantId, tripId, actor);
  }

  @Patch(':id/sign')
  @RequirePermission(Permission.MANIFEST_SIGN)
  sign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.manifestService.sign(tenantId, id, actor);
  }

  @Get(':id/download')
  @RequirePermission(Permission.MANIFEST_READ)
  download(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manifestService.getDownloadUrl(tenantId, id);
  }

  @Get('trips/:tripId')
  @RequirePermission(Permission.MANIFEST_READ)
  findByTrip(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.manifestService.findByTrip(tenantId, tripId);
  }
}
