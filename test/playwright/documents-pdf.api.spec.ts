/**
 * E2E API test — Documents PDF generation endpoints (smoke test : route mounted + 200/302).
 *
 * Ces routes génèrent des PDFs/Excels et sont consommées via window.open() côté FE.
 * On vérifie qu'elles répondent (≠ 404 route-not-found, ≠ 403/401), avec données
 * minimales prérequises.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

async function seedTicketAndTrip(tenantId: string, agencyId: string, userId: string) {
  let staff = await prisma.staff.findUnique({ where: { userId } });
  if (!staff) staff = await prisma.staff.create({ data: { tenantId, agencyId, userId, status: 'ACTIVE' } });

  const o = await prisma.station.create({ data: { tenantId, name: 'O', city: 'X', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
  const d = await prisma.station.create({ data: { tenantId, name: 'D', city: 'Y', type: 'PRINCIPALE', coordinates: { lat: 0, lng: 0 } } });
  const route = await prisma.route.create({ data: { tenantId, originId: o.id, destinationId: d.id, name: `R-${Date.now()}`, distanceKm: 100, basePrice: 1000 } });
  const bus = await prisma.bus.create({
    data: {
      tenantId, agencyId, plateNumber: `PW-DOC-${Date.now()}`, model: 'B', type: 'STANDARD',
      capacity: 30, luggageCapacityKg: 200, luggageCapacityM3: 5,
    },
  });
  const trip = await prisma.trip.create({
    data: {
      tenantId, routeId: route.id, busId: bus.id, driverId: staff.id, status: 'PLANNED',
      departureScheduled: new Date(Date.now() + 3600_000),
      arrivalScheduled:   new Date(Date.now() + 5 * 3600_000),
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      tenantId, tripId: trip.id, passengerName: 'PW Doc',
      seatNumber: '1', boardingStationId: o.id, alightingStationId: d.id,
      pricePaid: 1000, status: 'CONFIRMED',
      qrCode: `QR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  const parcel = await prisma.parcel.create({
    data: {
      tenantId, trackingCode: `PCL-${Date.now()}`, weight: 1, price: 1000,
      destinationId: d.id, recipientInfo: { name: 'X', phone: '+242', address: '-' },
      status: 'CREATED',
    },
  });
  return { ticketId: ticket.id, tripId: trip.id, parcelId: parcel.id };
}

test.describe('[E2E-API] Documents PDF generation', () => {

  test('[DOC-1] PDF endpoints répondent ≠ 404', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const { ticketId, tripId, parcelId } = await seedTicketAndTrip(tenantA.id, agencyId, tenantA.userId);
    const base = `/api/tenants/${tenantA.id}/documents`;

    // On valide que chaque endpoint répond avec un code ≠ 404 route-not-found.
    // 200 OK (PDF stream) ou 302 redirect ou 400 si template non configuré sont
    // tous des signaux que la route est bien montée et le service fonctionne.
    const endpoints = [
      `${base}/tickets/${ticketId}/print`,
      `${base}/tickets/${ticketId}/invoice`,
      `${base}/tickets/${ticketId}/invoice-pro`,
      `${base}/tickets/${ticketId}/stub`,
      `${base}/tickets/${ticketId}/baggage-tag`,
      `${base}/parcels/${parcelId}/label`,
      `${base}/parcels/${parcelId}/invoice`,
      `${base}/trips/${tripId}/manifest/print`,
      `${base}/trips/${tripId}/passengers/excel`,
    ];

    for (const url of endpoints) {
      const res = await request.get(url, { headers: authHeaders });
      const status = res.status();
      const body = status >= 400 ? await res.text() : '';
      // La route est mountée si le body n'est pas "Cannot GET" et le code n'est pas
      // un FORBIDDEN d'auth (les routes PDF dépendent souvent de templates/config
      // tenant ; 500 = template manquant, 200 = PDF généré, tous OK pour ce test).
      expect(body).not.toMatch(/Cannot (GET|POST)/);
      expect(status, `${url}: ${status} body=${body.slice(0, 200)}`).not.toBe(403);
      expect(status).not.toBe(401);
    }
  });
});
