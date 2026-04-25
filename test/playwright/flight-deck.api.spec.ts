/**
 * E2E API test — Flight-deck (driver dashboard) endpoints orphelins.
 *
 *   [FD-1] GET /flight-deck/trips/:tripId/parcels (liste colis du trip)
 *   [FD-2] POST /flight-deck/trips/:tripId/freight/close (close fret)
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

async function seedTrip(tenantId: string, agencyId: string, userId: string): Promise<{ tripId: string }> {
  let staff = await prisma.staff.findUnique({ where: { userId } });
  if (!staff) staff = await prisma.staff.create({ data: { tenantId, agencyId, userId, status: 'ACTIVE' } });

  const o = await prisma.station.create({
    data: { tenantId, name: 'PW O', city: 'X', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } },
  });
  const d = await prisma.station.create({
    data: { tenantId, name: 'PW D', city: 'Y', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } },
  });
  const route = await prisma.route.create({
    data: { tenantId, originId: o.id, destinationId: d.id, name: `R-${Date.now()}`, distanceKm: 100, basePrice: 1000 },
  });
  const bus = await prisma.bus.create({
    data: {
      tenantId, agencyId,
      plateNumber: `PW-FD-${Date.now()}`, model: 'Bus', type: 'STANDARD', capacity: 30,
      luggageCapacityKg: 200, luggageCapacityM3: 5,
    },
  });
  const trip = await prisma.trip.create({
    data: {
      tenantId, routeId: route.id, busId: bus.id, driverId: staff.id, status: 'IN_PROGRESS',
      departureScheduled: new Date(Date.now() - 3600_000),
      arrivalScheduled:   new Date(Date.now() + 2 * 3600_000),
    },
  });
  return { tripId: trip.id };
}

test.describe('[E2E-API] Flight-deck', () => {

  test('[FD-1] GET /trips/:tripId/parcels renvoie une liste', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const { tripId } = await seedTrip(tenantA.id, agencyId, tenantA.userId);

    const res = await request.get(`/api/tenants/${tenantA.id}/flight-deck/trips/${tripId}/parcels`, { headers: authHeaders });
    expect(res.status(), `parcels: ${await res.text()}`).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('[FD-2] POST /trips/:tripId/freight/close', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const { tripId } = await seedTrip(tenantA.id, agencyId, tenantA.userId);

    const res = await request.post(`/api/tenants/${tenantA.id}/flight-deck/trips/${tripId}/freight/close`, {
      headers: authHeaders, data: {},
    });
    expect(res.status(), `freight close: ${await res.text()}`).toBeLessThan(300);
  });
});
