import { Logger } from '@nestjs/common';
import type { RoutingProvider, RoutePoint, RoutingResult } from '../routing.types';
import { HaversineProvider } from './haversine.provider';

/** Clé Vault : platform/google-maps → { API_KEY: '...' } */
const VAULT_PATH = 'platform/google-maps';
const VAULT_KEY  = 'API_KEY';

const BASE_URL = 'https://maps.googleapis.com/maps/api/directions/json';

interface DirectionsResponse {
  status: string;
  routes: Array<{
    legs: Array<{
      distance: { value: number };   // mètres
      duration: { value: number };   // secondes
    }>;
  }>;
}

export class GoogleMapsProvider implements RoutingProvider {
  readonly name = 'google' as const;
  private readonly logger = new Logger(GoogleMapsProvider.name);
  private readonly fallback = new HaversineProvider();

  constructor(private readonly apiKey: string) {}

  async getDistance(origin: RoutePoint, dest: RoutePoint): Promise<RoutingResult> {
    const url =
      `${BASE_URL}?origin=${origin.lat},${origin.lng}` +
      `&destination=${dest.lat},${dest.lng}` +
      `&mode=driving` +
      `&key=${this.apiKey}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as DirectionsResponse;
      if (data.status !== 'OK' || !data.routes[0]) {
        this.logger.warn(`[Google] status=${data.status} — fallback haversine`);
        return this.fallback.getDistance(origin, dest);
      }

      const leg = data.routes[0].legs[0]!;
      return {
        distanceKm:  Math.round((leg.distance.value / 1000) * 10) / 10,
        durationMin: Math.round(leg.duration.value / 60),
        provider:    'google',
      };
    } catch (err) {
      this.logger.warn(`[Google] erreur API — fallback haversine : ${String(err)}`);
      return this.fallback.getDistance(origin, dest);
    }
  }
}
