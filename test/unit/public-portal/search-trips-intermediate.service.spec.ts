// Mock modules ESM (pdfme) avant l'import du service qui dépend transitivement
// de DocumentsService → PdfmeService → @pdfme/*.
jest.mock('@pdfme/generator',        () => ({ generate: jest.fn() }),        { virtual: true });
jest.mock('@pdfme/common',           () => ({}),                              { virtual: true });
jest.mock('@pdfme/schemas',          () => ({ text: {}, image: {}, barcodes: {}, rectangle: {}, line: {}, ellipse: {}, table: {} }), { virtual: true });

import { PublicPortalService } from '../../../src/modules/public-portal/public-portal.service';

/**
 * Tests unitaires — PublicPortalService.searchTrips() avec segments
 * intermédiaires (2026-04-20). Prisma est mocké ; seule la logique de
 * matching + politique tenant est testée ici.
 *
 * Scénarios couverts :
 *   - Trajet OD complet (boarding=origin, alighting=destination)
 *   - Segment intermédiaire (Mindouli → Bouansa sur route Brazza → PNR)
 *   - intermediateBookingEnabled=false bloque les segments intermédiaires
 *   - cutoff minutes avant départ bloque les segments
 *   - blacklist explicite
 *   - ordre invalide (alighting avant boarding) → pas de match
 *   - recherche ne trouvant aucune gare → vide
 *   - cross-tenant : requête tenant-A ne retourne pas trips tenant-B
 */
