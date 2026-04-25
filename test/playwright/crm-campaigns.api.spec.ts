/**
 * E2E API test — CRM Campaigns CRUD + audience.
 *
 *   [CRM-1] POST /crm/campaigns crée une campagne DRAFT
 *   [CRM-2] PATCH /crm/campaigns/:id met à jour name + criteria
 *   [CRM-3] GET /crm/campaigns liste avec filtre status
 *   [CRM-4] GET /crm/campaigns/:id/audience renvoie une estimation
 *   [CRM-5] DELETE /crm/campaigns/:id supprime un DRAFT
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

const baseDto = (suffix = '') => ({
  name:        `PW Campaign ${Date.now()}${suffix}`,
  messageText: 'Cher voyageur, profitez de notre offre exceptionnelle.',
  criteria:    { segment: 'all' },
});

test.describe('[E2E-API] CRM Campaigns', () => {

  test('[CRM-1] POST /campaigns crée une campagne DRAFT', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const res = await request.post(`/api/tenants/${tenantA.id}/crm/campaigns`, {
      headers: authHeaders, data: baseDto(),
    });
    expect(res.status(), `create: ${await res.text()}`).toBeLessThan(300);
    const c = await res.json();
    expect(c.id).toBeTruthy();
    expect(c.status).toBe('DRAFT');
    expect(c.sentCount).toBe(0);
  });

  test('[CRM-2] PATCH /campaigns/:id met à jour name + criteria', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const created = await (await request.post(`/api/tenants/${tenantA.id}/crm/campaigns`, { headers: authHeaders, data: baseDto() })).json();

    const res = await request.patch(`/api/tenants/${tenantA.id}/crm/campaigns/${created.id}`, {
      headers: authHeaders,
      data:    { name: 'Renamed PW', criteria: { segment: 'VIP' } },
    });
    expect(res.status(), `update: ${await res.text()}`).toBeLessThan(300);
    const updated = await res.json();
    expect(updated.name).toBe('Renamed PW');
    expect(updated.criteria).toEqual({ segment: 'VIP' });
  });

  test('[CRM-3] GET /campaigns liste avec filtre status', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    await (await request.post(`/api/tenants/${tenantA.id}/crm/campaigns`, { headers: authHeaders, data: baseDto('-A') }));
    await (await request.post(`/api/tenants/${tenantA.id}/crm/campaigns`, { headers: authHeaders, data: baseDto('-B') }));

    const res = await request.get(`/api/tenants/${tenantA.id}/crm/campaigns?status=DRAFT`, { headers: authHeaders });
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const c of list) expect(c.status).toBe('DRAFT');
  });

  test('[CRM-4] GET /campaigns/:id/audience renvoie une estimation', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const created = await (await request.post(`/api/tenants/${tenantA.id}/crm/campaigns`, { headers: authHeaders, data: baseDto() })).json();

    const res = await request.get(`/api/tenants/${tenantA.id}/crm/campaigns/${created.id}/audience`, { headers: authHeaders });
    expect(res.status(), `audience: ${await res.text()}`).toBe(200);
    const aud = await res.json();
    expect(typeof aud.count).toBe('number');
    expect(aud.count).toBeGreaterThanOrEqual(0);
  });

  test('[CRM-5] DELETE /campaigns/:id supprime un DRAFT', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const created = await (await request.post(`/api/tenants/${tenantA.id}/crm/campaigns`, { headers: authHeaders, data: baseDto() })).json();

    const del = await request.delete(`/api/tenants/${tenantA.id}/crm/campaigns/${created.id}`, { headers: authHeaders });
    expect(del.status(), `delete: ${await del.text()}`).toBeLessThan(300);

    const after = await request.get(`/api/tenants/${tenantA.id}/crm/campaigns/${created.id}`, { headers: authHeaders });
    expect(after.status()).toBe(404);
  });
});
