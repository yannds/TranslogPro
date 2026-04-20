/**
 * Integration — Clôture fret + verrou LOAD colis (DB réelle).
 *
 * Auto-suffisant : crée ses propres entités infrastructure (tenant/role/user/
 * station/agency/route/bus) au lieu de partager `createIntegrationFixtures`
 * qui souffre d'erreurs TS pré-existantes liées au schema Prisma récent.
 *
 * Scénario :
 *   1. Crée trip + shipment + 2 parcels PACKED
 *   2. LOAD parcel #1 → succès
 *   3. Stamp Trip.freightClosedAt (équivalent endpoint closeFreight)
 *   4. LOAD parcel #2 → REFUS BadRequestException "Chargement clôturé"
 *   5. ARRIVE reste permis (verrou ne concerne que LOAD)
 */

import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PrismaService }  from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService }   from '@core/workflow/audit.service';
import { ParcelService }  from '../../../src/modules/parcel/parcel.service';
import { seedWorkflowConfigs, SEED } from '../setup/seed-workflow-configs';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SUITE_PREFIX = `tfclose-${RUN}`;

// ─── Constantes fixtures ─────────────────────────────────────────────────────
// Valeurs arbitraires utilisées uniquement pour satisfaire les contraintes
// NOT NULL du schéma Prisma. Aucune valeur métier n'est testée ici, donc on
// nomme explicitement pour éviter le bruit "magic number" dans le code.
const FIXTURE = {
  ROUTE_DISTANCE_KM:    100,
  ROUTE_BASE_PRICE:     5_000,
  BUS_CAPACITY:         50,
  BUS_LUGGAGE_KG:       500,
  BUS_LUGGAGE_M3:       2,
  SHIPMENT_REMAIN_KG:   100,
  PARCEL_WEIGHT_KG:     1.5,
  PARCEL_PRICE:         2_000,
  TRIP_DURATION_HOURS:  4,
  DEPARTURE_OFFSET_HOURS: 1,
} as const;
const HOUR_MS = 3_600_000;

let prismaClient: PrismaClient;
let prisma:    PrismaService;
let engine:    WorkflowEngine;
let parcelSvc: ParcelService;

let tenantId:      string;
let stationDestId: string;
let userId:        string;
let tripId:        string;

const ACTOR = () => ({
  id:       userId,
  tenantId,
  roleId:   SEED.roleId,
  agencyId: SEED.agencyId,
  roleName: 'integration-agent',
});

