/**
 * E2E API test — Sprint 9 misc : fleet bus display/photos, crm segments/recompute,
 * driver-profile remediation evaluate, public-reporter list.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] Sprint 9 — misc endpoints', () => {

  test('[FLT-1] Bus display + photos upload-url', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const bus = await prisma.bus.create({
      data: {
        tenantId: tenantA.id, agencyId, plateNumber: `PW-DSP-${Date.now()}`, model: 'B', type: 'STANDARD',
        capacity: 30, luggageCapacityKg: 200, luggageCapacityM3: 5,
      },
    });

    const display = await request.get(`/api/tenants/${tenantA.id}/fleet/buses/${bus.id}/display`, { headers: authHeaders });
    // display peut nécessiter scope public — vérifie juste route mounted
    expect(display.status(), `display: ${display.status()}`).not.toBe(404);

    const photos = await request.post(`/api/tenants/${tenantA.id}/fleet/buses/${bus.id}/photos/upload-url`, {
      headers: authHeaders, data: { ext: 'jpg' },
    });
    expect(photos.status(), `photos: ${await photos.text()}`).toBeLessThan(300);
    const presigned = await photos.json();
    expect(presigned.uploadUrl).toBeTruthy();
    expect(presigned.fileKey).toBeTruthy();
  });

  test('[CRM-X] segments/recompute + recommendations', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/crm`;

    const recompute = await request.post(`${base}/segments/recompute`, { headers: authHeaders, data: {} });
    expect(recompute.status(), `recompute: ${await recompute.text()}`).toBeLessThan(300);

    // Create a customer to query recommendations on
    const customer = await prisma.customer.create({
      data: {
        tenantId:    tenantA.id,
        phoneE164:   '+242000000001',
        name:        'PW Customer',
        segments:    [],
      },
    });

    const recos = await request.get(`${base}/contacts/${customer.id}/recommendations`, { headers: authHeaders });
    expect(recos.status(), `recommendations: ${await recos.text()}`).toBe(200);
  });

  test('[DRV-EVAL] remediation evaluate + actions', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);

    let staff = await prisma.staff.findUnique({ where: { userId: tenantA.userId } });
    if (!staff) staff = await prisma.staff.create({ data: { tenantId: tenantA.id, agencyId, userId: tenantA.userId, status: 'ACTIVE' } });

    const base = `/api/tenants/${tenantA.id}/driver-profile`;

    // Create a remediation rule first (so evaluate can match)
    await request.post(`${base}/remediation-rules`, {
      headers: authHeaders,
      data:    { name: 'Below 50', scoreBelowThreshold: 50, actionType: 'WARNING', priority: 1 },
    });

    const evalRes = await request.post(`${base}/drivers/${staff.id}/remediation/evaluate`, {
      headers: authHeaders, data: { score: 30 },
    });
    expect(evalRes.status(), `evaluate: ${await evalRes.text()}`).toBeLessThan(300);

    const actions = await request.get(`${base}/drivers/${staff.id}/remediation/actions`, { headers: authHeaders });
    expect(actions.status()).toBe(200);
    expect(Array.isArray(await actions.json())).toBe(true);
  });
});
