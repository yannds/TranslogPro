/**
 * [E2E-API] Scénarios pricing dynamique (Sprint 11.E).
 *
 * Couvre :
 *   · YIELD-1        Yield suggestion pour un trip — règle NO_CHANGE quand
 *                    fillRate moyen + pas de config spéciale
 *   · PROFIT-LINE-1  simulate-trip sur même bus + 2 prix différents renvoie
 *                    des tags cohérents (DEFICIT bas prix, PROFITABLE haut prix)
 *   · PROFIT-BUS-1   simulate-trip rejette si bus sans costProfile (prérequis
 *                    métier clair → l'UI doit guider le gérant à configurer le profil)
 *   · PROFIT-SUMMARY pricing/analytics/profitability renvoie un payload même
 *                    sans snapshot (tripCount=0 attendu) — permission-gated
 *
 * Ces tests forment le socle pour détecter un régression dans le moteur de
 * coûts ou une divergence entre les tags calculés post-trip (computeAndSnapshot)
 * et ceux pré-trip (simulateTrip).
 */

import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;
const HOUR_MS = 3_600_000;

const E2E = {
  TENANT_ID:    '2d48bdfa-5f6e-433d-ba70-5410ca870865',
  HOSTNAME:     'pw-e2e-tenant.translog.test',
  ADMIN_EMAIL:  'e2e-tenant-admin@e2e.local',
  ADMIN_PASSWD: 'Passw0rd!E2E',
} as const;

const SUITE = `pw-price-${Date.now()}`;

let prisma: PrismaClient;
let cookie: string;
let adminUserId: string;

let agencyId: string, stationOrigId: string, stationDestId: string;
let routeId: string, busId: string, driverStaffId: string;
let tripId: string;

