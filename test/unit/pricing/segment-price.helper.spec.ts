import {
  RouteSnapshot,
  resolveSegmentPriceFromSnapshot,
  stationDistanceOnRoute,
  sumSegmentCharges,
} from '../../../src/core/pricing/segment-price.helper';

/**
 * Helper pur (sans DB) — teste la résolution de prix segment sur route avec
 * waypoints intermédiaires, fallback proportionnel, et blocage quand le prix
 * n'est pas configuré.
 */
describe('segment-price.helper', () => {
  // Route Brazzaville → Pointe-Noire (500 km) avec 3 waypoints intermédiaires :
  // Mindouli (km 120) → Bouansa (km 230) → Dolisie (km 360)
  const route: RouteSnapshot = {
    basePrice: 15_000,
    distanceKm: 500,
    allowProportionalFallback: false,
    originId: 'st-brz',
    destinationId: 'st-pnr',
    waypoints: [
      { stationId: 'st-min', distanceFromOriginKm: 120, tollCostXaf: 500, order: 1 },
      { stationId: 'st-bou', distanceFromOriginKm: 230, tollCostXaf: 0,   order: 2 },
      { stationId: 'st-dol', distanceFromOriginKm: 360, tollCostXaf: 1_000, order: 3 },
    ],
  };

  // ─── stationDistanceOnRoute ───────────────────────────────────────────────
  describe('stationDistanceOnRoute', () => {
    it('retourne 0 pour la gare origine', () => {
      expect(stationDistanceOnRoute('st-brz', route)).toBe(0);
    });
    it('retourne distanceKm pour la gare destination', () => {
      expect(stationDistanceOnRoute('st-pnr', route)).toBe(500);
    });
    it('retourne la distance du waypoint', () => {
      expect(stationDistanceOnRoute('st-min', route)).toBe(120);
      expect(stationDistanceOnRoute('st-dol', route)).toBe(360);
    });
    it('retourne -1 pour une gare inconnue (non sur la route)', () => {
      expect(stationDistanceOnRoute('st-unknown', route)).toBe(-1);
    });
  });

  // ─── sumSegmentCharges ────────────────────────────────────────────────────
  describe('sumSegmentCharges', () => {
    it('retourne 0 si les gares sont invalides', () => {
      expect(sumSegmentCharges('st-brz', 'st-unknown', route)).toBe(0);
      expect(sumSegmentCharges('st-unknown', 'st-pnr', route)).toBe(0);
    });
    it("retourne 0 si l'ordre est invalide (toDist <= fromDist)", () => {
      expect(sumSegmentCharges('st-dol', 'st-min', route)).toBe(0);
    });
    it('somme les péages des waypoints dans le tronçon [from, to]', () => {
      // Brazza (0) → Dolisie (360) inclut Mindouli (500) + Bouansa (0) + Dolisie (1000) = 1500
      expect(sumSegmentCharges('st-brz', 'st-dol', route)).toBe(1_500);
    });
    it('exclut les waypoints avant le boarding', () => {
      // Bouansa (230) → Pointe-Noire (500) inclut seulement Dolisie (1000)
      expect(sumSegmentCharges('st-bou', 'st-pnr', route)).toBe(1_000);
    });
    it('inclut uniquement les waypoints du tronçon exact', () => {
      // Mindouli (120) → Bouansa (230) : aucun waypoint entre (Bouansa lui-même = 0)
      expect(sumSegmentCharges('st-min', 'st-bou', route)).toBe(0);
    });
  });

  // ─── resolveSegmentPriceFromSnapshot ──────────────────────────────────────
  describe('resolveSegmentPriceFromSnapshot', () => {
    it('utilise le prix manuel configuré sur RouteSegmentPrice', () => {
      const segmentPrices = [
        { fromStationId: 'st-min', toStationId: 'st-bou', basePriceXaf: 3_000 },
      ];
      const res = resolveSegmentPriceFromSnapshot(route, 'st-min', 'st-bou', segmentPrices);
      expect(res.price).toBe(3_000);
      expect(res.isAutoCalculated).toBe(false);
      expect(res.blocked).toBeUndefined();
    });

    it('utilise route.basePrice pour le trajet complet OD', () => {
      const res = resolveSegmentPriceFromSnapshot(route, 'st-brz', 'st-pnr', []);
      expect(res.price).toBe(15_000);
      expect(res.isAutoCalculated).toBe(false);
    });

    it('bloque si pas de prix configuré et allowProportionalFallback=false', () => {
      const res = resolveSegmentPriceFromSnapshot(route, 'st-min', 'st-bou', []);
      expect(res.blocked).toBe(true);
      expect(res.price).toBe(0);
      expect(res.warnings[0]).toContain('non configuré');
    });

    it('calcule proportionnellement si allowProportionalFallback=true', () => {
      const permissiveRoute = { ...route, allowProportionalFallback: true };
      const res = resolveSegmentPriceFromSnapshot(permissiveRoute, 'st-min', 'st-bou', []);
      // Base proportionnelle : 15000 * (230-120)/500 = 15000 * 0.22 = 3300
      // Charges entre Mindouli et Bouansa : 0 (péage de Bouansa = 0, Dolisie hors tronçon)
      expect(res.price).toBe(3_300);
      expect(res.isAutoCalculated).toBe(true);
      expect(res.warnings.length).toBeGreaterThan(0);
    });

    it('proportionnel + charges : Brazza → Dolisie', () => {
      const permissiveRoute = { ...route, allowProportionalFallback: true };
      const res = resolveSegmentPriceFromSnapshot(permissiveRoute, 'st-brz', 'st-dol', []);
      // Proportionnel : 15000 * (360-0)/500 = 10800
      // Charges : Mindouli (500) + Bouansa (0) + Dolisie (1000) = 1500
      // Total : 10800 + 1500 = 12300
      expect(res.price).toBe(12_300);
      expect(res.isAutoCalculated).toBe(true);
      expect(res.segmentCharges).toBe(1_500);
    });

    it('bloque si boarding = alighting (distance invalide)', () => {
      const permissiveRoute = { ...route, allowProportionalFallback: true };
      const res = resolveSegmentPriceFromSnapshot(permissiveRoute, 'st-min', 'st-min', []);
      expect(res.blocked).toBe(true);
      expect(res.warnings[0]).toContain('descente');
    });

    it('bloque si alighting avant boarding (ordre inversé)', () => {
      const permissiveRoute = { ...route, allowProportionalFallback: true };
      const res = resolveSegmentPriceFromSnapshot(permissiveRoute, 'st-dol', 'st-min', []);
      expect(res.blocked).toBe(true);
    });

    it('retourne 0 charges pour checkpointCosts non array', () => {
      const w: RouteSnapshot = {
        ...route,
        waypoints: [{
          stationId: 'st-x', distanceFromOriginKm: 100,
          tollCostXaf: 0,
          checkpointCosts: 'not-an-array' as unknown,
          order: 1,
        }],
      };
      expect(sumSegmentCharges('st-brz', 'st-pnr', w)).toBe(0);
    });

    it('gère les checkpointCosts JSON avec costXaf numérique', () => {
      const w: RouteSnapshot = {
        ...route,
        waypoints: [{
          stationId: 'st-x', distanceFromOriginKm: 100,
          tollCostXaf: 200,
          checkpointCosts: [{ type: 'POLICE', costXaf: 300 }, { type: 'NO_COST' }],
          order: 1,
        }],
      };
      // Origin → destination (500) inclut st-x : péage 200 + checkpoint 300 = 500
      expect(sumSegmentCharges('st-brz', 'st-pnr', w)).toBe(500);
    });
  });
});
