/**
 * Helper pur (sans DB) pour résoudre le prix d'un segment sur une route, à
 * partir d'un snapshot préchargé. Partagé entre :
 *   - PricingEngine.resolveSegmentPrice (calcul précis au booking)
 *   - PublicPortalService.searchTrips    (estimation listing public)
 *
 * Respecte Route.allowProportionalFallback :
 *   - Si false + segment non configuré + != OD → blocage ("Tarif non configuré")
 *   - Si true  + segment non configuré → calcul proportionnel + charges
 */

export interface WaypointSnapshot {
  stationId:            string;
  distanceFromOriginKm: number;
  tollCostXaf?:         number;
  checkpointCosts?:     unknown; // JSON array
  order?:               number;
}

export interface RouteSnapshot {
  basePrice:                 number;
  distanceKm:                number;
  allowProportionalFallback: boolean;
  originId:                  string;
  destinationId:             string;
  waypoints:                 WaypointSnapshot[];
}

export interface SegmentPriceResult {
  price:             number;
  isAutoCalculated:  boolean;
  segmentCharges:    number;
  warnings:          string[];
  /** true si non résoluble (tarif non configuré et fallback interdit) */
  blocked?:          boolean;
}

/** Distance cumulée d'une station sur la route. */
export function stationDistanceOnRoute(stationId: string, route: RouteSnapshot): number {
  if (stationId === route.originId)      return 0;
  if (stationId === route.destinationId) return route.distanceKm;
  const wp = route.waypoints.find(w => w.stationId === stationId);
  return wp?.distanceFromOriginKm ?? -1;
}

/** Somme des charges intermédiaires (péages + douane/police) entre from et to. */
export function sumSegmentCharges(fromId: string, toId: string, route: RouteSnapshot): number {
  const fromDist = stationDistanceOnRoute(fromId, route);
  const toDist   = stationDistanceOnRoute(toId, route);
  if (fromDist < 0 || toDist < 0 || toDist <= fromDist) return 0;

  let total = 0;
  for (const wp of route.waypoints) {
    if (wp.distanceFromOriginKm > fromDist && wp.distanceFromOriginKm <= toDist) {
      total += wp.tollCostXaf ?? 0;
      const cc = Array.isArray(wp.checkpointCosts) ? wp.checkpointCosts : [];
      for (const c of cc) {
        const costXaf = (c as { costXaf?: number })?.costXaf;
        if (typeof costXaf === 'number') total += costXaf;
      }
    }
  }
  return total;
}

/**
 * Résout le prix d'un segment à partir des prix segmentés préchargés.
 * @param segmentPrices liste `RouteSegmentPrice` préchargée pour la route
 */
export function resolveSegmentPriceFromSnapshot(
  route:          RouteSnapshot,
  fromId:         string,
  toId:           string,
  segmentPrices:  Array<{ fromStationId: string; toStationId: string; basePriceXaf: number }>,
): SegmentPriceResult {
  // 1. Prix configuré manuellement ?
  const manual = segmentPrices.find(s => s.fromStationId === fromId && s.toStationId === toId);
  if (manual && manual.basePriceXaf > 0) {
    return {
      price:            manual.basePriceXaf,
      isAutoCalculated: false,
      segmentCharges:   sumSegmentCharges(fromId, toId, route),
      warnings:         [],
    };
  }

  // 2. Trajet complet OD → basePrice de la route
  if (fromId === route.originId && toId === route.destinationId) {
    return {
      price:            route.basePrice,
      isAutoCalculated: false,
      segmentCharges:   sumSegmentCharges(fromId, toId, route),
      warnings:         [],
    };
  }

  // 3. Fallback proportionnel (si autorisé sur la route)
  const distFrom = stationDistanceOnRoute(fromId, route);
  const distTo   = stationDistanceOnRoute(toId, route);

  if (distFrom < 0 || distTo < 0 || distTo <= distFrom || route.distanceKm <= 0) {
    return {
      price:            0,
      isAutoCalculated: true,
      segmentCharges:   0,
      warnings:         ['Segment invalide : la gare de descente doit être après la gare de montée.'],
      blocked:          true,
    };
  }

  if (!route.allowProportionalFallback) {
    return {
      price:            0,
      isAutoCalculated: true,
      segmentCharges:   0,
      warnings:         ['Tarif non configuré pour ce segment.'],
      blocked:          true,
    };
  }

  const proportionalBase = route.basePrice * ((distTo - distFrom) / route.distanceKm);
  const segmentCharges   = sumSegmentCharges(fromId, toId, route);
  return {
    price:            proportionalBase + segmentCharges,
    isAutoCalculated: true,
    segmentCharges,
    warnings: [
      'Tarif calculé automatiquement (proportionnel à la distance + charges du tronçon).',
      'Il ne tient pas compte des conditions commerciales locales.',
    ],
  };
}
