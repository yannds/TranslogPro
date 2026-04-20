/**
 * E2E API tests — Cycle de vie trajet : freight close + manifest guard + ETA.
 *
 * Ne crée PAS de tenant éphémère : on utilise le tenant `pw-e2e-tenant` déjà
 * provisionné par `scripts/seed-e2e.ts` (cf. test/playwright/README.md). On
 * tourne avec l'admin `e2e-tenant-admin@e2e.local`. Aucune dépendance à
 * trans-express / citybus-congo (qui restent les démos).
 *
 * Le setup crée — via Prisma direct — les entités infrastructure manquantes
 * (station/route/bus/staff/trip) puis exerce les NOUVEAUX endpoints HTTP :
 *
 *   [TFD-1] POST /flight-deck/trips/:id/freight/close
 *           → Trip.freightClosedAt + freightClosedById bien stampés en DB
 *           → idempotent (2e appel ne re-stampe pas)
 *
 *   [TFD-2] POST /flight-deck/trips/:id/status { status: 'IN_PROGRESS' }
 *           → 400 + message "MANIFEST_NOT_SIGNED" sans manifest signé.
 *           Le bypass est impossible côté API.
 *
 *   [TFD-3] GET /flight-deck/trips/:id/live-stats
 *           → expose la NOUVELLE shape Prévu/Estimé/Effectif :
 *             scheduledDeparture, estimatedDeparture, actualDeparture,
 *             scheduledArrival, estimatedArrival, actualArrival,
 *             delayMinutes, isFrozen.
 */

import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Coût bcrypt aligné sur le seed-e2e — pas de magic dans le code de test.
const BCRYPT_COST = 10;

// ─── Constantes fixtures ─────────────────────────────────────────────────────
// Pas de magic number en code de test : tous les littéraux nécessaires aux FK
// NOT NULL sont nommés. Aucune valeur métier n'est testée ici — ce sont des
// remplissages pour faire passer les contraintes Prisma.
const FIXTURE = {
  ROUTE_DISTANCE_KM:      100,
  ROUTE_BASE_PRICE:       5_000,
  BUS_CAPACITY:           50,
  BUS_LUGGAGE_KG:         500,
  BUS_LUGGAGE_M3:         2,
  TRIP_DURATION_HOURS:    4,
  DEPARTURE_OFFSET_HOURS: 1,
} as const;
const HOUR_MS = 3_600_000;

// ─── Tenant E2E pré-provisionné ──────────────────────────────────────────────
const E2E = {
  TENANT_ID:    '2d48bdfa-5f6e-433d-ba70-5410ca870865',
  HOSTNAME:     'pw-e2e-tenant.translog.test',
  ADMIN_EMAIL:  'e2e-tenant-admin@e2e.local',
  ADMIN_PASSWD: 'Passw0rd!E2E',
} as const;

const SUITE = `pw-tfd-${Date.now()}`;

let prisma: PrismaClient;
let cookie: string;

let agencyId:    string;
let stationOrigId: string;
let stationDestId: string;
let routeId:     string;
let busId:       string;
let driverStaffId: string;
let tripId:      string;

