export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RoutingResult {
  distanceKm:  number;
  durationMin: number | null;
  provider:    'haversine' | 'google' | 'mapbox';
}

export interface RoutingProvider {
  readonly name: RoutingResult['provider'];
  getDistance(origin: RoutePoint, dest: RoutePoint): Promise<RoutingResult>;
}

/** Valeurs retournées par GET /suggest-distance */
export interface SuggestDistanceResponse {
  distanceKm:  number;
  durationMin: number | null;
  provider:    string;
  /** true = valeur estimée (haversine ou fallback) ; false = distance routière réelle */
  estimated:   boolean;
}
