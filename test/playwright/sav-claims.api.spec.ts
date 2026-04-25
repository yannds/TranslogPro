/**
 * E2E API test — SAV claims (création + traitement).
 *
 *   [SAV-1] POST /sav/claims          (CREATE → OPEN)
 *   [SAV-2] PATCH /sav/claims/:id/process { decision: 'RESOLVE' }
 *           (OPEN → RESOLVED, fast-track)
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] SAV claims', () => {

  test('[SAV-1] POST /claims crée une réclamation OPEN', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    // Créer un colis comme entité-cible de la réclamation
    const dest = await prisma.station.create({
      data: { tenantId: tenantA.id, name: 'PW Dest', city: 'PN', type: 'PRINCIPALE',
              coordinates: { lat: 0, lng: 0 } },
    });
    const parcel = await prisma.parcel.create({
      data: {
        tenantId:      tenantA.id,
        trackingCode:  `PW-${Date.now()}`,
        weight:        1, price: 1000,
        destinationId: dest.id,
        recipientInfo: { name: 'X', phone: '+242000', address: '-' },
        status:        'DELIVERED',
      },
    });

    const res = await request.post(`/api/tenants/${tenantA.id}/sav/claims`, {
      headers: authHeaders,
      data:    {
        type:        'PARCEL_DAMAGE',
        entityType:  'PARCEL',
        entityId:    parcel.id,
        description: 'Colis endommagé à la livraison (E2E test)',
      },
    });
    expect(res.status(), `create claim: ${await res.text()}`).toBeLessThan(300);
    const claim = await res.json();
    expect(claim.id).toBeTruthy();
    expect(claim.status).toBe('OPEN');
  });

  test('[SAV-2] PATCH /claims/:id/process { RESOLVE } transitions OPEN → RESOLVED', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const dest = await prisma.station.create({
      data: { tenantId: tenantA.id, name: 'PW Dest 2', city: 'PN', type: 'PRINCIPALE',
              coordinates: { lat: 0, lng: 0 } },
    });
    const parcel = await prisma.parcel.create({
      data: {
        tenantId:      tenantA.id,
        trackingCode:  `PW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        weight:        1, price: 1000,
        destinationId: dest.id,
        recipientInfo: { name: 'X', phone: '+242000', address: '-' },
        status:        'DELIVERED',
      },
    });

    const claim = await prisma.claim.create({
      data: {
        tenantId:    tenantA.id,
        type:        'PARCEL_DAMAGE',
        reporterId:  tenantA.userId,
        entityId:    parcel.id,
        entityType:  'PARCEL',
        description: 'Test E2E processing',
        status:      'OPEN',
      },
    });

    const res = await request.patch(`/api/tenants/${tenantA.id}/sav/claims/${claim.id}/process`, {
      headers: authHeaders,
      data:    { decision: 'RESOLVE' },
    });
    expect(res.status(), `process: ${await res.text()}`).toBeLessThan(300);

    const after = await prisma.claim.findUnique({ where: { id: claim.id }, select: { status: true, resolvedAt: true } });
    expect(after?.status).toBe('RESOLVED');
    expect(after?.resolvedAt).not.toBeNull();
  });
});
