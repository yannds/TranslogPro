/**
 * PlatformEmailController
 *
 * Endpoints admin plateforme pour la vue "Email" du dashboard :
 *   GET  /platform/email/providers
 *   GET  /platform/email/providers/:key/credentials   — lecture (secret masqué)
 *   PUT  /platform/email/providers/:key/credentials   — écriture Vault + healthcheck
 *   POST /platform/email/providers/:key/healthcheck
 *
 * Tout est réservé aux agents du tenant plateforme avec la permission
 * `control.platform.config.manage.global`. Le sélecteur de provider actif
 * (EMAIL_PROVIDER) reste piloté par env var + redéploiement.
 */

import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { PlatformEmailService } from './platform-email.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import type { EmailProviderName } from '../../infrastructure/notification/interfaces/email.interface';

@Controller({ version: '1', path: 'platform/email' })
@RequirePermission(Permission.PLATFORM_CONFIG_MANAGE_GLOBAL)
export class PlatformEmailController {
  constructor(private readonly email: PlatformEmailService) {}

  @Get('providers')
  list() {
    return this.email.list();
  }

  @Get('providers/:key/credentials')
  getCredentials(@Param('key') key: EmailProviderName) {
    return this.email.getCredentials(key);
  }

  @Put('providers/:key/credentials')
  putCredentials(
    @Param('key') key: EmailProviderName,
    @Body() body: Record<string, string | number | boolean>,
  ) {
    return this.email.setCredentials(key, body ?? {});
  }

  @Post('providers/:key/healthcheck')
  runHealthcheck(@Param('key') key: EmailProviderName) {
    return this.email.runHealthcheck(key);
  }
}
