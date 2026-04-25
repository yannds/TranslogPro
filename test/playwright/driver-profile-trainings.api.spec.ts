/**
 * E2E API test — Driver-profile trainings + remediation rules.
 *
 *   [DRV-1] POST /training-types crée un type
 *   [DRV-2] POST /trainings (schedule) → status=SCHEDULED
 *   [DRV-3] PATCH /trainings/:id/complete → status=COMPLETED + completedAt
 *   [DRV-4] POST /remediation-rules crée une règle (score<X → action)
 *   [DRV-5] PATCH/DELETE /remediation-rules/:id update + supprime
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

async function ensureStaff(tenantId: string, agencyId: string, userId: string): Promise<string> {
  let staff = await prisma.staff.findUnique({ where: { userId } });
  if (!staff) {
    staff = await prisma.staff.create({ data: { tenantId, agencyId, userId, status: 'ACTIVE' } });
  }
  return staff.id;
}

test.describe('[E2E-API] Driver-profile trainings + remediation', () => {

  test('[DRV-1] POST /training-types crée un type', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const res = await request.post(`/api/tenants/${tenantA.id}/driver-profile/training-types`, {
      headers: authHeaders,
      data:    { name: 'Conduite éco', code: `ECO-${Date.now()}`, frequencyDays: 365, durationHours: 8 },
    });
    expect(res.status(), `create training-type: ${await res.text()}`).toBeLessThan(300);
    const tt = await res.json();
    expect(tt.id).toBeTruthy();
    expect(tt.frequencyDays).toBe(365);
  });

  test('[DRV-2] POST /trainings (schedule) → status=PLANNED', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const staffId = await ensureStaff(tenantA.id, agencyId, tenantA.userId);

    const tt = await (await request.post(`/api/tenants/${tenantA.id}/driver-profile/training-types`, {
      headers: authHeaders,
      data:    { name: 'Sécurité', code: `SEC-${Date.now()}` },
    })).json();

    const res = await request.post(`/api/tenants/${tenantA.id}/driver-profile/trainings`, {
      headers: authHeaders,
      data:    {
        staffId,
        typeId:      tt.id,
        scheduledAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        trainerName: 'PW Trainer',
      },
    });
    expect(res.status(), `schedule: ${await res.text()}`).toBeLessThan(300);
    const tr = await res.json();
    expect(tr.id).toBeTruthy();
    expect(tr.status).toBe('PLANNED');
  });

  test('[DRV-3] PATCH /trainings/:id/complete → status=COMPLETED', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const staffId = await ensureStaff(tenantA.id, agencyId, tenantA.userId);

    const tt = await (await request.post(`/api/tenants/${tenantA.id}/driver-profile/training-types`, {
      headers: authHeaders, data: { name: 'PW', code: `PW-${Date.now()}` },
    })).json();
    const tr = await (await request.post(`/api/tenants/${tenantA.id}/driver-profile/trainings`, {
      headers: authHeaders,
      data: { staffId, typeId: tt.id, scheduledAt: new Date().toISOString() },
    })).json();

    const res = await request.patch(`/api/tenants/${tenantA.id}/driver-profile/trainings/${tr.id}/complete`, {
      headers: authHeaders,
      data:    { completedAt: new Date().toISOString(), trainerName: 'PW' },
    });
    expect(res.status(), `complete: ${await res.text()}`).toBeLessThan(300);
    const completed = await res.json();
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeTruthy();
  });

  test('[DRV-4] POST /remediation-rules + GET liste', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const res = await request.post(`/api/tenants/${tenantA.id}/driver-profile/remediation-rules`, {
      headers: authHeaders,
      data:    { name: 'Score critique', scoreBelowThreshold: 40, actionType: 'WARNING', priority: 1 },
    });
    expect(res.status(), `create rule: ${await res.text()}`).toBeLessThan(300);
    const rule = await res.json();
    expect(rule.id).toBeTruthy();

    const list = await request.get(`/api/tenants/${tenantA.id}/driver-profile/remediation-rules`, { headers: authHeaders });
    expect(list.status()).toBe(200);
    const arr = await list.json();
    expect(arr.find((r: { id: string }) => r.id === rule.id)).toBeTruthy();
  });

  test('[DRV-5] PATCH + DELETE /remediation-rules/:id', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const created = await (await request.post(`/api/tenants/${tenantA.id}/driver-profile/remediation-rules`, {
      headers: authHeaders,
      data:    { name: 'X', scoreBelowThreshold: 50, actionType: 'WARNING' },
    })).json();

    const patch = await request.patch(`/api/tenants/${tenantA.id}/driver-profile/remediation-rules/${created.id}`, {
      headers: authHeaders, data: { name: 'X-renamed' },
    });
    expect(patch.status(), `patch: ${await patch.text()}`).toBeLessThan(300);

    const del = await request.delete(`/api/tenants/${tenantA.id}/driver-profile/remediation-rules/${created.id}`, { headers: authHeaders });
    expect(del.status(), `delete: ${await del.text()}`).toBeLessThan(300);
  });
});