test.describe.serial('[E2E-API] Trip lifecycle — freight + manifest guards', () => {
  test.beforeAll(async ({ request }) => {
    prisma = new PrismaClient();
    await prisma.$connect();

    // ── 0. Reset password admin (idempotent, pour décorréler du seed-e2e) ─
    // Le password sur `pw-e2e-tenant` peut diverger de la valeur connue selon
    // les exécutions précédentes. On le re-hashe ici pour rendre le test
    // self-contained — ne touche QUE l'account credential du user e2e admin.
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: E2E.TENANT_ID, email: E2E.ADMIN_EMAIL },
    });
    const account = await prisma.account.findFirstOrThrow({
      where: { providerId: 'credential', accountId: E2E.ADMIN_EMAIL },
    });
    await prisma.account.update({
      where: { id: account.id },
      data:  { password: await bcrypt.hash(E2E.ADMIN_PASSWD, BCRYPT_COST) },
    });

    // ── 1. Login admin ────────────────────────────────────────────────────
    const signIn = await request.post('/api/auth/sign-in', {
      data:    { email: E2E.ADMIN_EMAIL, password: E2E.ADMIN_PASSWD },
      headers: { Host: E2E.HOSTNAME },
    });
    expect(signIn.status()).toBe(200);
    cookie = signIn.headers()['set-cookie']!.split(';')[0];

    // ── 2. Setup infra via Prisma direct (FK NOT NULL satisfaits) ─────────
    // L'agence existe déjà (cf. user prompt) → on récupère la 1re du tenant.
    const agency = await prisma.agency.findFirstOrThrow({ where: { tenantId: E2E.TENANT_ID } });
    agencyId = agency.id;

    const stationOrig = await prisma.station.create({
      data: {
        id: `${SUITE}-st-orig`, tenantId: E2E.TENANT_ID,
        name: 'PW Origin', city: 'Dakar', type: 'PRINCIPALE', coordinates: {},
      },
    });
    stationOrigId = stationOrig.id;

    const stationDest = await prisma.station.create({
      data: {
        id: `${SUITE}-st-dest`, tenantId: E2E.TENANT_ID,
        name: 'PW Destination', city: 'Thiès', type: 'PRINCIPALE', coordinates: {},
      },
    });
    stationDestId = stationDest.id;

    const route = await prisma.route.create({
      data: {
        id: `${SUITE}-route`, tenantId: E2E.TENANT_ID, name: 'PW Route',
        originId: stationOrigId, destinationId: stationDestId,
        distanceKm: FIXTURE.ROUTE_DISTANCE_KM, basePrice: FIXTURE.ROUTE_BASE_PRICE,
      },
    });
    routeId = route.id;

    const bus = await prisma.bus.create({
      data: {
        id: `${SUITE}-bus`, tenantId: E2E.TENANT_ID, agencyId,
        plateNumber: `PW-${SUITE.slice(-6)}`, model: 'PW Mercedes',
        capacity: FIXTURE.BUS_CAPACITY, status: 'AVAILABLE',
        luggageCapacityKg: FIXTURE.BUS_LUGGAGE_KG, luggageCapacityM3: FIXTURE.BUS_LUGGAGE_M3,
      },
    });
    busId = bus.id;

    // Staff driver — l'admin user a potentiellement déjà un Staff (auto-backfill
    // au boot via backfillStaffFromUsers). On upsert par userId unique pour être
    // idempotent avec ou sans enregistrement préexistant.
    const driverStaff = await prisma.staff.upsert({
      where:  { userId: adminUser.id },
      update: { agencyId, status: 'ACTIVE' },
      create: {
        id: `${SUITE}-staff`, tenantId: E2E.TENANT_ID,
        userId: adminUser.id, agencyId, status: 'ACTIVE', version: 1,
      },
    });
    driverStaffId = driverStaff.id;

    // Trip BOARDING — départ dans 1h, arrivée 4h plus tard (durées fixtures).
    const trip = await prisma.trip.create({
      data: {
        id: `${SUITE}-trip`, tenantId: E2E.TENANT_ID,
        routeId, busId, driverId: driverStaffId,
        status: 'BOARDING',
        departureScheduled: new Date(Date.now() + FIXTURE.DEPARTURE_OFFSET_HOURS * HOUR_MS),
        arrivalScheduled:   new Date(Date.now() + FIXTURE.TRIP_DURATION_HOURS  * HOUR_MS),
        version: 1,
      },
    });
    tripId = trip.id;
  });

  test.afterAll(async () => {
    // Cleanup — l'ordre respecte les FK (parcels/shipments d'abord si présents,
    // puis trip, bus, route, stations). Le test n'en crée pas tous, on best-effort.
    try { await prisma.parcel.deleteMany({ where: { id: { startsWith: SUITE } } }); } catch {}
    try { await prisma.shipment.deleteMany({ where: { id: { startsWith: SUITE } } }); } catch {}
    try { await prisma.manifest.deleteMany({ where: { tripId } }); } catch {}
    try { await prisma.trip.deleteMany({ where: { id: tripId } }); } catch {}
    try { await prisma.bus.deleteMany({ where: { id: busId } }); } catch {}
    try { await prisma.route.deleteMany({ where: { id: routeId } }); } catch {}
    try { await prisma.station.deleteMany({ where: { id: { in: [stationOrigId, stationDestId] } } }); } catch {}
    // Ne supprimer que si CE test a créé le Staff (id préfixé SUITE). Sinon on
    // ne touche pas au Staff auto-backfillé de l'admin tenant.
    try {
      if (driverStaffId && driverStaffId.startsWith(SUITE)) {
        await prisma.staff.deleteMany({ where: { id: driverStaffId } });
      }
    } catch {}
    await prisma.$disconnect();
  });

  // ─── [TFD-1] freight close ────────────────────────────────────────────────

  test('[TFD-1] POST freight/close → stampe freightClosedAt + idempotent', async ({ request }) => {
    // 1er appel : stamp
    const close1 = await request.post(
      `/api/tenants/${E2E.TENANT_ID}/flight-deck/trips/${tripId}/freight/close`,
      { headers: { Host: E2E.HOSTNAME, Cookie: cookie }, data: {} },
    );
    expect(close1.status()).toBe(201);
    const body1 = await close1.json();
    expect(body1.id).toBe(tripId);
    expect(body1.freightClosedAt).toBeTruthy();

    const dbAfter1 = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(dbAfter1.freightClosedAt).not.toBeNull();
    const stamp1 = dbAfter1.freightClosedAt!.toISOString();

    // 2e appel : idempotent — pas de re-stamp
    const close2 = await request.post(
      `/api/tenants/${E2E.TENANT_ID}/flight-deck/trips/${tripId}/freight/close`,
      { headers: { Host: E2E.HOSTNAME, Cookie: cookie }, data: {} },
    );
    expect(close2.status()).toBe(201);

    const dbAfter2 = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(dbAfter2.freightClosedAt!.toISOString()).toBe(stamp1);
  });

  // ─── [TFD-2] manifest guard ───────────────────────────────────────────────

  test('[TFD-2] POST status:IN_PROGRESS sans manifest → 400 MANIFEST_NOT_SIGNED', async ({ request }) => {
    // Aucun manifest signé pour ce trip → la transition doit échouer en 400.
    const res = await request.post(
      `/api/tenants/${E2E.TENANT_ID}/flight-deck/trips/${tripId}/status`,
      { headers: { Host: E2E.HOSTNAME, Cookie: cookie }, data: { status: 'IN_PROGRESS' } },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('MANIFEST_NOT_SIGNED');

    // Trip doit rester BOARDING — bypass impossible
    const db = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(db.status).toBe('BOARDING');
    expect(db.departureActual).toBeNull();
  });

  // ─── [TFD-3] live-stats Prévu/Estimé/Effectif ─────────────────────────────

  test('[TFD-3] GET live-stats expose scheduled/estimated/actual + isFrozen', async ({ request }) => {
    const res = await request.get(
      `/api/tenants/${E2E.TENANT_ID}/flight-deck/trips/${tripId}/live-stats`,
      { headers: { Host: E2E.HOSTNAME, Cookie: cookie } },
    );
    expect(res.status()).toBe(200);
    const stats = await res.json();

    // Shape contractuelle — toutes les clés DOIVENT être présentes pour que
    // les écrans (mobile + display web) puissent figer l'affichage.
    expect(stats).toHaveProperty('scheduledDeparture');
    expect(stats).toHaveProperty('estimatedDeparture');
    expect(stats).toHaveProperty('actualDeparture');
    expect(stats).toHaveProperty('scheduledArrival');
    expect(stats).toHaveProperty('estimatedArrival');
    expect(stats).toHaveProperty('actualArrival');
    expect(stats).toHaveProperty('delayMinutes');
    expect(stats).toHaveProperty('isFrozen');

    // Trip BOARDING pas encore parti → actualDeparture null, isFrozen false.
    expect(stats.actualDeparture).toBeNull();
    expect(stats.actualArrival).toBeNull();
    expect(stats.isFrozen).toBe(false);

    // Le trip est planifié dans 1h → pas de retard
    expect(stats.delayMinutes).toBe(0);
  });
});
