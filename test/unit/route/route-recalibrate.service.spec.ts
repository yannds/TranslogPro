/**
 * Tests unit — RouteService.recalibrateFromGoogle.
 *
 * Couvre :
 *   - Recalibre distances + Route.distanceKm depuis le provider routing
 *   - Préserve basePrice et tollCostXaf (décisions tenant)
 *   - Clampe les waypoints sans GPS entre ancres pour ordre monotone
 *   - Refuse si routing.enabled=false
 *   - Refuse si origine/destination sans GPS
 *   - Idempotent (rappel sans changement → changed=false)
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RouteService } from '../../../src/modules/route/route.service';

const TENANT = 'tenant-1';
const ROUTE  = 'route-1';

function makePrismaMock(overrides: Record<string, any> = {}) {
  const prisma: any = {
    route: {
      findFirst: jest.fn(),
      update:    jest.fn(),
    },
    waypoint: {
      update: jest.fn(),
    },
    routeSegmentPrice: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue({}),
      upsert:     jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return prisma;
}

function makeRoutingMock(opts: {
  enabled?: boolean;
  distances?: number[]; // pour chaque appel consécutif suggestDistance
  estimated?: boolean;
} = {}) {
  const distances = opts.distances ?? [];
  let idx = 0;
  return {
    isEnabled: jest.fn().mockResolvedValue(opts.enabled ?? true),
    suggestDistance: jest.fn().mockImplementation(async () => ({
      distanceKm:  distances[idx++] ?? 50,
      durationMin: 60,
      provider:    'google',
      estimated:   opts.estimated ?? false,
    })),
  };
}

function makeRouteRow(opts: {
  distanceKm: number;
  waypoints: Array<{
    id: string; order: number; distanceFromOriginKm: number;
    tollCostXaf?: number;
    station?: { coordinates: any } | null;
  }>;
}) {
  return {
    id: ROUTE, tenantId: TENANT,
    name: 'Test', basePrice: 10000,
    distanceKm: opts.distanceKm,
    originId: 'st-a', destinationId: 'st-z',
    origin:      { coordinates: { lat: -4.26, lng: 15.28 }, name: 'A' },
    destination: { coordinates: { lat: -4.78, lng: 11.86 }, name: 'Z' },
    waypoints: opts.waypoints,
  };
}

describe('RouteService.recalibrateFromGoogle', () => {
  it('recalibre un waypoint station (nouvelle distance depuis Google)', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue(makeRouteRow({
      distanceKm: 100,
      waypoints: [
        { id: 'w1', order: 1, distanceFromOriginKm: 30, station: { coordinates: { lat: -4.4, lng: 14.0 } } },
      ],
    }));
    // generateSegmentPriceMatrix refetch : appel à findFirst() une deuxième fois

    const routing = makeRoutingMock({ enabled: true, distances: [55, 70] }); // 55 km A→W1, 70 km W1→Z, total 125 km
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    const out = await svc.recalibrateFromGoogle(TENANT, ROUTE);

    expect(routing.suggestDistance).toHaveBeenCalledTimes(2);
    expect(prisma.waypoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w1' },
      data:  { distanceFromOriginKm: 55 },
    }));
    expect(prisma.route.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { distanceKm: 125 },
    }));
    expect(out.changed).toBe(true);
    expect(out.newDistanceKm).toBe(125);
    expect(out.oldDistanceKm).toBe(100);
    expect(out.provider).toBe('google');
  });

  it('clampe un waypoint péage sans GPS entre ancres encadrantes', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue(makeRouteRow({
      distanceKm: 590,
      waypoints: [
        // w1 station GPS — ancre à 105 km selon Google
        { id: 'w1', order: 1, distanceFromOriginKm: 105, station: { coordinates: { lat: -4.24, lng: 14.33 } } },
        // w2 péage sans GPS, distance actuelle à 182 (RECUL par rapport à w1 à 105 en DB initial mais Google recale w1 à 200)
        { id: 'w2', order: 2, distanceFromOriginKm: 182, tollCostXaf: 10000, station: null },
        // w3 station GPS — valeur DB initiale 250 (incorrecte), Google la recale à 300
        { id: 'w3', order: 3, distanceFromOriginKm: 250, station: { coordinates: { lat: -4.2, lng: 13.75 } } },
      ],
    }));

    // Distances Google : A→w1=200, w1→w3=100, w3→Z=290 ⇒ cumul : 0, 200, 300, 590
    const routing = makeRoutingMock({ enabled: true, distances: [200, 100, 290] });
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    await svc.recalibrateFromGoogle(TENANT, ROUTE);

    // w1 doit passer à 200 km
    expect(prisma.waypoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w1' },
      data:  { distanceFromOriginKm: 200 },
    }));
    // w3 doit passer à 300 km
    expect(prisma.waypoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w3' },
      data:  { distanceFromOriginKm: 300 },
    }));
    // w2 était à 182 km — maintenant la plage est [200, 300] → 182 est en dehors → milieu = 250
    expect(prisma.waypoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w2' },
      data:  { distanceFromOriginKm: 250 },
    }));
  });

  it('laisse un waypoint péage inchangé si sa distance est déjà dans l\'intervalle', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue(makeRouteRow({
      distanceKm: 100,
      waypoints: [
        { id: 'w1', order: 1, distanceFromOriginKm: 30, station: { coordinates: { lat: -4.4, lng: 14.0 } } },
        { id: 'w2', order: 2, distanceFromOriginKm: 60, tollCostXaf: 5000, station: null },
        { id: 'w3', order: 3, distanceFromOriginKm: 80, station: { coordinates: { lat: -4.5, lng: 13.0 } } },
      ],
    }));
    const routing = makeRoutingMock({ enabled: true, distances: [30, 50, 20] });
    // Cumul : 0, 30, 80, 100 — w2 à 60 reste dans [30, 80] → INCHANGÉ
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    await svc.recalibrateFromGoogle(TENANT, ROUTE);

    const w2Calls = prisma.waypoint.update.mock.calls.filter((c: any) => c[0].where.id === 'w2');
    expect(w2Calls).toHaveLength(0); // w2 n'a PAS été mis à jour
  });

  it('refuse si routing désactivé', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue(makeRouteRow({
      distanceKm: 100, waypoints: [],
    }));
    const routing = makeRoutingMock({ enabled: false });
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    await expect(svc.recalibrateFromGoogle(TENANT, ROUTE))
      .rejects.toThrow(BadRequestException);
  });

  it('refuse si origine sans GPS', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, basePrice: 10000, distanceKm: 100,
      originId: 'st-a', destinationId: 'st-z',
      origin:      { coordinates: null, name: 'A' },
      destination: { coordinates: { lat: -4.78, lng: 11.86 }, name: 'Z' },
      waypoints: [],
    });
    const routing = makeRoutingMock({ enabled: true });
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    await expect(svc.recalibrateFromGoogle(TENANT, ROUTE))
      .rejects.toThrow(BadRequestException);
  });

  it('throw NotFound pour une route inconnue', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue(null);
    const routing = makeRoutingMock({ enabled: true });
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    await expect(svc.recalibrateFromGoogle(TENANT, ROUTE))
      .rejects.toThrow(NotFoundException);
  });

  it('idempotent : rappel sans changement → changed=false et 0 update', async () => {
    const prisma = makePrismaMock();
    // Google donnerait exactement les mêmes distances que celles déjà en DB
    prisma.route.findFirst.mockResolvedValue(makeRouteRow({
      distanceKm: 100,
      waypoints: [
        { id: 'w1', order: 1, distanceFromOriginKm: 30, station: { coordinates: { lat: -4.4, lng: 14.0 } } },
      ],
    }));
    const routing = makeRoutingMock({ enabled: true, distances: [30, 70] });
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    const out = await svc.recalibrateFromGoogle(TENANT, ROUTE);

    // Aucun waypoint.update, aucun route.update
    expect(prisma.waypoint.update).not.toHaveBeenCalled();
    expect(prisma.route.update).not.toHaveBeenCalled();
    expect(out.changed).toBe(false);
    expect(out.waypointsUpdated).toBe(0);
  });

  it('flag estimated=true si le provider a fait du haversine sur au moins un segment', async () => {
    const prisma = makePrismaMock();
    prisma.route.findFirst.mockResolvedValue(makeRouteRow({
      distanceKm: 100,
      waypoints: [
        { id: 'w1', order: 1, distanceFromOriginKm: 30, station: { coordinates: { lat: -4.4, lng: 14.0 } } },
      ],
    }));
    const routing = makeRoutingMock({ enabled: true, distances: [55, 70], estimated: true });
    const svc = new RouteService(prisma as any, {} as any, routing as any);

    const out = await svc.recalibrateFromGoogle(TENANT, ROUTE);

    expect(out.estimated).toBe(true);
    expect(out.provider).toBe('haversine-partial');
  });
});
