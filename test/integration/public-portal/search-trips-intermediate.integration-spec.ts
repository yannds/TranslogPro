/**
 * Integration test — PublicPortalService.searchTrips() avec segments
 * intermédiaires sur une DB Postgres réelle (Testcontainers).
 *
 * Vérifie le contrat Prisma réel (JSON @default, relations, unique
 * constraints) + la matching pipeline complète :
 *   1. Waypoint intermédiaire trouvé via city insensitive
 *   2. Prix résolu depuis RouteSegmentPrice (vraie table)
 *   3. Fallback proportionnel actif quand prix non configuré
 *   4. Politique `intermediateBookingEnabled` lue depuis la vraie config
 *   5. Trips d'autres tenants jamais retournés (RLS applicatif)
 */

jest.mock('@pdfme/generator', () => ({ generate: jest.fn() }), { virtual: true });
jest.mock('@pdfme/common', () => ({}), { virtual: true });
jest.mock('@pdfme/schemas', () => ({ text: {}, image: {}, barcodes: {}, rectangle: {}, line: {}, ellipse: {}, table: {} }), { virtual: true });

import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { PublicPortalService } from '../../../src/modules/public-portal/public-portal.service';

let prismaClient: PrismaClient;
let prisma:       PrismaService;
let service:      PublicPortalService;

const T_A_ID = 'tenant-intertest-a';
const T_B_ID = 'tenant-intertest-b';
const SLUG_A = 't-intertest-a';
const SLUG_B = 't-intertest-b';