beforeAll(async () => {
  prismaClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  await prismaClient.$connect();
  prisma = prismaClient as unknown as PrismaService;
  (prisma as any).transact = (fn: (tx: PrismaService) => Promise<unknown>) =>
    prismaClient.$transaction((tx) => fn(tx as unknown as PrismaService));

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  engine = new WorkflowEngine(prisma, audit);

  // Stubs minimaux des deps non testées par cette suite.
  const crmResolverStub = {
    resolveOrCreate: jest.fn().mockResolvedValue(null),
    bumpCounters:    jest.fn().mockResolvedValue(undefined),
    recomputeSegmentsFor: jest.fn().mockResolvedValue(undefined),
  } as any;
  const crmClaimStub = { issueToken: jest.fn().mockResolvedValue(undefined) } as any;
  const notifStub    = { sendWithChannelFallback: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus     = { publish: jest.fn().mockResolvedValue(undefined) } as any;

  parcelSvc = new ParcelService(prisma, engine, crmResolverStub, crmClaimStub, notifStub, eventBus);

  await seedWorkflowConfigs(prismaClient);

  // ── Fixtures auto-suffisantes ────────────────────────────────────────────
  // On utilise SEED.tenantId/roleId/agencyId déjà créés par seedWorkflowConfigs
  // — pas besoin de re-créer le tenant/role.
  tenantId = SEED.tenantId;

  // Agency — requise par Bus.agencyId FK (SEED ne crée pas l'agency).
  await prismaClient.agency.upsert({
    where:  { id: SEED.agencyId },
    update: {},
    create: {
      id: SEED.agencyId, tenantId, name: 'Test Agency',
    },
  });

  // Stations (origin + dest) — IDs uniques par run pour éviter conflits
  const stationOrigin = await prismaClient.station.create({
    data: {
      id: `${SUITE_PREFIX}-st-orig`, tenantId, name: 'Origin', city: 'Dakar',
      type: 'PRINCIPALE', coordinates: {},
    },
  });
  const stationDest = await prismaClient.station.create({
    data: {
      id: `${SUITE_PREFIX}-st-dest`, tenantId, name: 'Destination', city: 'Thiès',
      type: 'PRINCIPALE', coordinates: {},
    },
  });
  stationDestId = stationDest.id;

  // User + Staff driver (User existe déjà via SEED ? recréons à part)
  const driverUser = await prismaClient.user.create({
    data: {
      id: `${SUITE_PREFIX}-user`, tenantId, email: `${SUITE_PREFIX}@test.io`,
      name: 'Driver', roleId: SEED.roleId, userType: 'STAFF', isActive: true,
    },
  });
  userId = driverUser.id;
  const driverStaff = await prismaClient.staff.create({
    data: {
      id: `${SUITE_PREFIX}-staff`, tenantId, userId: driverUser.id,
      agencyId: SEED.agencyId, status: 'ACTIVE', version: 1,
    },
  });

  // Route + Bus
  const route = await prismaClient.route.create({
    data: {
      id: `${SUITE_PREFIX}-route`, tenantId,
      name: 'TestRoute',
      originId: stationOrigin.id, destinationId: stationDest.id,
      distanceKm: FIXTURE.ROUTE_DISTANCE_KM, basePrice: FIXTURE.ROUTE_BASE_PRICE,
    },
  });
  const bus = await prismaClient.bus.create({
    data: {
      id: `${SUITE_PREFIX}-bus`, tenantId, agencyId: SEED.agencyId,
      plateNumber: 'TEST-001', model: 'Mercedes',
      capacity: FIXTURE.BUS_CAPACITY, status: 'AVAILABLE',
      luggageCapacityKg: FIXTURE.BUS_LUGGAGE_KG, luggageCapacityM3: FIXTURE.BUS_LUGGAGE_M3,
    },
  });

  // Trip BOARDING — départ dans 1h, arrivée 3h plus tard (durées fixtures).
  const trip = await prismaClient.trip.create({
    data: {
      id: `${SUITE_PREFIX}-trip`, tenantId,
      routeId: route.id, busId: bus.id, driverId: driverStaff.id,
      status: 'BOARDING',
      departureScheduled: new Date(Date.now() + FIXTURE.DEPARTURE_OFFSET_HOURS * HOUR_MS),
      arrivalScheduled:   new Date(Date.now() + FIXTURE.TRIP_DURATION_HOURS  * HOUR_MS),
      version: 1,
    },
  });
  tripId = trip.id;
}, 60_000);

afterAll(async () => {
  await prismaClient.$disconnect();
});

describe('Trip freight close + parcel LOAD lock', () => {
  let parcel1Id: string;
  let parcel2Id: string;
  let shipmentId: string;

  beforeAll(async () => {
    // Sanity check : tripId doit être défini par le outer beforeAll
    if (!tripId) throw new Error(`tripId not set — outer beforeAll skipped? tripId=${tripId}`);

    const shipment = await prismaClient.shipment.create({
      data: {
        id: `${SUITE_PREFIX}-shipment`,
        tenantId,
        trip:        { connect: { id: tripId } },
        destination: { connect: { id: stationDestId } },
        remainingWeight: FIXTURE.SHIPMENT_REMAIN_KG,
        status:  'OPEN',
        version: 1,
      },
    });
    shipmentId = shipment.id;

    const mkParcel = (suffix: string) => prismaClient.parcel.create({
      data: {
        id:            `${SUITE_PREFIX}-parcel-${suffix}`,
        tenantId, senderId: userId, shipmentId,
        trackingCode:  `${SUITE_PREFIX}-${suffix}`,
        weight: FIXTURE.PARCEL_WEIGHT_KG, price: FIXTURE.PARCEL_PRICE,
        destinationId: stationDestId,
        recipientInfo: { name: 'R', phone: '+221700000000', address: 'X' },
        // version=3 = post-CREATED→AT_ORIGIN→PACKED (3 transitions déjà
        // appliquées). Permet de démarrer le test direct au LOAD sans rejouer
        // toute la séquence.
        status: 'PACKED', version: 3,
      },
    });
    parcel1Id = (await mkParcel('p1')).id;
    parcel2Id = (await mkParcel('p2')).id;
  });

  it('autorise LOAD avant clôture (parcel #1 PACKED → LOADED)', async () => {
    const res = await parcelSvc.transition(tenantId, parcel1Id, 'LOAD', ACTOR() as any, `${RUN}-load1`);
    expect(res.toState).toBe('LOADED');
    const db = await prismaClient.parcel.findUniqueOrThrow({ where: { id: parcel1Id } });
    expect(db.status).toBe('LOADED');
  });

  it('refuse LOAD APRÈS clôture (parcel #2)', async () => {
    await prismaClient.trip.update({
      where: { id: tripId },
      data:  { freightClosedAt: new Date(), freightClosedById: userId },
    });

    await expect(
      parcelSvc.transition(tenantId, parcel2Id, 'LOAD', ACTOR() as any, `${RUN}-load2`),
    ).rejects.toThrow(BadRequestException);

    const db = await prismaClient.parcel.findUniqueOrThrow({ where: { id: parcel2Id } });
    expect(db.status).toBe('PACKED'); // pas chargé
  });

  it('autorise ARRIVE même après clôture (verrou ne concerne que LOAD)', async () => {
    await prismaClient.parcel.update({
      where: { id: parcel1Id },
      data:  { status: 'IN_TRANSIT', version: { increment: 1 } },
    });
    const res = await parcelSvc.transition(tenantId, parcel1Id, 'ARRIVE', ACTOR() as any, `${RUN}-arrive1`);
    expect(res.toState).toBe('ARRIVED');
  });
});
