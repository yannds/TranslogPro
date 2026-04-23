/**
 * PlatformConfigController
 *
 *   GET    /platform/config                          → registre + valeurs courantes
 *   PATCH  /platform/config                          → batch update [{ key, value }, …]
 *   DELETE /platform/config/:key                     → reset à la valeur par défaut
 *
 *   GET    /platform/config/routing/key-status       → { google: bool, mapbox: bool }
 *   PUT    /platform/config/routing/key/:provider    → { apiKey } → Vault
 *   DELETE /platform/config/routing/key/:provider    → supprime la clé du Vault
 *
 * Permission : control.platform.config.manage.global (SUPER_ADMIN).
 */
import {
  BadRequestException,
  Body, Controller, Delete, Get, Inject, Param, Patch, Put, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PlatformConfigService } from './platform-config.service';
import { PermissionGuard } from '../../core/iam/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { SECRET_SERVICE, ISecretService } from '../../infrastructure/secret/interfaces/secret.interface';

type AuthedReq = Request & { user?: { id?: string } };

const ROUTING_PROVIDERS = ['google', 'mapbox'] as const;
type RoutingProvider = typeof ROUTING_PROVIDERS[number];

const VAULT_PATHS: Record<RoutingProvider, string> = {
  google: 'platform/google-maps',
  mapbox: 'platform/mapbox',
};

@Controller('platform/config')
@UseGuards(PermissionGuard)
@RequirePermission(Permission.PLATFORM_CONFIG_MANAGE_GLOBAL)
export class PlatformConfigController {
  constructor(
    private readonly svc: PlatformConfigService,
    @Inject(SECRET_SERVICE) private readonly secrets: ISecretService,
  ) {}

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

  // ── Routing API keys (Vault) ────────────────────────────────────────────────

  /**
   * GET /platform/config/routing/key-status
   * Retourne si chaque provider a une clé API provisionnée dans Vault.
   * Ne retourne jamais la clé elle-même.
   */
  @Get('routing/key-status')
  async routingKeyStatus() {
    const check = async (provider: RoutingProvider): Promise<boolean> => {
      try {
        await this.secrets.getSecret(VAULT_PATHS[provider], 'API_KEY');
        return true;
      } catch {
        return false;
      }
    };
    const [google, mapbox] = await Promise.all([check('google'), check('mapbox')]);
    return { google, mapbox };
  }

  /**
   * PUT /platform/config/routing/key/:provider
   * Injecte la clé API dans Vault (chemin platform/{google-maps|mapbox}).
   */
  @Put('routing/key/:provider')
  async setRoutingKey(
    @Param('provider') provider: string,
    @Body() body: { apiKey: string },
  ) {
    if (!ROUTING_PROVIDERS.includes(provider as RoutingProvider)) {
      throw new BadRequestException(`Provider invalide. Valeurs acceptées : ${ROUTING_PROVIDERS.join(', ')}`);
    }
    if (!body?.apiKey || typeof body.apiKey !== 'string' || body.apiKey.trim().length < 10) {
      throw new BadRequestException('apiKey manquante ou trop courte');
    }
    await this.secrets.putSecret(VAULT_PATHS[provider as RoutingProvider], { API_KEY: body.apiKey.trim() });
    return { ok: true, provider };
  }

  /**
   * DELETE /platform/config/routing/key/:provider
   * Supprime la clé API du Vault (pour réinitialiser).
   */
  @Delete('routing/key/:provider')
  async deleteRoutingKey(@Param('provider') provider: string) {
    if (!ROUTING_PROVIDERS.includes(provider as RoutingProvider)) {
      throw new BadRequestException(`Provider invalide. Valeurs acceptées : ${ROUTING_PROVIDERS.join(', ')}`);
    }
    try {
      await this.secrets.deleteSecret(VAULT_PATHS[provider as RoutingProvider]);
    } catch {
      // Pas de clé à supprimer — pas d'erreur
    }
    return { ok: true, provider };
  }
}
