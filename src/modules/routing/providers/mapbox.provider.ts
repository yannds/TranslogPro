import { Logger } from '@nestjs/common';
import type { RoutingProvider, RoutePoint, RoutingResult } from '../routing.types';
import { HaversineProvider } from './haversine.provider';

/** Clé Vault : platform/mapbox → { API_KEY: '...' } */
const VAULT_PATH = 'platform/mapbox';
const VAULT_KEY  = 'API_KEY';

// Directions API v5 — profile driving (pas de traffic en free tier)
const BASE_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';

interface MapboxResponse {
  code:   string;
  routes: Array<{
    distance: number;   // mètres
    duration: number;   // secondes
  }>;
}

export class MapboxProvider implements RoutingProvider {
  readonly name = 'mapbox' as const;
  private readonly logger = new Logger(MapboxProvider.name);
  private readonly fallback = new HaversineProvider();

  constructor(private readonly apiKey: string) {}

  async getDistance(origin: RoutePoint, dest: RoutePoint): Promise<RoutingResult> {
    // Mapbox format : {lng},{lat};{lng},{lat}
    const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
    const url = `${BASE_URL}/${coords}?access_token=${this.apiKey}&overview=false`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as MapboxResponse;
      if (data.code !== 'Ok' || !data.routes[0]) {
        this.logger.warn(`[Mapbox] code=${data.code} — fallback haversine`);
        return this.fallback.getDistance(origin, dest);
      }

      const route = data.routes[0];
      return {
        distanceKm:  Math.round((route.distance / 1000) * 10) / 10,
        durationMin: Math.round(route.duration / 60),
        provider:    'mapbox',
      };
    } catch (err) {
      this.logger.warn(`[Mapbox] erreur API — fallback haversine : ${String(err)}`);
      return this.fallback.getDistance(origin, dest);
    }
  }
}

export { VAULT_PATH as MAPBOX_VAULT_PATH, VAULT_KEY as MAPBOX_VAULT_KEY };
