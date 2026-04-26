/**
 * PlatformConfigController
 *
 *   GET    /platform/config                          → registre + valeurs courantes
 *   PATCH  /platform/config                          → batch update [{ key, value }, …]
 *   DELETE /platform/config/:key                     → reset à la valeur par défaut
 *
 *   GET    /platform/config/routing/key-status       → { google, googleJs, mapbox } (booléens)
 *   PUT    /platform/config/routing/key/:provider    → { apiKey?, jsApiKey? } → Vault (merge non-destructif)
 *   DELETE /platform/config/routing/key/:provider    → supprime la clé du Vault
 *
 * Provider `google` accepte deux champs distincts :
 *   - apiKey   → API_KEY    (server-side : Geocoding, Directions)
 *   - jsApiKey → JS_API_KEY (browser-side : Maps JavaScript API + Places)
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
   * Pour google : deux champs distincts (server API_KEY + browser JS_API_KEY).
   * Ne retourne jamais la clé elle-même.
   */
  @Get('routing/key-status')
  async routingKeyStatus() {
    const checkField = async (provider: RoutingProvider, field: string): Promise<boolean> => {
      try {
        const v = await this.secrets.getSecret(VAULT_PATHS[provider], field);
        return typeof v === 'string' && v.trim().length > 0;
      } catch {
        return false;
      }
    };
    const [google, googleJs, mapbox] = await Promise.all([
      checkField('google', 'API_KEY'),
      checkField('google', 'JS_API_KEY'),
      checkField('mapbox', 'API_KEY'),
    ]);
    return { google, googleJs, mapbox };
  }

  /**
   * PUT /platform/config/routing/key/:provider
   * Injecte la/les clé(s) API dans Vault (chemin platform/{google-maps|mapbox}).
   *
   * Body :
   *   - { apiKey }                    → écrase API_KEY
   *   - { jsApiKey }                  → ajoute/met à jour JS_API_KEY (google uniquement, préserve API_KEY)
   *   - { apiKey, jsApiKey }          → écrit les deux d'un coup
   *
   * Au moins un des deux champs est requis. Pour mapbox, seul `apiKey` est accepté.
   */
  @Put('routing/key/:provider')
  async setRoutingKey(
    @Param('provider') provider: string,
    @Body() body: { apiKey?: string; jsApiKey?: string },
  ) {
    if (!ROUTING_PROVIDERS.includes(provider as RoutingProvider)) {
      throw new BadRequestException(`Provider invalide. Valeurs acceptées : ${ROUTING_PROVIDERS.join(', ')}`);
    }

    const apiKey   = typeof body?.apiKey   === 'string' ? body.apiKey.trim()   : '';
    const jsApiKey = typeof body?.jsApiKey === 'string' ? body.jsApiKey.trim() : '';

    if (!apiKey && !jsApiKey) {
      throw new BadRequestException('Au moins une clé requise (apiKey ou jsApiKey).');
    }
    if (apiKey && apiKey.length < 10) {
      throw new BadRequestException('apiKey trop courte');
    }
    if (jsApiKey && jsApiKey.length < 10) {
      throw new BadRequestException('jsApiKey trop courte');
    }
    if (jsApiKey && provider !== 'google') {
      throw new BadRequestException('jsApiKey n\'est accepté que pour le provider google');
    }

    const path = VAULT_PATHS[provider as RoutingProvider];

    // Merge non-destructif : on récupère l'objet existant pour préserver les champs non touchés.
    let existing: Record<string, string> = {};
    try {
      existing = await this.secrets.getSecretObject<Record<string, string>>(path);
    } catch {
      // Premier write : pas de secret existant.
    }

    const merged: Record<string, string> = { ...existing };
    if (apiKey)   merged.API_KEY    = apiKey;
    if (jsApiKey) merged.JS_API_KEY = jsApiKey;

    await this.secrets.putSecret(path, merged);
    return { ok: true, provider, fieldsUpdated: { apiKey: !!apiKey, jsApiKey: !!jsApiKey } };
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
