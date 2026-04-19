/**
 * PlatformEmailController
 *
 * Endpoints admin plateforme pour la vue "Email" du dashboard :
 *   GET  /platform/email/providers
 *   POST /platform/email/providers/:key/healthcheck
 *
 * Tout est réservé aux agents du tenant plateforme avec la permission
 * `control.platform.config.manage.global`. Aucune route n'écrit le sélecteur
 * de provider (piloté par env var + redéploiement uniquement).
 */

import { Controller, Get, Param, Post } from '@nestjs/common';
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

  @Post('providers/:key/healthcheck')
  runHealthcheck(@Param('key') key: EmailProviderName) {
    return this.email.runHealthcheck(key);
  }
}
