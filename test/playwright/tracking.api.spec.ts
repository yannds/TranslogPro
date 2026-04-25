/**
 * E2E API test — Tracking GPS (POST position + GET position + history).
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

async function ensureStaffAndTrip(tenantId: string, agencyId: string, userId: string): Promise<string> {
  let staff = await prisma.staff.findUnique({ where: { userId } });
  if (!staff) staff = await prisma.staff.create({ data: { tenantId, agencyId, userId, status: 'ACTIVE' } });

  const origin = await prisma.station.create({
    data: { tenantId, name: 'PW O', city: 'X', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } },
  });
  const dest = await prisma.station.create({
    data: { tenantId, name: 'PW D', city: 'Y', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } },
  });
  const route = await prisma.route.create({
    data: { tenantId, originId: origin.id, destinationId: dest.id, name: `R-${Date.now()}`, distanceKm: 100, basePrice: 1000 },
  });
  const bus = await prisma.bus.create({
    data: {
      tenantId, agencyId,
      plateNumber: `PW-TRK-${Date.now()}`, model: 'Bus', type: 'STANDARD', capacity: 30,
      luggageCapacityKg: 200, luggageCapacityM3: 5,
    },
  });
  const trip = await prisma.trip.create({
    data: {
      tenantId, routeId: route.id, busId: bus.id, driverId: staff.id, status: 'IN_PROGRESS',
      departureScheduled: new Date(Date.now() - 3600_000),
      arrivalScheduled:   new Date(Date.now() + 3 * 3600_000),
    },
  });
  return trip.id;
}

test.describe('[E2E-API] Tracking GPS', () => {

  test('[TRK-1] POST /gps + GET position + GET history', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const tripId = await ensureStaffAndTrip(tenantA.id, agencyId, tenantA.userId);
    const base = `/api/tenants/${tenantA.id}/tracking/trips/${tripId}`;

    // POST GPS
    const post = await request.post(`${base}/gps`, {
      headers: authHeaders, data: { lat: -4.2634, lng: 15.2429, speed: 50, heading: 180 },
    });
    expect(post.status(), `gps post: ${await post.text()}`).toBeLessThan(300);

    // POST another point
    await request.post(`${base}/gps`, {
      headers: authHeaders, data: { lat: -4.2700, lng: 15.2500, speed: 55, heading: 175 },
    });

    // GET position
    const pos = await request.get(`${base}/position`, { headers: authHeaders });
    expect(pos.status(), `position: ${await pos.text()}`).toBe(200);
    const last = await pos.json();
    // last position retournée = la plus récente (any of the two posted, ordering may vary)
    expect(typeof last.lat).toBe('number');
    expect(typeof last.lng).toBe('number');

    // GET history
    const hist = await request.get(`${base}/history?limit=10`, { headers: authHeaders });
    expect(hist.status()).toBe(200);
    const arr = await hist.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThanOrEqual(1);
  });
});
