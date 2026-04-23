import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { ISecretService }        from '../../infrastructure/secret/interfaces/secret.interface';
import { SECRET_SERVICE }        from '../../infrastructure/secret/interfaces/secret.interface';
import { REDIS_CLIENT }          from '../../infrastructure/eventbus/redis-publisher.service';
import { HaversineProvider }     from './providers/haversine.provider';
import { GoogleMapsProvider }    from './providers/google-maps.provider';
import { MapboxProvider }        from './providers/mapbox.provider';
import type { RoutePoint, RoutingResult, SuggestDistanceResponse } from './routing.types';

/** TTL cache Redis — 30 jours (distances routières stables) */
const CACHE_TTL_SEC = 60 * 60 * 24 * 30;

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly platformConfig:  PlatformConfigService,
    @Inject(SECRET_SERVICE) private readonly secrets: ISecretService,
    @Inject(REDIS_CLIENT)   private readonly redis:   Redis,
  ) {}

  /** Retourne true si le routing routier est activé au niveau plateforme. */
  async isEnabled(): Promise<boolean> {
    return this.platformConfig.getBoolean('routing.enabled');
  }

  /**
   * Calcule ou suggère une distance entre deux points.
   *
   * - Si routing.enabled = false  → haversine (ligne droite), estimated = true
   * - Sinon, selon routing.provider :
   *     'google'    → Google Maps Directions API (fallback haversine si erreur)
   *     'mapbox'    → Mapbox Directions API (fallback haversine si erreur)
   *     'haversine' → haversine directement
   */
  async suggestDistance(origin: RoutePoint, dest: RoutePoint): Promise<SuggestDistanceResponse> {
    const enabled = await this.isEnabled();

    if (!enabled) {
      const fallback = new HaversineProvider();
      const result   = await fallback.getDistance(origin, dest);
      return { ...result, estimated: true };
    }

    const cacheKey = await this.cacheKey(origin, dest);
    const cached   = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SuggestDistanceResponse;
        return parsed;
      } catch { /* ignore */ }
    }

    const provider = await this.resolveProvider();
    const result   = await provider.getDistance(origin, dest);
    const response: SuggestDistanceResponse = {
      ...result,
      estimated: result.provider === 'haversine',
    };

    await this.redis.setex(cacheKey, CACHE_TTL_SEC, JSON.stringify(response));
    return response;
  }

  // ── Privé ─────────────────────────────────────────────────────────────────────

  private async resolveProvider() {
    const providerName = await this.platformConfig.getString('routing.provider');

    if (providerName === 'google') {
      try {
        const key = await this.secrets.getSecret('platform/google-maps', 'API_KEY');
        return new GoogleMapsProvider(key);
      } catch {
        this.logger.warn('[Routing] clé Google Maps absente — fallback haversine');
        return new HaversineProvider();
      }
    }

    if (providerName === 'mapbox') {
      try {
        const key = await this.secrets.getSecret('platform/mapbox', 'API_KEY');
        return new MapboxProvider(key);
      } catch {
        this.logger.warn('[Routing] clé Mapbox absente — fallback haversine');
        return new HaversineProvider();
      }
    }

    return new HaversineProvider();
  }

  /** Clé Redis déterministe arrondie à 4 décimales (~11 m de précision). */
  private async cacheKey(o: RoutePoint, d: RoutePoint): Promise<string> {
    const fmt = (n: number) => n.toFixed(4);
    const prv = await this.platformConfig.getString('routing.provider');
    return `routing:v1:${prv}:${fmt(o.lat)}:${fmt(o.lng)}:${fmt(d.lat)}:${fmt(d.lng)}`;
  }
}