async function cleanupTestData() {
  // Ordre FK : ticket → trip → staff → user → waypoints → route → bus → stations → config → tenant
  const tenantIds = [T_A_ID, T_B_ID];
  await prismaClient.ticket.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.trip.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.staff.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.routeSegmentPrice.deleteMany({ where: { route: { tenantId: { in: tenantIds } } } });
  await prismaClient.waypoint.deleteMany({ where: { route: { tenantId: { in: tenantIds } } } });
  await prismaClient.route.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.bus.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.station.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.tenantBusinessConfig.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.agency.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaClient.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

async function createTenantWithRoute(tenantId: string, slug: string) {
  await prismaClient.tenant.create({
    data: {
      id: tenantId, slug, name: `Test ${slug}`,
      currency: 'XAF', country: 'CG', language: 'fr',
      isActive: true, provisionStatus: 'ACTIVE',
    },
  });

  await prismaClient.agency.create({
    data: { id: `ag-${tenantId}`, tenantId, name: 'Siège' },
  });

  // User + Staff pour satisfaire Trip.driverId NOT NULL
  await prismaClient.user.create({
    data: {
      id: `u-${tenantId}-drv`, tenantId, agencyId: `ag-${tenantId}`,
      email: `drv-${tenantId}@inter.test`, name: 'Driver Test', userType: 'STAFF',
    },
  });
  await prismaClient.staff.create({
    data: {
      id: `staff-${tenantId}-drv`, tenantId, agencyId: `ag-${tenantId}`,
      userId: `u-${tenantId}-drv`, status: 'ACTIVE', version: 1,
    },
  });

  // Stations
  await prismaClient.station.create({
    data: { id: `${tenantId}-brz`, tenantId, name: 'Gare Brazzaville',
            city: 'Brazzaville', type: 'PRINCIPALE', coordinates: {} },
  });
  await prismaClient.station.create({
    data: { id: `${tenantId}-min`, tenantId, name: 'Gare Mindouli',
            city: 'Mindouli', type: 'SECONDAIRE', coordinates: {} },
  });
  await prismaClient.station.create({
    data: { id: `${tenantId}-bou`, tenantId, name: 'Gare Bouansa',
            city: 'Bouansa', type: 'SECONDAIRE', coordinates: {} },
  });
  await prismaClient.station.create({
    data: { id: `${tenantId}-pnr`, tenantId, name: 'Gare Pointe-Noire',
            city: 'Pointe-Noire', type: 'PRINCIPALE', coordinates: {} },
  });

  // Route Brazza → PNR via Mindouli (km 120) et Bouansa (km 230), total 500 km
  await prismaClient.route.create({
    data: {
      id: `route-${tenantId}`, tenantId, name: 'Brazza → PNR',
      originId: `${tenantId}-brz`, destinationId: `${tenantId}-pnr`,
      distanceKm: 500, basePrice: 15_000,
      allowProportionalFallback: true,
    },
  });

  await prismaClient.waypoint.create({
    data: { routeId: `route-${tenantId}`, stationId: `${tenantId}-min`,
            order: 1, distanceFromOriginKm: 120, tollCostXaf: 500 },
  });
  await prismaClient.waypoint.create({
    data: { routeId: `route-${tenantId}`, stationId: `${tenantId}-bou`,
            order: 2, distanceFromOriginKm: 230, tollCostXaf: 0 },
  });

  // Prix manuel pour Mindouli → Bouansa = 4 000 XAF (override le proportionnel)
  await prismaClient.routeSegmentPrice.create({
    data: {
      routeId: `route-${tenantId}`,
      fromStationId: `${tenantId}-min`,
      toStationId:   `${tenantId}-bou`,
      basePriceXaf:  4_000,
    },
  });

  // Bus
  await prismaClient.bus.create({
    data: {
      id: `bus-${tenantId}`, tenantId, agencyId: `ag-${tenantId}`,
      plateNumber: `X-${tenantId.slice(-6)}`, model: 'Mercedes',
      capacity: 50, luggageCapacityKg: 500, luggageCapacityM3: 10,
    },
  });

  // Trip demain à midi local. Ancrage déterministe : évite les dérives timezone
  // quand le test tourne le soir (trip today+6h pouvait basculer au lendemain
  // et tomber hors de dayStart/dayEnd) ET satisfait toujours le cutoff
  // `intermediateBookingCutoffMins=30` (demain midi est >> 30 min de maintenant).
  const noon = new Date();
  noon.setDate(noon.getDate() + 1);
  noon.setHours(12, 0, 0, 0);
  const arrival = new Date(noon.getTime() + 8 * 3600_000);
  await prismaClient.trip.create({
    data: {
      id: `trip-${tenantId}`, tenantId,
      routeId: `route-${tenantId}`, busId: `bus-${tenantId}`,
      driverId: `staff-${tenantId}-drv`,
      status: 'OPEN',
      departureScheduled: noon,
      arrivalScheduled:   arrival,
      version: 1,
    },
  });

  // TenantBusinessConfig
  await prismaClient.tenantBusinessConfig.create({
    data: {
      tenantId,
      intermediateBookingEnabled:    true,
      intermediateBookingCutoffMins: 30,
    },
  });
}

beforeAll(async () => {
  prismaClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  await prismaClient.$connect();

  prisma = prismaClient as unknown as PrismaService;
  (prisma as any).transact = (fn: (tx: PrismaService) => Promise<unknown>) =>
    prismaClient.$transaction((tx) => fn(tx as unknown as PrismaService));

  const redisMock = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
  };

  service = new PublicPortalService(
    prisma,
    {} as any, // brandService
    {} as any, // qrService
    {} as any, // documentsService
    {} as any, // policyService
    {} as any, // refundService
    redisMock as any,
    {} as any, // storage
    {} as any, // eventBus
    {} as any, // notification
    {} as any, // crmResolver
    {} as any, // crmClaim
    {} as any, // announcements
  );

  await cleanupTestData();
  await createTenantWithRoute(T_A_ID, SLUG_A);
  await createTenantWithRoute(T_B_ID, SLUG_B);
}, 60_000);

afterAll(async () => {
  await cleanupTestData();
  await prismaClient.$disconnect();
});

