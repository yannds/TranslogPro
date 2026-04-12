/**
 * TenantConfigService
 *
 * Charge et met en cache les paramètres opérationnels d'un tenant (table TenantConfig).
 * Utilisé par GeoSafetyProvider (seuils GPS) et DisplayService (scope, horizon, limite).
 *
 * Stratégie de cache :
 *   - Map<tenantId, CacheEntry> en mémoire du process.
 *   - TTL : CACHE_TTL_MS (5 min par défaut).
 *   - Si aucune TenantConfig n'existe en base, retourne les constantes DEFAULT_CONFIG.
 *   - Thread-safe pour Node.js single-threaded : pas besoin de lock.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

// ─── Contrat public ────────────────────────────────────────────────────────────

export interface ResolvedTenantConfig {
  // Géo-sécurité
  proximityThresholdKm:     number;   // SafetyService : distance max (km) pour score
  autoVerifyScoreThreshold: number;   // Score >= X → statut VERIFIED automatique
  publicProximityKm:        number;   // PublicReporter : 1.0 à 0m, 0 à X km

  // Affichage gare
  displayScopeDefault:  'station' | 'city' | 'tenant';
  displayTakeLimit:     number;   // Max trajets retournés
  displayHorizonHours:  number;   // Fenêtre temporelle (h)
}

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Valeurs de repli si aucune TenantConfig n'est définie en base. */
const DEFAULT_CONFIG: ResolvedTenantConfig = {
  proximityThresholdKm:     5.0,
  autoVerifyScoreThreshold: 0.9,
  publicProximityKm:        0.5,
  displayScopeDefault:      'station',
  displayTakeLimit:         20,
  displayHorizonHours:      6,
};

/** Durée de vie du cache en millisecondes. */
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry {
  config:   ResolvedTenantConfig;
  cachedAt: number;  // Date.now()
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TenantConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retourne la configuration résolue pour un tenant.
   * Résultat mis en cache CACHE_TTL_MS ms.
   * Jamais null — retourne DEFAULT_CONFIG si aucune ligne n'existe.
   */
  async getConfig(tenantId: string): Promise<ResolvedTenantConfig> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.config;
    }

    const row = await this.prisma.tenantConfig.findUnique({
      where: { tenantId },
    });

    const config: ResolvedTenantConfig = row
      ? {
          proximityThresholdKm:     row.proximityThresholdKm,
          autoVerifyScoreThreshold: row.autoVerifyScoreThreshold,
          publicProximityKm:        row.publicProximityKm,
          displayScopeDefault:      row.displayScopeDefault as ResolvedTenantConfig['displayScopeDefault'],
          displayTakeLimit:         row.displayTakeLimit,
          displayHorizonHours:      row.displayHorizonHours,
        }
      : { ...DEFAULT_CONFIG };

    this.cache.set(tenantId, { config, cachedAt: Date.now() });
    return config;
  }

  /** Invalide le cache d'un tenant (à appeler après mise à jour de TenantConfig). */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
