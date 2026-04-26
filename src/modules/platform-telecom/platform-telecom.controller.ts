/**
 * PlatformTelecomController
 *
 * Endpoints admin plateforme pour la vue "Telecom" du dashboard :
 *   GET  /platform/telecom/providers
 *   GET  /platform/telecom/providers/:key/credentials   — lecture (secret masqué)
 *   PUT  /platform/telecom/providers/:key/credentials   — écriture Vault + healthcheck
 *   POST /platform/telecom/providers/:key/healthcheck
 *
 * Tout est réservé aux agents du tenant plateforme avec la permission
 * `control.platform.config.manage.global` (même garde que platform-email).
 */

import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { PlatformTelecomService, TelecomProviderName } from './platform-telecom.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'platform/telecom' })
@RequirePermission(Permission.PLATFORM_CONFIG_MANAGE_GLOBAL)
export class PlatformTelecomController {
  constructor(private readonly telecom: PlatformTelecomService) {}

  @Get('providers')
  list() {
    return this.telecom.list();
  }

  @Get('providers/:key/credentials')
  getCredentials(@Param('key') key: TelecomProviderName) {
    return this.telecom.getCredentials(key);
  }

  @Put('providers/:key/credentials')
  putCredentials(
    @Param('key') key: TelecomProviderName,
    @Body() body: Record<string, string | number | boolean>,
  ) {
    return this.telecom.setCredentials(key, body ?? {});
  }

  @Post('providers/:key/healthcheck')
  runHealthcheck(@Param('key') key: TelecomProviderName) {
    return this.telecom.runHealthcheck(key);
  }
}