describe('[INTEG] PublicPortalService.searchTrips — intermediate stops (real DB)', () => {
  it('match OD complet : Brazzaville → Pointe-Noire', async () => {
    const today = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12,0,0,0); return d.toISOString(); })();
    const results = await service.searchTrips(SLUG_A, {
      departure: 'Brazzaville', arrival: 'Pointe-Noire', date: today,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const trip = (results as any).find((r: any) => r.id === `trip-${T_A_ID}`);
    expect(trip).toBeTruthy();
    expect(trip.isIntermediateSegment).toBe(false);
    expect(trip.price).toBe(15_000);
    expect(trip.boardingStationId).toBe(`${T_A_ID}-brz`);
    expect(trip.alightingStationId).toBe(`${T_A_ID}-pnr`);
  });

  it('match segment intermédiaire + prix manuel : Mindouli → Bouansa = 4000', async () => {
    const today = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12,0,0,0); return d.toISOString(); })();
    const results = await service.searchTrips(SLUG_A, {
      departure: 'Mindouli', arrival: 'Bouansa', date: today,
    });

    const trip = (results as any).find((r: any) => r.id === `trip-${T_A_ID}`);
    expect(trip).toBeTruthy();
    expect(trip.isIntermediateSegment).toBe(true);
    expect(trip.isAutoCalculated).toBe(false); // prix configuré manuellement
    expect(trip.price).toBe(4_000);
  });

  it('fallback proportionnel : Brazzaville → Mindouli (prix non configuré)', async () => {
    const today = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12,0,0,0); return d.toISOString(); })();
    const results = await service.searchTrips(SLUG_A, {
      departure: 'Brazzaville', arrival: 'Mindouli', date: today,
    });

    const trip = (results as any).find((r: any) => r.id === `trip-${T_A_ID}`);
    expect(trip).toBeTruthy();
    expect(trip.isIntermediateSegment).toBe(true);
    expect(trip.isAutoCalculated).toBe(true);
    // Proportionnel : 15000 * 120/500 = 3600 + péage Mindouli 500 = 4100
    expect(trip.price).toBe(4_100);
  });

  it('cross-tenant isolation : recherche sur tenant-A ne voit pas trip tenant-B', async () => {
    const today = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12,0,0,0); return d.toISOString(); })();
    const results = await service.searchTrips(SLUG_A, {
      departure: 'Brazzaville', arrival: 'Pointe-Noire', date: today,
    });

    const crossTenantLeak = (results as any).find((r: any) => r.id === `trip-${T_B_ID}`);
    expect(crossTenantLeak).toBeUndefined();

    // Et inversement
    const resultsB = await service.searchTrips(SLUG_B, {
      departure: 'Brazzaville', arrival: 'Pointe-Noire', date: today,
    });
    const reverseLeak = (resultsB as any).find((r: any) => r.id === `trip-${T_A_ID}`);
    expect(reverseLeak).toBeUndefined();
  });

  it('policy intermediateBookingEnabled=false sur tenant-B bloque segments', async () => {
    await prismaClient.tenantBusinessConfig.update({
      where: { tenantId: T_B_ID },
      data:  { intermediateBookingEnabled: false },
    });

    const today = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12,0,0,0); return d.toISOString(); })();
    const resultsB = await service.searchTrips(SLUG_B, {
      departure: 'Mindouli', arrival: 'Bouansa', date: today,
    });

    expect(resultsB).toEqual([]);

    // Mais OD reste accessible
    const odResultsB = await service.searchTrips(SLUG_B, {
      departure: 'Brazzaville', arrival: 'Pointe-Noire', date: today,
    });
    expect(odResultsB.length).toBeGreaterThanOrEqual(1);

    // Remet à true pour ne pas polluer d'autres tests
    await prismaClient.tenantBusinessConfig.update({
      where: { tenantId: T_B_ID },
      data:  { intermediateBookingEnabled: true },
    });
  });
});
