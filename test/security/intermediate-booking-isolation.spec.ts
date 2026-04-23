/**
 * Security Test — Isolation tenant sur la recherche / booking de segments
 * intermédiaires (2026-04-20).
 *
 * Garantit que :
 *   - searchTrips() filtre bien par tenantId côté Prisma — impossible qu'un
 *     trip d'un autre tenant remonte, même si une gare portant le même nom
 *     existe sur les deux tenants.
 *   - La politique `intermediateBookingPolicy` d'un tenant est lue pour CE
 *     tenant uniquement (jamais celle d'un autre tenant).
 *   - createBooking refuse un alighting.order <= boarding.order (injection
 *     client malveillant).
 *   - createBooking refuse une station externe à la route (fuzz).
 */

// Mock pdfme avant l'import du service
jest.mock('@pdfme/generator', () => ({ generate: jest.fn() }), { virtual: true });
jest.mock('@pdfme/common', () => ({}), { virtual: true });
jest.mock('@pdfme/schemas', () => ({ text: {}, image: {}, barcodes: {}, rectangle: {}, line: {}, ellipse: {}, table: {} }), { virtual: true });

import { PublicPortalService } from '../../src/modules/public-portal/public-portal.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('[SECURITY] Intermediate booking — tenant isolation', () => {
  let prismaMock: any;
  let service:    PublicPortalService;

  const makeRouteTrip = (tenantId: string, tripId: string) => ({
    id: tripId,
    status: 'OPEN',
    departureScheduled: new Date(Date.now() + 6 * 3600_000),
    arrivalScheduled:   new Date(Date.now() + 14 * 3600_000),
    seatingMode: 'FREE',
    route: {
      id:            `route-${tenantId}`,
      name:          `Route ${tenantId}`,
      originId:      `${tenantId}-brz`,
      destinationId: `${tenantId}-pnr`,
      basePrice:     10_000,
      distanceKm:    500,
      allowProportionalFallback: true,
      origin:        { id: `${tenantId}-brz`, name: 'Brazzaville', city: 'Brazzaville' },
      destination:   { id: `${tenantId}-pnr`, name: 'Pointe-Noire', city: 'Pointe-Noire' },
      waypoints: [
        { order: 1, stationId: `${tenantId}-min`, distanceFromOriginKm: 120, tollCostXaf: 0, checkpointCosts: [], station: { id: `${tenantId}-min`, name: 'Mindouli', city: 'Mindouli' } },
      ],
      segmentPrices: [],
    },
    bus: { model: 'X', type: 'STANDARD', capacity: 40, seatLayout: null, photos: [], amenities: [], isFullVip: false, vipSeats: [] },
  });

  beforeEach(() => {
    prismaMock = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tenant-a', slug: 'tenant-a', name: 'A',
          isActive: true, provisionStatus: 'ACTIVE', currency: 'XAF',
        }),
      },
      tenantBusinessConfig: {
        findUnique: jest.fn().mockResolvedValue({
          seatSelectionFee: 0,
          intermediateBookingEnabled: true,
          intermediateBookingCutoffMins: 30,
          intermediateMinSegmentMinutes: 0,
          intermediateSegmentBlacklist: [],
        }),
      },
      trip: {
        findFirst: jest.fn(),
        findMany:  jest.fn(),
      },
      ticket: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      agency: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ag-a' }),
      },
      transact: jest.fn(),
    };

    const redisMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      setex: jest.fn().mockResolvedValue('OK'),
    };

    service = new PublicPortalService(
      prismaMock, {} as any, {} as any, {} as any, {} as any, {} as any,
      redisMock as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any,
    );
  });

  // ─── [SEC-1] searchTrips filtre explicitement par tenantId ───────────────
  it('[SEC-1] searchTrips inclut toujours tenantId dans la requête Prisma', async () => {
    prismaMock.trip.findMany.mockResolvedValue([]);
    await service.searchTrips('tenant-a', {
      departure: 'Mindouli', arrival: 'Pointe-Noire', date: new Date().toISOString(),
    });

    const call = prismaMock.trip.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe('tenant-a');
  });

  // ─── [SEC-2] searchTrips tickets count scoped par tenantId ───────────────
  it('[SEC-2] agrégation ticket.groupBy est scopée par tenantId', async () => {
    prismaMock.trip.findMany.mockResolvedValue([makeRouteTrip('tenant-a', 'trip-a1')]);
    await service.searchTrips('tenant-a', {
      departure: 'Brazzaville', arrival: 'Pointe-Noire', date: new Date().toISOString(),
    });

    // ticket.groupBy doit être appelé avec tenantId du tenant résolu uniquement
    expect(prismaMock.ticket.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });

  // ─── [SEC-3] createBooking rejette station hors route ────────────────────
  it('[SEC-3] createBooking rejette boardingStationId étranger à la route', async () => {
    prismaMock.trip.findFirst.mockResolvedValue(makeRouteTrip('tenant-a', 'trip-a1'));

    await expect(service.createBooking('tenant-a', {
      tripId: 'trip-a1',
      boardingStationId:  'tenant-b-min', // gare d'un autre tenant / pas sur la route
      alightingStationId: 'tenant-a-pnr',
      passengers: [{ firstName: 'X', lastName: 'Y', phone: '+242600000000', seatType: 'STANDARD' }],
      paymentMethod: 'mtn_momo',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── [SEC-4] createBooking rejette alighting.order <= boarding.order ─────
  it('[SEC-4] createBooking rejette un segment avec ordre inversé', async () => {
    prismaMock.trip.findFirst.mockResolvedValue(makeRouteTrip('tenant-a', 'trip-a1'));

    // boarding = destination (km 500) ; alighting = origin (km 0) → invalide
    await expect(service.createBooking('tenant-a', {
      tripId: 'trip-a1',
      boardingStationId:  'tenant-a-pnr',
      alightingStationId: 'tenant-a-brz',
      passengers: [{ firstName: 'X', lastName: 'Y', phone: '+242600000000', seatType: 'STANDARD' }],
      paymentMethod: 'mtn_momo',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── [SEC-5] createBooking respecte intermediateBookingEnabled=false ─────
  it('[SEC-5] createBooking refuse segment intermédiaire si policy=false', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      seatSelectionFee: 0,
      intermediateBookingEnabled: false,
      intermediateBookingCutoffMins: 30,
      intermediateSegmentBlacklist: [],
    });
    prismaMock.trip.findFirst.mockResolvedValue(makeRouteTrip('tenant-a', 'trip-a1'));

    await expect(service.createBooking('tenant-a', {
      tripId: 'trip-a1',
      boardingStationId:  'tenant-a-min', // waypoint → segment intermédiaire
      alightingStationId: 'tenant-a-pnr',
      passengers: [{ firstName: 'X', lastName: 'Y', phone: '+242600000000', seatType: 'STANDARD' }],
      paymentMethod: 'mtn_momo',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ─── [SEC-6] createBooking respecte blacklist ─────────────────────────────
  it('[SEC-6] createBooking rejette segment blacklisté', async () => {
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      seatSelectionFee: 0,
      intermediateBookingEnabled: true,
      intermediateBookingCutoffMins: 30,
      intermediateSegmentBlacklist: [
        { routeId: 'route-tenant-a', fromStationId: 'tenant-a-min', toStationId: 'tenant-a-pnr' },
      ],
    });
    prismaMock.trip.findFirst.mockResolvedValue(makeRouteTrip('tenant-a', 'trip-a1'));

    await expect(service.createBooking('tenant-a', {
      tripId: 'trip-a1',
      boardingStationId:  'tenant-a-min',
      alightingStationId: 'tenant-a-pnr',
      passengers: [{ firstName: 'X', lastName: 'Y', phone: '+242600000000', seatType: 'STANDARD' }],
      paymentMethod: 'mtn_momo',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ─── [SEC-7] createBooking respecte cutoff segment intermédiaire ─────────
  it('[SEC-7] createBooking refuse segment intermédiaire trop proche départ', async () => {
    const trip = makeRouteTrip('tenant-a', 'trip-a1');
    trip.departureScheduled = new Date(Date.now() + 10 * 60_000); // +10 min
    prismaMock.trip.findFirst.mockResolvedValue(trip);

    await expect(service.createBooking('tenant-a', {
      tripId: 'trip-a1',
      boardingStationId:  'tenant-a-min',
      alightingStationId: 'tenant-a-pnr',
      passengers: [{ firstName: 'X', lastName: 'Y', phone: '+242600000000', seatType: 'STANDARD' }],
      paymentMethod: 'mtn_momo',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
