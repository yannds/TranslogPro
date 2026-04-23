import type { RoutingProvider, RoutePoint, RoutingResult } from '../routing.types';

const R = 6_371; // rayon de la Terre en km

export class HaversineProvider implements RoutingProvider {
  readonly name = 'haversine' as const;

  async getDistance(origin: RoutePoint, dest: RoutePoint): Promise<RoutingResult> {
    const dLat = ((dest.lat - origin.lat) * Math.PI) / 180;
    const dLng = ((dest.lng - origin.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((origin.lat * Math.PI) / 180) *
        Math.cos((dest.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const distanceKm = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return { distanceKm: Math.round(distanceKm * 10) / 10, durationMin: null, provider: 'haversine' };
  }
}
