/**
 * Endpoints super-admin pour gérer les providers de paiement au niveau plateforme.
 *
 *   GET   /platform/integrations                         — liste + état
 *   PATCH /platform/integrations/:providerKey            — change mode (DISABLED|SANDBOX|LIVE)
 *   PUT   /platform/integrations/:providerKey/credentials — sauve secrets dans Vault
 *   POST  /platform/integrations/:providerKey/healthcheck — sonde le provider
 *
 * Permission : PLATFORM_BILLING_MANAGE_GLOBAL.
 *
 * Rappel : pour un tenant, on a déjà /tenants/:id/settings/integrations.
 * Ces routes-ci agissent sur les rows `tenantId = null` (defaults plateforme,
 * dont héritent tous les tenants qui n'ont pas configuré leurs propres clés).
 */
import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { Permission } from '../../common/constants/permissions';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import {
  PlatformIntegrationsService,
  UpdatePlatformProviderModeDto,
  SavePlatformCredentialsDto,
} from './platform-integrations.service';

@Controller({ version: '1', path: 'platform/integrations' })
@RequirePermission(Permission.PLATFORM_BILLING_MANAGE_GLOBAL)
export class PlatformIntegrationsController {
  constructor(private readonly service: PlatformIntegrationsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Patch(':providerKey')
  updateMode(
    @Param('providerKey') providerKey: string,
    @Body()               dto:         UpdatePlatformProviderModeDto,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.service.updateMode(providerKey, dto, actor.id);
  }

  @Put(':providerKey/credentials')
  saveCredentials(
    @Param('providerKey') providerKey: string,
    @Body()               dto:         SavePlatformCredentialsDto,
    @CurrentUser()        actor:       CurrentUserPayload,
  ) {
    return this.service.saveCredentials(providerKey, dto, actor.id);
  }

  @Post(':providerKey/healthcheck')
  runHealthcheck(@Param('providerKey') providerKey: string) {
    return this.service.runHealthcheck(providerKey);
  }
}
