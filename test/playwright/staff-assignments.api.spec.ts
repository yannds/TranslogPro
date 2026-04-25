/**
 * E2E API test — Staff assignments CRUD + agency add/remove.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] Staff assignments', () => {

  test('[STF-1] Create assignment + list + agency add/remove + close', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);

    // Ensure Staff exists for the user
    let staff = await prisma.staff.findUnique({ where: { userId: tenantA.userId } });
    if (!staff) staff = await prisma.staff.create({ data: { tenantId: tenantA.id, agencyId, userId: tenantA.userId, status: 'ACTIVE' } });

    const base = `/api/tenants/${tenantA.id}`;

    // Create TENANT-WIDE assignment (no agencyId) so we can ADD agencies later
    const created = await request.post(`${base}/staff/${tenantA.userId}/assignments`, {
      headers: authHeaders,
      data: {
        role:        'AGENT_GUICHET',
        startedAt:   new Date().toISOString(),
        notes:       'PW assignment',
      },
    });
    expect(created.status(), `create: ${await created.text()}`).toBeLessThan(300);
    const assignment = await created.json();
    expect(assignment.id).toBeTruthy();

    // List staff assignments
    const list = await request.get(`${base}/staff/${tenantA.userId}/assignments`, { headers: authHeaders });
    expect(list.status()).toBe(200);
    const arr = await list.json();
    expect(Array.isArray(arr)).toBe(true);

    // GET /assignments (tenant-wide)
    const all = await request.get(`${base}/assignments`, { headers: authHeaders });
    expect(all.status()).toBe(200);

    // PATCH /assignments/:id
    const patch = await request.patch(`${base}/assignments/${assignment.id}`, {
      headers: authHeaders,
      data:    { notes: 'Updated PW' },
    });
    expect(patch.status(), `patch: ${await patch.text()}`).toBeLessThan(300);

    // Add another agency to coverage (TENANT-WIDE → MULTI)
    const otherAgency = await prisma.agency.create({ data: { tenantId: tenantA.id, name: 'PW-Agency-2' } });
    const addAg = await request.post(`${base}/assignments/${assignment.id}/agencies`, {
      headers: authHeaders, data: { agencyId: otherAgency.id },
    });
    expect(addAg.status(), `add agency: ${await addAg.text()}`).toBeLessThan(300);

    // Remove the agency
    const delAg = await request.delete(`${base}/assignments/${assignment.id}/agencies/${otherAgency.id}`, { headers: authHeaders });
    expect(delAg.status(), `del agency: ${await delAg.text()}`).toBeLessThan(300);

    // Close the assignment
    const close = await request.patch(`${base}/assignments/${assignment.id}/close`, {
      headers: authHeaders, data: { closedAt: new Date().toISOString() },
    });
    expect(close.status(), `close: ${await close.text()}`).toBeLessThan(300);
  });
});
