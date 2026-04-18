/**
 * TenantDomainRepository — Accès cache-aware à la table tenant_domains.
 *
 * Résout un hostname en (tenantId, slug, isPrimary) avec cache mémoire 30s.
 * Ce repository est LA couche d'abstraction entre TenantResolverService et
 * Prisma : en Phase 3 (custom domains) ou plus tard, on pourra ajouter du
 * cache Redis L2 sans toucher au resolver ni aux appelants.
 *
 * CACHE :
 *   - TTL 30s in-process (Map + timestamps) — suffisant pour absorber le
 *     burst à chaque requête HTTP (middleware tourne 1x par request).
 *   - Négatifs cachés aussi (hostname inconnu) → évite le N+1 sur les bots
 *     qui scannent des sous-domaines aléatoires.
 *   - Invalidation ciblée par hostname, ou globale (reload config).
 *
 * NOTE : le cache est par-instance — en mode multi-replica, les écritures
 * (ajout/suppression de custom domain Phase 3) déclenchent un event Redis
 * "tenant-domain:invalidate" que chaque instance consomme pour purger
 * son cache local. Stub du handler en Phase 1 (event non émis).
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Tenant, TenantDomain } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export type TenantDomainWithTenant = TenantDomain & { tenant: Tenant };

interface CacheEntry {
  value: TenantDomainWithTenant | null;  // null = négatif mis en cache
  ts:    number;
}

@Injectable()
export class TenantDomainRepository {
  private readonly logger = new Logger(TenantDomainRepository.name);

  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly TTL_MS = 30_000;
  private readonly MAX_ENTRIES = 1_000;   // protection mémoire

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Résout un hostname entrant en TenantDomain + Tenant joint.
   * Retourne null si le hostname n'est pas enregistré (ou pas vérifié).
   *
   * Le hostname est toujours normalisé (lowercase, strip port) avant lookup.
   */
  async findByHostname(hostname: string): Promise<TenantDomainWithTenant | null> {
    const key = this.normalize(hostname);
    if (!key) return null;

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.ts < this.TTL_MS) {
      return cached.value;
    }

    const row = await this.prisma.tenantDomain.findUnique({
      where:   { hostname: key },
      include: { tenant: true },
    });

    this.set(key, row);
    return row;
  }

  /**
   * Liste tous les hostnames enregistrés pour un tenant.
   * Utilisé par les endpoints admin (gestion des domaines custom Phase 3).
   */
  async listForTenant(tenantId: string): Promise<TenantDomain[]> {
    return this.prisma.tenantDomain.findMany({
      where:   { tenantId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Retourne le hostname primaire (canonique) d'un tenant, ou null si aucun.
   * En Phase 1, il est systématiquement `{slug}.translogpro.com` (seed).
   * En Phase 3, peut être remplacé par un custom domain vérifié.
   */
  async findPrimaryForTenant(tenantId: string): Promise<TenantDomain | null> {
    return this.prisma.tenantDomain.findFirst({
      where:   { tenantId, isPrimary: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Cache management ─────────────────────────────────────────────────────

  /**
   * Invalide une entrée (écriture en DB → purger le cache local).
   * Sans argument : purge complète.
   */
  invalidate(hostname?: string): void {
    if (hostname) {
      this.cache.delete(this.normalize(hostname));
    } else {
      this.cache.clear();
    }
  }

  private set(key: string, value: TenantDomainWithTenant | null): void {
    if (this.cache.size >= this.MAX_ENTRIES) {
      // LRU simple : drop le plus ancien (premier insert dans Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, ts: Date.now() });
  }

  private normalize(hostname: string): string {
    return hostname.split(':')[0]?.toLowerCase().trim() ?? '';
  }
}
