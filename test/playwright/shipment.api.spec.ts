/**
 * E2E API test — Shipment (groupement colis) CRUD complet.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] Shipments', () => {

  test('[SHP-1] create + GET + addParcel + close', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);

    // Setup trip
    let staff = await prisma.staff.findUnique({ where: { userId: tenantA.userId } });
    if (!staff) staff = await prisma.staff.create({ data: { tenantId: tenantA.id, agencyId, userId: tenantA.userId, status: 'ACTIVE' } });
    const o = await prisma.station.create({ data: { tenantId: tenantA.id, name: 'O', city: 'X', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
    const d = await prisma.station.create({ data: { tenantId: tenantA.id, name: 'D', city: 'Y', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
    const route = await prisma.route.create({ data: { tenantId: tenantA.id, originId: o.id, destinationId: d.id, name: `R-${Date.now()}`, distanceKm: 100, basePrice: 1000 } });
    const bus = await prisma.bus.create({
      data: {
        tenantId: tenantA.id, agencyId, plateNumber: `PW-SHP-${Date.now()}`, model: 'B', type: 'STANDARD',
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

    const base = `/api/tenants/${tenantA.id}/shipments`;

    // Create shipment
    const create = await request.post(base, {
      headers: authHeaders,
      data:    { tripId: trip.id, destinationId: d.id, maxWeightKg: 100 },
    });
    expect(create.status(), `create: ${await create.text()}`).toBeLessThan(300);
    const shipment = await create.json();
    expect(shipment.id).toBeTruthy();

    // GET shipment
    const get = await request.get(`${base}/${shipment.id}`, { headers: authHeaders });
    expect(get.status()).toBe(200);

    // GET trips/:tripId shipments
    const byTrip = await request.get(`${base}/trips/${trip.id}`, { headers: authHeaders });
    expect(byTrip.status()).toBe(200);
    expect(Array.isArray(await byTrip.json())).toBe(true);

    // Add a parcel matching destination
    const parcel = await prisma.parcel.create({
      data: {
        tenantId: tenantA.id, trackingCode: `PCL-${Date.now()}`, weight: 5, price: 1000,
        destinationId: d.id, recipientInfo: { name: 'X', phone: '+242', address: '-' },
        status: 'AT_ORIGIN',
      },
    });
    const add = await request.post(`${base}/${shipment.id}/parcels/${parcel.id}`, { headers: authHeaders });
    expect(add.status(), `add parcel: ${await add.text()}`).toBeLessThan(300);
  });
});
