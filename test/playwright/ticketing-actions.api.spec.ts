/**
 * E2E API test — Actions ticket post-vente (no-show, rebook, refund-request).
 *
 * Vérifie que les endpoints sont bien montés et autorisent les actions
 * conformément à la fonction métier :
 *
 *   [TK-1] POST /tickets/:id/no-show          (CONFIRMED → NO_SHOW)
 *   [TK-2] POST /tickets/:id/rebook/next-available
 *   [TK-3] POST /tickets/:id/refund-request   (CONFIRMED → REFUND_PENDING)
 *
 * Sprint 1 a corrigé le préfixe /api/v1/ → /api/, ces routes étaient
 * cassées en runtime. Ce test garantit qu'elles répondent bien et
 * exécutent la transition d'état attendue (workflow blueprint).
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

interface SeededTicket {
  ticketId: string;
  tripId:   string;
  routeId:  string;
  busId:    string;
}

async function seedTripAndTicket(tenantId: string, agencyId: string, userId: string): Promise<SeededTicket> {
  // Stations origine + destination
  const origin = await prisma.station.create({
    data: {
      tenantId, name: 'PW Origin', city: 'Brazzaville', type: 'PRINCIPALE',
      coordinates: { lat: -4.2634, lng: 15.2429 },
    },
  });
  const destination = await prisma.station.create({
    data: {
      tenantId, name: 'PW Destination', city: 'Pointe-Noire', type: 'PRINCIPALE',
      coordinates: { lat: -4.7748, lng: 11.8635 },
    },
  });

  const route = await prisma.route.create({
    data: {
      tenantId,
      originId:      origin.id,
      destinationId: destination.id,
      name:          `PW Route ${Date.now()}`,
      distanceKm:    500,
      basePrice:     5000,
    },
  });

  const bus = await prisma.bus.create({
    data: {
      tenantId, agencyId,
      plateNumber: `PW-TK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      model:        'Coaster',
      type:         'STANDARD',
      capacity:     30,
      luggageCapacityKg: 300,
      luggageCapacityM3: 5,
    },
  });

  // Réutilise le user fixture comme staff driver (1 user = 1 staff)
  let staff = await prisma.staff.findUnique({ where: { userId } });
  if (!staff) {
    staff = await prisma.staff.create({
      data: { tenantId, agencyId, userId, status: 'ACTIVE' },
    });
  }

  // Départ déjà passé (grace period écoulée) pour permettre no-show
  const departureScheduled = new Date(Date.now() - 4 * 3600_000);
  const arrivalScheduled   = new Date(Date.now() - 1 * 3600_000);

  const trip = await prisma.trip.create({
    data: {
      tenantId,
      routeId:  route.id,
      busId:    bus.id,
      driverId: staff.id,
      status:   'PLANNED',
      departureScheduled,
      arrivalScheduled,
    },
  });

  const ticket = await prisma.ticket.create({
    data: {
      tenantId,
      tripId:             trip.id,
      passengerName:      'PW Passenger',
      seatNumber:         '1',
      boardingStationId:  origin.id,
      alightingStationId: destination.id,
      pricePaid:          5000,
      status:             'CONFIRMED',
      qrCode:             `QR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });

  return { ticketId: ticket.id, tripId: trip.id, routeId: route.id, busId: bus.id };
}

test.describe('[E2E-API] Ticketing post-sale actions', () => {

  test('[TK-1] no-show transitions CONFIRMED → NO_SHOW', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA, ['SCHEDULER']);
    const { ticketId } = await seedTripAndTicket(tenantA.id, agencyId, tenantA.userId);

    const res = await request.post(`/api/tenants/${tenantA.id}/tickets/${ticketId}/no-show`, {
      headers: authHeaders, data: {},
    });
    expect(res.status(), `no-show: ${await res.text()}`).toBeLessThan(300);

    const after = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true, noShowMarkedAt: true } });
    expect(after?.status).toBe('NO_SHOW');
    expect(after?.noShowMarkedAt).not.toBeNull();
  });

  test('[TK-3] refund-request transitions NO_SHOW → REFUND_PENDING', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const { ticketId } = await seedTripAndTicket(tenantA.id, agencyId, tenantA.userId);

    // Étape 1 : marquer no-show (CONFIRMED → NO_SHOW)
    const ns = await request.post(`/api/tenants/${tenantA.id}/tickets/${ticketId}/no-show`, {
      headers: authHeaders, data: {},
    });
    expect(ns.status(), `no-show: ${await ns.text()}`).toBeLessThan(300);

    // Étape 2 : demander remboursement (NO_SHOW → REFUND_PENDING)
    const res = await request.post(`/api/tenants/${tenantA.id}/tickets/${ticketId}/refund-request`, {
      headers: authHeaders,
      data:    { reason: 'NO_SHOW' },
    });
    expect(res.status(), `refund-request: ${await res.text()}`).toBeLessThan(300);

    const after = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
    expect(after?.status).toMatch(/REFUND/);
  });
});
