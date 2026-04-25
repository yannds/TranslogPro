/**
 * E2E API test — Incident create + assign + resolve.
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Incidents', () => {

  test('[INC-1] POST + GET + PATCH assign + PATCH resolve', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/incidents`;

    const create = await request.post(base, {
      headers: authHeaders,
      data: {
        type:        'BREAKDOWN',
        severity:    'MEDIUM',
        description: 'Test PW incident',
      },
    });
    expect(create.status(), `create: ${await create.text()}`).toBeLessThan(300);
    const incident = await create.json();
    expect(incident.id).toBeTruthy();

    const list = await request.get(base, { headers: authHeaders });
    expect(list.status()).toBe(200);

    const assign = await request.patch(`${base}/${incident.id}/assign`, {
      headers: authHeaders, data: { assigneeId: tenantA.userId },
    });
    expect(assign.status(), `assign: ${await assign.text()}`).toBeLessThan(300);

    const resolve = await request.patch(`${base}/${incident.id}/resolve`, {
      headers: authHeaders,
      data: { resolution: 'Test résolu E2E' },
    });
    expect(resolve.status(), `resolve: ${await resolve.text()}`).toBeLessThan(300);
  });
});
