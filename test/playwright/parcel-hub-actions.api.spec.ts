/**
 * E2E API test — Parcel hub actions (arrive, store, load-outbound, depart).
 *
 * Vérifie le flow agent quai sur un colis en transit :
 *   IN_TRANSIT → ARRIVE_AT_HUB → AT_HUB_INBOUND
 *             → STORE_AT_HUB → STORED_AT_HUB
 *             → LOAD_OUTBOUND → AT_HUB_OUTBOUND
 *             → DEPART_FROM_HUB → IN_TRANSIT
 *
 * Sprint 1 a corrigé le préfixe /api/v1/ → /api/, ces routes étaient
 * cassées en runtime. Ce test garantit qu'elles répondent et exécutent
 * la transition d'état attendue.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

interface SeededParcel {
  parcelId:      string;
  hubStationId:  string;
}

async function seedParcelInTransit(tenantId: string): Promise<SeededParcel> {
  // 2 stations : destination + hub intermédiaire
  const destination = await prisma.station.create({
    data: {
      tenantId, name: 'PW Dest', city: 'Pointe-Noire', type: 'PRINCIPALE',
      coordinates: { lat: -4.7748, lng: 11.8635 },
    },
  });
  const hub = await prisma.station.create({
    data: {
      tenantId, name: 'PW Hub', city: 'Dolisie', type: 'RELAIS',
      coordinates: { lat: -4.1989, lng: 12.6667 },
    },
  });

  const parcel = await prisma.parcel.create({
    data: {
      tenantId,
      trackingCode: `PW-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      weight:        2.5,
      price:         3000,
      destinationId: destination.id,
      recipientInfo: { name: 'Recipient', phone: '+242000000000', address: '123 Test St' },
      status:        'IN_TRANSIT',
    },
  });

  return { parcelId: parcel.id, hubStationId: hub.id };
}

test.describe('[E2E-API] Parcel hub actions', () => {

  test('[PCL-1] IN_TRANSIT → AT_HUB_INBOUND via /hub/arrive', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const { parcelId, hubStationId } = await seedParcelInTransit(tenantA.id);

    const res = await request.post(`/api/tenants/${tenantA.id}/parcels/${parcelId}/hub/arrive`, {
      headers: authHeaders,
      data:    { hubStationId },
    });
    expect(res.status(), `arrive: ${await res.text()}`).toBeLessThan(300);

    const after = await prisma.parcel.findUnique({
      where:  { id: parcelId },
      select: { status: true, hubStationId: true, hubArrivedAt: true },
    });
    expect(after?.status).toBe('AT_HUB_INBOUND');
    expect(after?.hubStationId).toBe(hubStationId);
    expect(after?.hubArrivedAt).not.toBeNull();
  });

  test('[PCL-2] flow complet arrive → store → load → depart', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const { parcelId, hubStationId } = await seedParcelInTransit(tenantA.id);

    const base = `/api/tenants/${tenantA.id}/parcels/${parcelId}`;

    // Étape 1 : arrive
    let r = await request.post(`${base}/hub/arrive`, { headers: authHeaders, data: { hubStationId } });
    expect(r.status(), `arrive: ${await r.text()}`).toBeLessThan(300);

    // Étape 2 : store
    r = await request.post(`${base}/hub/store`, { headers: authHeaders, data: {} });
    expect(r.status(), `store: ${await r.text()}`).toBeLessThan(300);
    let after = await prisma.parcel.findUnique({ where: { id: parcelId }, select: { status: true } });
    expect(after?.status).toBe('STORED_AT_HUB');

    // Étape 3 : load outbound
    r = await request.post(`${base}/hub/load-outbound`, { headers: authHeaders, data: {} });
    expect(r.status(), `load-outbound: ${await r.text()}`).toBeLessThan(300);
    after = await prisma.parcel.findUnique({ where: { id: parcelId }, select: { status: true } });
    expect(after?.status).toBe('AT_HUB_OUTBOUND');

    // Étape 4 : depart
    r = await request.post(`${base}/hub/depart`, { headers: authHeaders, data: {} });
    expect(r.status(), `depart: ${await r.text()}`).toBeLessThan(300);
    after = await prisma.parcel.findUnique({ where: { id: parcelId }, select: { status: true } });
    expect(after?.status).toBe('IN_TRANSIT');
  });
});