describe('PublicPortalService — searchTrips (intermediate)', () => {
  let prismaMock: any;
  let service:    PublicPortalService;

  // Route fixture : Brazza → Pointe-Noire via Mindouli, Bouansa, Dolisie
  const buildTrip = (overrides: Partial<any> = {}) => {
    const DEFAULT_DEPARTURE = new Date(Date.now() + 4 * 3600_000); // +4h
    const DEFAULT_ARRIVAL   = new Date(Date.now() + 12 * 3600_000); // +12h
    return {
      id: 'trip-1',
      status: 'OPEN',
      departureScheduled: DEFAULT_DEPARTURE,
      arrivalScheduled:   DEFAULT_ARRIVAL,
      seatingMode: 'FREE',
      route: {
        id:            'route-1',
        name:          'Brazza → PNR',
        originId:      'st-brz',
        destinationId: 'st-pnr',
        basePrice:     15_000,
        distanceKm:    500,
        allowProportionalFallback: true,
        origin:        { id: 'st-brz', name: 'Gare Brazzaville', city: 'Brazzaville' },
        destination:   { id: 'st-pnr', name: 'Gare Pointe-Noire', city: 'Pointe-Noire' },
        waypoints: [
          { order: 1, stationId: 'st-min', distanceFromOriginKm: 120, tollCostXaf: 0, checkpointCosts: [], station: { id: 'st-min', name: 'Gare Mindouli', city: 'Mindouli' } },
          { order: 2, stationId: 'st-bou', distanceFromOriginKm: 230, tollCostXaf: 0, checkpointCosts: [], station: { id: 'st-bou', name: 'Gare Bouansa',  city: 'Bouansa' } },
          { order: 3, stationId: 'st-dol', distanceFromOriginKm: 360, tollCostXaf: 0, checkpointCosts: [], station: { id: 'st-dol', name: 'Gare Dolisie',  city: 'Dolisie' } },
        ],
        segmentPrices: [],
      },
      bus: {
        model: 'Mercedes', type: 'STANDARD', capacity: 50,
        seatLayout: null, photos: [], amenities: [],
        isFullVip: false, vipSeats: [],
      },
      ...overrides,
    };
  };

  const buildConfig = (overrides: Partial<any> = {}) => ({
    seatSelectionFee:              0,
    intermediateBookingEnabled:    true,
    intermediateBookingCutoffMins: 30,
    intermediateMinSegmentMinutes: 0,
    intermediateSegmentBlacklist:  [],
    ...overrides,
  });

  beforeEach(() => {
    prismaMock = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tenant-a', name: 'Tenant A', slug: 'tenant-a',
          isActive: true, provisionStatus: 'ACTIVE', currency: 'XAF',
        }),
      },
      tenantBusinessConfig: {
        findUnique: jest.fn(),
      },
      trip: {
        findMany: jest.fn(),
      },
      ticket: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    // Redis cache mock (no-cache path — resolveTenant utilise setex)
    const redisMock = {
      get:   jest.fn().mockResolvedValue(null),
      set:   jest.fn().mockResolvedValue('OK'),
      setex: jest.fn().mockResolvedValue('OK'),
    };

    service = new PublicPortalService(
      prismaMock,
      {} as any, // brand
      {} as any, // qr
      {} as any, // documents
      {} as any, // policy
      {} as any, // refund
      redisMock as any,
      {} as any, // storage
      {} as any, // eventBus
      {} as any, // notification
      {} as any, // crmResolver
      {} as any, // crmClaim
    );
  });

  // ─── Matching OD + waypoints ──────────────────────────────────────────────

  it('matche un trajet OD complet (Brazzaville → Pointe-Noire)', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig());
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Brazzaville', arrival: 'Pointe-Noire',
      date: new Date().toISOString(),
    });

    expect(results).toHaveLength(1);
    expect((results as any)[0]).toMatchObject({
      boardingStationId:  'st-brz',
      alightingStationId: 'st-pnr',
      isIntermediateSegment: false,
      price: 15_000, // basePrice OD
    });
  });

  it('matche un segment intermédiaire (Mindouli → Bouansa)', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig());
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Mindouli', arrival: 'Bouansa',
      date: new Date().toISOString(),
    });

    expect(results).toHaveLength(1);
    expect((results as any)[0]).toMatchObject({
      boardingStationId:  'st-min',
      alightingStationId: 'st-bou',
      isIntermediateSegment: true,
      isAutoCalculated:      true,
    });
    // Prix proportionnel : 15000 * (230-120)/500 = 3300
    expect((results as any)[0].price).toBe(3_300);
  });

  it('retourne [] si aucune gare ne matche', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig());
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Inconnue', arrival: 'Ailleurs',
      date: new Date().toISOString(),
    });

    expect(results).toEqual([]);
  });

  it("retourne [] si l'ordre est invalide (alighting avant boarding)", async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig());
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    // Bouansa est AVANT Dolisie → alors "Dolisie → Bouansa" = ordre inversé
    const results = await service.searchTrips('tenant-a', {
      departure: 'Dolisie', arrival: 'Bouansa',
      date: new Date().toISOString(),
    });

    expect(results).toEqual([]);
  });

  // ─── Politique tenant ─────────────────────────────────────────────────────

  it('intermediateBookingEnabled=false bloque les segments intermédiaires', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig({
      intermediateBookingEnabled: false,
    }));
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Mindouli', arrival: 'Bouansa',
      date: new Date().toISOString(),
    });

    expect(results).toEqual([]);
  });

  it('intermediateBookingEnabled=false autorise quand même les OD complets', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig({
      intermediateBookingEnabled: false,
    }));
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Brazzaville', arrival: 'Pointe-Noire',
      date: new Date().toISOString(),
    });

    expect(results).toHaveLength(1);
    expect((results as any)[0].isIntermediateSegment).toBe(false);
  });

  it('cutoff : segment intermédiaire bloqué si départ dans moins de 30 min', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig({
      intermediateBookingCutoffMins: 30,
    }));
    const tripSoon = buildTrip({
      departureScheduled: new Date(Date.now() + 10 * 60_000), // +10 min
      arrivalScheduled:   new Date(Date.now() + 8 * 3600_000),
    });
    prismaMock.trip.findMany.mockResolvedValue([tripSoon]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Mindouli', arrival: 'Bouansa',
      date: new Date().toISOString(),
    });

    expect(results).toEqual([]);
  });

  it("cutoff n'affecte PAS les trajets OD complets", async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig());
    const tripSoon = buildTrip({
      departureScheduled: new Date(Date.now() + 10 * 60_000),
      arrivalScheduled:   new Date(Date.now() + 8 * 3600_000),
    });
    prismaMock.trip.findMany.mockResolvedValue([tripSoon]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Brazzaville', arrival: 'Pointe-Noire',
      date: new Date().toISOString(),
    });

    expect(results).toHaveLength(1);
  });

  it('blacklist : segment listé est filtré', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig({
      intermediateSegmentBlacklist: [
        { routeId: 'route-1', fromStationId: 'st-min', toStationId: 'st-bou' },
      ],
    }));
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    const results = await service.searchTrips('tenant-a', {
      departure: 'Mindouli', arrival: 'Bouansa',
      date: new Date().toISOString(),
    });

    expect(results).toEqual([]);
  });

  // ─── Cross-tenant isolation (sécurité) ────────────────────────────────────

  it('[security] requête tenant-a ne retourne pas les trips d\'un autre tenant', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue(buildConfig());
    prismaMock.trip.findMany.mockResolvedValue([buildTrip()]);

    await service.searchTrips('tenant-a', {
      departure: 'Brazzaville', arrival: 'Pointe-Noire',
      date: new Date().toISOString(),
    });

    // Vérifie que findMany a filtré par tenantId
    expect(prismaMock.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });
});
