/**
 * E2E API test — Manifest endpoints (create from trip + GET detail).
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] Manifest', () => {

  test('[MNF-1] POST /trips/:tripId + GET detail + GET trips/:tripId list', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);

    // Setup trip
    let staff = await prisma.staff.findUnique({ where: { userId: tenantA.userId } });
    if (!staff) staff = await prisma.staff.create({ data: { tenantId: tenantA.id, agencyId, userId: tenantA.userId, status: 'ACTIVE' } });
    const o = await prisma.station.create({ data: { tenantId: tenantA.id, name: 'O', city: 'X', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
    const d = await prisma.station.create({ data: { tenantId: tenantA.id, name: 'D', city: 'Y', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
    const route = await prisma.route.create({ data: { tenantId: tenantA.id, originId: o.id, destinationId: d.id, name: `R-${Date.now()}`, distanceKm: 100, basePrice: 1000 } });
    const bus = await prisma.bus.create({
      data: {
        tenantId: tenantA.id, agencyId, plateNumber: `PW-MNF-${Date.now()}`, model: 'B', type: 'STANDARD',
        capacity: 30, luggageCapacityKg: 200, luggageCapacityM3: 5,
      },
    });
    const trip = await prisma.trip.create({
      data: {
        tenantId: tenantA.id, routeId: route.id, busId: bus.id, driverId: staff.id, status: 'PLANNED',
        departureScheduled: new Date(Date.now() + 3600_000),
        arrivalScheduled:   new Date(Date.now() + 5 * 3600_000),
      },
    });

    const base = `/api/tenants/${tenantA.id}/manifests`;

    const create = await request.post(`${base}/trips/${trip.id}`, { headers: authHeaders, data: {} });
    expect(create.status(), `create: ${await create.text()}`).toBeLessThan(300);
    const manifest = await create.json();
    expect(manifest.id).toBeTruthy();

    const get = await request.get(`${base}/${manifest.id}`, { headers: authHeaders });
    expect(get.status()).toBe(200);

    const byTrip = await request.get(`${base}/trips/${trip.id}`, { headers: authHeaders });
    expect(byTrip.status()).toBe(200);
  });
});
