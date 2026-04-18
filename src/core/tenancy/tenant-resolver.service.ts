/**
 * TenantResolverService — Stratégie de résolution du tenant depuis un hostname.
 *
 * API PUBLIQUE (seule méthode à utiliser depuis le middleware) :
 *   resolveFromHost(hostname) → ResolvedTenant | null
 *
 * STRATÉGIES (ordonnées, la 1ère qui matche gagne) :
 *
 *   1. **TenantDomain exact** — lookup dans la table tenant_domains
 *      (seedée en Phase 1 avec `{slug}.translogpro.com` et `{slug}.translog.test`).
 *      Phase 3 : inclut aussi les custom domains `billets.sa-marque.com` vérifiés.
 *      SEULS les domaines avec `verifiedAt IS NOT NULL` matchent.
 *
 *   2. **Admin subdomain** — si le sous-domaine == adminSubdomain (ex: 'admin'),
 *      résout vers le tenant plateforme (PLATFORM_TENANT_ID).
 *      C'est le cœur de Phase 2 : super-admin isolé de tout tenant client.
 *
 *   3. **Fallback slug direct** — si aucun TenantDomain ne matche mais le
 *      sous-domaine correspond à un `tenants.slug`, résoudre quand même.
 *      Filet de sécurité utile en dev (migrations partielles) ou pour de
 *      nouveaux tenants avant que le seed TenantDomain ne passe.
 *
 *   → null si aucune stratégie ne matche (host inconnu).
 *
 * DÉCOUPLAGE : cette classe ne touche jamais à `req.user`, ne lit aucun cookie
 * et ne pose aucun header. Elle ne fait que MAPPER un hostname en tenantId.
 * Le middleware (TenantHostMiddleware) est responsable d'injecter le résultat
 * dans `req.resolvedHostTenant`, et le guard (TenantIsolationGuard) est
 * responsable de croiser ce résultat avec `req.user.tenantId`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HostConfigService } from './host-config.service';
import { TenantDomainRepository } from './tenant-domain.repository';
import type { ResolvedTenant } from './current-tenant';

/**
 * UUID canonique du tenant plateforme SaaS (staff support, super-admin).
 * Dupliqué ici pour éviter une dépendance circulaire vers core/iam.
 * Doit rester strictement égal à core/iam/guards/permission.guard.PLATFORM_TENANT_ID.
 */
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export interface ITenantResolver {
  resolveFromHost(hostname: string): Promise<ResolvedTenant | null>;
}

@Injectable()
export class TenantResolverService implements ITenantResolver {
  private readonly logger = new Logger(TenantResolverService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly hostConfig: HostConfigService,
    private readonly domainRepo: TenantDomainRepository,
  ) {}

  /**
   * Point d'entrée unique. Retourne le tenant résolu depuis le hostname ou
   * null si aucune stratégie ne matche. Ne JAMAIS throw — laisser le caller
   * décider quoi faire d'un host inconnu (refuser, fallback, etc.).
   */
  async resolveFromHost(hostname: string): Promise<ResolvedTenant | null> {
    const host = hostname.split(':')[0]?.toLowerCase().trim();
    if (!host) return null;

    // ─── Stratégie 1 : TenantDomain exact (seed plateforme + custom Phase 3)
    const domain = await this.domainRepo.findByHostname(host);
    if (domain && domain.verifiedAt) {
      return {
        tenantId:  domain.tenantId,
        slug:      domain.tenant.slug,
        source:    'host',
        hostname:  host,
        isPrimary: domain.isPrimary,
      };
    }

    // ─── Stratégie 2 : Admin subdomain (Phase 2)
    if (this.hostConfig.isAdminHost(host)) {
      return {
        tenantId: PLATFORM_TENANT_ID,
        slug:     'platform',
        source:   'host',
        hostname: host,
      };
    }

    // ─── Stratégie 3 : fallback slug direct (filet dev + nouveaux tenants)
    const sub = this.hostConfig.extractSubdomain(host);
    if (sub && !this.hostConfig.isReservedSubdomain(sub)) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: sub },
      });
      if (tenant) {
        this.logger.debug(
          `[TenantResolver] fallback-by-slug matched ${host} → tenant=${tenant.id} ` +
          `(no TenantDomain row — consider running seed)`,
        );
        return {
          tenantId: tenant.id,
          slug:     tenant.slug,
          source:   'host',
          hostname: host,
        };
      }
    }

    return null;
  }
}