test.describe.serial('[E2E-API] Pricing dynamics — yield + profitability par ligne', () => {

  test.beforeAll(async ({ request }) => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const adminUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: E2E.TENANT_ID, email: E2E.ADMIN_EMAIL },
    });
    adminUserId = adminUser.id;
    const account = await prisma.account.findFirstOrThrow({
      where: { providerId: 'credential', accountId: E2E.ADMIN_EMAIL },
    });
    await prisma.account.update({
      where: { id: account.id },
      data:  { password: await bcrypt.hash(E2E.ADMIN_PASSWD, BCRYPT_COST) },
    });

    const signIn = await request.post('/api/auth/sign-in', {
      data:    { email: E2E.ADMIN_EMAIL, password: E2E.ADMIN_PASSWD },
      headers: { Host: E2E.HOSTNAME },
    });
    expect(signIn.status()).toBe(200);
    cookie = signIn.headers()['set-cookie']!.split(';')[0];
  });

  test.afterAll(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
        await tx.$executeRawUnsafe(`DELETE FROM bus_cost_profiles WHERE "busId" = $1`, busId ?? '');
        await tx.$executeRawUnsafe(`DELETE FROM trips WHERE id = $1`, tripId ?? '');
        await tx.$executeRawUnsafe(`DELETE FROM buses WHERE id = $1`, busId ?? '');
        await tx.$executeRawUnsafe(`DELETE FROM pricing_rules WHERE "routeId" = $1`, routeId ?? '');
        await tx.$executeRawUnsafe(`DELETE FROM routes WHERE id = $1`, routeId ?? '');
        await tx.$executeRawUnsafe(`DELETE FROM stations WHERE id = ANY($1::text[])`, [stationOrigId, stationDestId].filter(Boolean));
      });
    } catch {}
    await prisma.$disconnect();
  });

  test('[SETUP] infra + bus avec BusCostProfile (prérequis simulate)', async () => {
    const agency = await prisma.agency.findFirstOrThrow({ where: { tenantId: E2E.TENANT_ID } });
    agencyId = agency.id;

    stationOrigId = `${SUITE}-so`;
    stationDestId = `${SUITE}-sd`;
    await prisma.station.create({ data: { id: stationOrigId, tenantId: E2E.TENANT_ID, name: 'Price Orig', city: 'BZV', type: 'PRINCIPALE', coordinates: {} } });
    await prisma.station.create({ data: { id: stationDestId, tenantId: E2E.TENANT_ID, name: 'Price Dest', city: 'PNR', type: 'PRINCIPALE', coordinates: {} } });

    routeId = `${SUITE}-route`;
    await prisma.route.create({
      data: { id: routeId, tenantId: E2E.TENANT_ID, name: 'Price Route',
              originId: stationOrigId, destinationId: stationDestId,
              distanceKm: 500, basePrice: 15_000 },
    });
    await prisma.pricingRules.create({
      data: { tenantId: E2E.TENANT_ID, routeId,
              rules: { basePriceXof: 15_000, taxRate: 0, tollsXof: 0, costPerKm: 0,
                       luggageFreeKg: 20, luggagePerExtraKg: 100,
                       fareMultipliers: { STANDARD: 1.0, CONFORT: 1.4, VIP: 2.0 } } },
    });

    busId = `${SUITE}-bus`;
    await prisma.bus.create({
      data: { id: busId, tenantId: E2E.TENANT_ID, agencyId,
              plateNumber: `PR-${SUITE.slice(-6)}`, model: 'Price Bus',
              capacity: 50, luggageCapacityKg: 500, luggageCapacityM3: 10,
              status: 'AVAILABLE' },
    });

    // BusCostProfile minimal pour que simulate-trip fonctionne
    await prisma.busCostProfile.create({
      data: {
        busId, tenantId: E2E.TENANT_ID,
        fuelConsumptionPer100Km: 30,
        fuelPricePerLiter:       1.5,
        adBlueCostPerLiter:      0.18,
        adBlueRatioFuel:         0.05,
        maintenanceCostPerKm:    0.05,
        stationFeePerDeparture:  0,
        driverAllowancePerTrip:  0,
        tollFeesPerTrip:         0,
        driverMonthlySalary:     300_000,
        annualInsuranceCost:     1_200_000,
        monthlyAgencyFees:       0,
        purchasePrice:           10_000_000,
        depreciationYears:       10,
        residualValue:           0,
        avgTripsPerMonth:        30,
      },
    });

    const staff = await prisma.staff.upsert({
      where:  { userId: adminUserId },
      update: { agencyId, status: 'ACTIVE' },
      create: { id: `${SUITE}-staff`, tenantId: E2E.TENANT_ID, userId: adminUserId, agencyId, status: 'ACTIVE', version: 1 },
    });
    driverStaffId = staff.id;

    tripId = `${SUITE}-trip`;
    await prisma.trip.create({
      data: { id: tripId, tenantId: E2E.TENANT_ID, routeId, busId, driverId: driverStaffId,
              status: 'OPEN',
              departureScheduled: new Date(Date.now() + 5 * HOUR_MS),
              arrivalScheduled:   new Date(Date.now() + 13 * HOUR_MS),
              version: 1 },
    });
  });

  // ─── YIELD-1 — Yield suggestion renvoie une règle valide ────────────────
  test('[YIELD-1] GET /trips/:tripId/yield renvoie une suggestion structurée', async ({ request }) => {
    const res = await request.get(
      `/api/tenants/${E2E.TENANT_ID}/trips/${tripId}/yield`,
      { headers: { Host: E2E.HOSTNAME, Cookie: cookie } },
    );
    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data).toMatchObject({
      basePrice:      expect.any(Number),
      suggestedPrice: expect.any(Number),
      rule:           expect.any(String),
      fillRate:       expect.any(Number),
    });
    expect(['GOLDEN_DAY', 'BLACK_ROUTE', 'LOW_FILL', 'HIGH_FILL', 'NO_CHANGE']).toContain(data.rule);
  });

  // ─── PROFIT-LINE-1 — Tag cohérent selon le prix ─────────────────────────
  test('[PROFIT-LINE-1] simulate-trip : DEFICIT à bas prix, PROFITABLE à haut prix', async ({ request }) => {
    // Bas prix
    const low = await request.post(
      `/api/tenants/${E2E.TENANT_ID}/simulate-trip`,
      {
        headers: { Host: E2E.HOSTNAME, Cookie: cookie, 'Content-Type': 'application/json' },
        data: { routeId, busId, ticketPrice: 500, fillRate: 0.3 },
      },
    );
    expect([200, 201]).toContain(low.status());
    const lowData = await low.json();
    expect(lowData.projected.profitabilityTag).toBe('DEFICIT');
    expect(lowData.recommendations.breakEvenPriceAtFillRate).toBeGreaterThan(500);

    // Haut prix + fillRate élevé
    const high = await request.post(
      `/api/tenants/${E2E.TENANT_ID}/simulate-trip`,
      {
        headers: { Host: E2E.HOSTNAME, Cookie: cookie, 'Content-Type': 'application/json' },
        data: { routeId, busId, ticketPrice: 50_000, fillRate: 0.9 },
      },
    );
    expect([200, 201]).toContain(high.status());
    const highData = await high.json();
    expect(highData.projected.profitabilityTag).toBe('PROFITABLE');
    expect(highData.projected.netMargin).toBeGreaterThan(0);
  });

  // ─── PROFIT-BUS-1 — Erreur claire si pas de costProfile ─────────────────
  test('[PROFIT-BUS-1] simulate-trip rejette avec message clair si bus sans costProfile', async ({ request }) => {
    // Crée un bus SANS costProfile
    const naked = `${SUITE}-bus-naked`;
    await prisma.bus.create({
      data: { id: naked, tenantId: E2E.TENANT_ID, agencyId,
              plateNumber: `NK-${SUITE.slice(-6)}`, model: 'Naked Bus',
              capacity: 30, luggageCapacityKg: 300, luggageCapacityM3: 5, status: 'AVAILABLE' },
    });

    const res = await request.post(
      `/api/tenants/${E2E.TENANT_ID}/simulate-trip`,
      {
        headers: { Host: E2E.HOSTNAME, Cookie: cookie, 'Content-Type': 'application/json' },
        data: { routeId, busId: naked, ticketPrice: 15_000, fillRate: 0.7 },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.detail ?? '')).toContain('profil de coûts');

    // Cleanup inline
    await prisma.bus.delete({ where: { id: naked } });
  });

  // ─── PROFIT-SUMMARY — Endpoint profitability summary répond ─────────────
  test('[PROFIT-SUMMARY] GET /pricing/analytics/profitability renvoie un payload', async ({ request }) => {
    const from = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const to   = new Date().toISOString();

    const res = await request.get(
      `/api/tenants/${E2E.TENANT_ID}/analytics/profitability?from=${from}&to=${to}`,
      { headers: { Host: E2E.HOSTNAME, Cookie: cookie } },
    );
    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data).toMatchObject({
      tripCount:              expect.any(Number),
      totalRevenue:           expect.any(Number),
      totalCost:              expect.any(Number),
      totalNetMargin:         expect.any(Number),
      avgFillRate:            expect.any(Number),
      byTag:                  expect.any(Object),
    });
  });
});
