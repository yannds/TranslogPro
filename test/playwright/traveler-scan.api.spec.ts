/**
 * E2E API test — Traveler scan flow (verify → scan-in → scan-board → scan-out).
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

async function seedTraveler(tenantId: string, agencyId: string, userId: string) {
  let staff = await prisma.staff.findUnique({ where: { userId } });
  if (!staff) staff = await prisma.staff.create({ data: { tenantId, agencyId, userId, status: 'ACTIVE' } });

  const o = await prisma.station.create({ data: { tenantId, name: 'O', city: 'X', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
  const d = await prisma.station.create({ data: { tenantId, name: 'D', city: 'Y', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
  const route = await prisma.route.create({ data: { tenantId, originId: o.id, destinationId: d.id, name: `R-${Date.now()}`, distanceKm: 100, basePrice: 1000 } });
  const bus = await prisma.bus.create({
    data: {
      tenantId, agencyId,
      plateNumber: `PW-TRV-${Date.now()}`, model: 'Bus', type: 'STANDARD', capacity: 30,
      luggageCapacityKg: 200, luggageCapacityM3: 5,
    },
  });
  const trip = await prisma.trip.create({
    data: {
      tenantId, routeId: route.id, busId: bus.id, driverId: staff.id, status: 'BOARDING',
      departureScheduled: new Date(Date.now() + 3600_000),
      arrivalScheduled:   new Date(Date.now() + 5 * 3600_000),
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      tenantId, tripId: trip.id, passengerName: 'PW Traveler',
      seatNumber: '1', boardingStationId: o.id, alightingStationId: d.id,
      pricePaid: 1000, status: 'CONFIRMED',
      qrCode: `QR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  const traveler = await prisma.traveler.create({
    data: { tenantId, ticketId: ticket.id, tripId: trip.id, status: 'REGISTERED', dropOffStationId: d.id },
  });
  return { travelerId: traveler.id, tripId: trip.id, destStationId: d.id };
}

test.describe('[E2E-API] Traveler scan flow', () => {

  test('[TRV-1..4] verify → scan-in → scan-board → scan-out', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const { travelerId, tripId, destStationId } = await seedTraveler(tenantA.id, agencyId, tenantA.userId);

    const base = `/api/tenants/${tenantA.id}/travelers`;

    // verify
    const v = await request.post(`${base}/${travelerId}/verify`, { headers: authHeaders, data: {} });
    expect(v.status(), `verify: ${await v.text()}`).toBeLessThan(300);

    // scan-in
    const si = await request.post(`${base}/${travelerId}/scan-in`, { headers: authHeaders, data: {} });
    expect(si.status(), `scan-in: ${await si.text()}`).toBeLessThan(300);

    // scan-board
    const sb = await request.post(`${base}/${travelerId}/scan-board`, { headers: authHeaders, data: {} });
    expect(sb.status(), `scan-board: ${await sb.text()}`).toBeLessThan(300);

    // scan-out (with destination station)
    const so = await request.post(`${base}/${travelerId}/scan-out`, {
      headers: authHeaders, data: { stationId: destStationId },
    });
    expect(so.status(), `scan-out: ${await so.text()}`).toBeLessThan(300);

    const final = await prisma.traveler.findUnique({ where: { id: travelerId }, select: { status: true } });
    expect(final?.status).toBe('ARRIVED');

    // GET trips/:tripId (list travelers du trip)
    const trv = await request.get(`${base}/trips/${tripId}`, { headers: authHeaders });
    expect(trv.status()).toBe(200);

    // GET trips/:tripId/drop-off/:stationId
    const dropOff = await request.get(`${base}/trips/${tripId}/drop-off/${destStationId}`, { headers: authHeaders });
    expect(dropOff.status()).toBe(200);
  });
});
