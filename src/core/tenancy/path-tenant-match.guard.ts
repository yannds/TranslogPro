/**
 * PathTenantMatchGuard — ferme la "passoire" cross-tenant sur les endpoints
 * dont le tenantId/slug vient du path (display écrans, portail public, track
 * colis, etc.).
 *
 * RÈGLE : si `req.resolvedHostTenant` est présent (Host appartient à un tenant
 * plateforme), alors tout `:tenantId` ou `:tenantSlug` dans le path DOIT
 * correspondre à ce tenant. Sinon → 403.
 *
 * POURQUOI :
 *   Les endpoints publics comme `/api/tenants/:tenantId/display` ou
 *   `/api/public/:tenantSlug/portal/config` prennent le tenant du path SANS
 *   vérifier qu'il corresponde au sous-domaine. Un attaquant sur
 *   tenanta.translog.test pouvait hitter /api/tenants/TENANTB_UUID/display
 *   et récupérer les données de B. Ce guard ferme ce vecteur.
 *
 * EXCEPTIONS LÉGITIMES :
 *   - Super-admin plateforme (req.user.tenantId == PLATFORM_TENANT_ID)
 *     → peut frapper n'importe quel tenant via impersonation ou outils
 *       d'administration.
 *   - Impersonation active (req.impersonation.targetTenantId == host.tenantId)
 *     → déjà filtré par ImpersonationGuard en amont, on re-valide ici.
 *   - Aucun host résolu (req.resolvedHostTenant absent)
 *     → cas tests Bearer token, health sans Host, domaine neutre — on laisse
 *       passer ; la sécurité est portée par les autres guards (Permission, …).
 *
 * RÈGLE GLOBALE (registered via APP_GUARD dans AppModule) : applicable à
 * toutes les routes. Les routes SANS paramètre tenantId/tenantSlug ne sont
 * pas impactées (le guard retourne true immédiatement).
 */

import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { PLATFORM_TENANT_ID } from './tenant-resolver.service';

@Injectable()
export class PathTenantMatchGuard implements CanActivate {
  private readonly logger = new Logger(PathTenantMatchGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const host = req.resolvedHostTenant;

    // Pas de host résolu → rien à vérifier ici (défense en profondeur ailleurs).
    if (!host) return true;

    // Extraire les params qui nous intéressent (NestJS les a déjà parsés).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = (req as any).params as Record<string, string> | undefined;
    const pathTenantId = params?.tenantId;
    const pathSlug     = params?.tenantSlug;

    // Aucun param tenant dans le path → rien à contraindre.
    if (!pathTenantId && !pathSlug) return true;

    // Super-admin plateforme : accès transverse légitime (SUPPORT, SA).
    if (req.user?.tenantId === PLATFORM_TENANT_ID) return true;

    // Impersonation : la target est validée contre host par ImpersonationGuard.
    // Si la target match le host, on accepte un path qui cible ce tenant.
    if (req.impersonation?.targetTenantId === host.tenantId) return true;

    // ── Check tenantId (UUID) ─────────────────────────────────────────────
    if (pathTenantId && pathTenantId !== host.tenantId) {
      this.logger.warn(
        `[PathTenantMatch] BLOCKED path=${req.path} ` +
        `path.tenantId=${pathTenantId} host.tenantId=${host.tenantId} ` +
        `host=${host.hostname} ip=${req.ip}`,
      );
      throw new ForbiddenException(
        'Cross-tenant request rejected — path tenantId does not match host',
      );
    }

    // ── Check tenantSlug (portail public) ─────────────────────────────────
    if (pathSlug && pathSlug !== host.slug) {
      this.logger.warn(
        `[PathTenantMatch] BLOCKED path=${req.path} ` +
        `path.slug=${pathSlug} host.slug=${host.slug} ` +
        `host=${host.hostname} ip=${req.ip}`,
      );
      throw new ForbiddenException(
        'Cross-tenant request rejected — path slug does not match host',
      );
    }

    return true;
  }
}
