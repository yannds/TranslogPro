/**
 * Fixtures d'intégration — entités minimales satisfaisant les FK Prisma.
 *
 * Design : upsert sur toutes les entités "infrastructure" (stations, route, bus, agency, users).
 * Les entités "transitionnelles" (trip, ticket, parcel) sont créées à la demande
 * dans chaque suite pour éviter les conflits de statut entre suites parallèles.
 *
 * Hiérarchie :
 *   Tenant → Station → Agency → Route → Bus → User
 */

import { PrismaClient } from '@prisma/client';
import { SEED } from './seed-workflow-configs';

export interface IntegrationFixtures {
  stationOriginId:      string;
  stationDestinationId: string;
  agencyId:             string;
  routeId:              string;
  busId:                string;
  driverId:             string;
  passengerId:          string;
  // Entités transitionnelles créées à la première invocation — chaque suite crée les siennes
  tripId:               string;
  ticketId:             string;
  parcelId:             string;
}

// IDs fixes pour toutes les entités infrastructure (upsert safe)
const IDS = {
  stationOrigin: 'station-integ-origin',
  stationDest:   'station-integ-dest',
  agency:        SEED.agencyId,
  route:         'route-integ-001',
  bus:           'bus-integ-001',
  driver:        'user-integ-driver',
  passenger:     'user-integ-passenger',
} as const;

export async function createIntegrationFixtures(prisma: PrismaClient): Promise<IntegrationFixtures> {
  const { tenantId, roleId } = SEED;

  // ── Stations (upsert) ───────────────────────────────────────────────────────
  await prisma.station.upsert({
    where:  { id: IDS.stationOrigin },
    update: {},
    create: {
      id:          IDS.stationOrigin,
      tenantId,
      name:        'Gare Dakar Plateau',
      city:        'Dakar',
      type:        'PRINCIPALE',
      coordinates: { lat: 14.693, lng: -17.448 },
    },
  });

  await prisma.station.upsert({
    where:  { id: IDS.stationDest },
    update: {},
    create: {
      id:          IDS.stationDest,
      tenantId,
      name:        'Gare Thiès',
      city:        'Thiès',
      type:        'PRINCIPALE',
      coordinates: { lat: 14.788, lng: -16.926 },
    },
  });

  // ── Agency (upsert) ─────────────────────────────────────────────────────────
  await prisma.agency.upsert({
    where:  { id: IDS.agency },
    update: {},
    create: {
      id:        IDS.agency,
      tenantId,
      name:      'Agence Dakar',
      stationId: IDS.stationOrigin,
    },
  });

  // ── Route (upsert) ──────────────────────────────────────────────────────────
  await prisma.route.upsert({
    where:  { id: IDS.route },
    update: {},
    create: {
      id:            IDS.route,
      tenantId,
      name:          'Dakar → Thiès',
      originId:      IDS.stationOrigin,
      destinationId: IDS.stationDest,
      distanceKm:    70,
      basePrice:     3500,
    },
  });

  // ── Bus (upsert via plateNumber — unique) ───────────────────────────────────
  const bus = await prisma.bus.upsert({
    where:  { plateNumber: 'DK-INTEG-001' },
    update: {},
    create: {
      id:                  IDS.bus,
      tenantId,
      plateNumber:         'DK-INTEG-001',
      model:               'Mercedes Sprinter',
      capacity:            50,
      luggageCapacityKg:   500,
      luggageCapacityM3:   10,
    },
  });

  // ── Users (upsert via email — unique) ───────────────────────────────────────
  const driver = await prisma.user.upsert({
    where:  { email: 'driver-integ@test.local' },
    update: {},
    create: {
      id:       IDS.driver,
      tenantId,
      agencyId: IDS.agency,
      roleId,
      email:    'driver-integ@test.local',
      name:     'Driver Integration',
      userType: 'STAFF',
    },
  });

  const passenger = await prisma.user.upsert({
    where:  { email: 'passenger-integ@test.local' },
    update: {},
    create: {
      id:       IDS.passenger,
      tenantId,
      email:    'passenger-integ@test.local',
      name:     'Passenger Integration',
      userType: 'CUSTOMER',
    },
  });

  // ── Trip (créé à chaque fois pour avoir une entité PLANNED fraîche) ─────────
  const trip = await prisma.trip.create({
    data: {
      tenantId,
      routeId:             IDS.route,
      busId:               bus.id,
      driverId:            driver.id,
      status:              'PLANNED',
      version:             1,
      departureScheduled:  new Date('2026-05-01T08:00:00Z'),
      arrivalScheduled:    new Date('2026-05-01T10:00:00Z'),
    },
  });

  // ── Ticket (créé à chaque fois — PENDING_PAYMENT frais) ────────────────────
  const ticket = await prisma.ticket.create({
    data: {
      tenantId,
      tripId:       trip.id,
      passengerId:  passenger.id,
      passengerName:'Passenger Integration',
      pricePaid:    3500,
      agencyId:     IDS.agency,
      status:       'PENDING_PAYMENT',
      qrCode:       `qr-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      version:      1,
    },
  });

  // ── Parcel (créé à chaque fois) ─────────────────────────────────────────────
  const parcel = await prisma.parcel.create({
    data: {
      tenantId,
      senderId:      driver.id,
      trackingCode:  `INTEG-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      weight:        3.5,
      price:         5000,
      destinationId: IDS.stationDest,
      recipientInfo: { name: 'Bob', phone: '+221700000001', address: 'Thiès' },
      status:        'CREATED',
      version:       1,
    },
  });

  return {
    stationOriginId:      IDS.stationOrigin,
    stationDestinationId: IDS.stationDest,
    agencyId:             IDS.agency,
    routeId:              IDS.route,
    busId:                bus.id,
    driverId:             driver.id,
    passengerId:          passenger.id,
    tripId:               trip.id,
    ticketId:             ticket.id,
    parcelId:             parcel.id,
  };
}
