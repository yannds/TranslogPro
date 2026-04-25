/**
 * E2E API test — Analytics dashboard, KPIs, revenue, trips, occupancy.
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Analytics', () => {

  test('[ANL-1] Endpoints analytics répondent', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/analytics`;

    const dashboard = await request.get(`${base}/dashboard`, { headers: authHeaders });
    expect(dashboard.status(), `dashboard: ${await dashboard.text()}`).toBe(200);

    const kpis = await request.get(`${base}/kpis`, { headers: authHeaders });
    expect(kpis.status()).toBe(200);

    const from = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);
    const revenue = await request.get(`${base}/revenue?from=${from}&to=${to}`, { headers: authHeaders });
    expect(revenue.status(), `revenue: ${await revenue.text()}`).toBe(200);

    const trips = await request.get(`${base}/trips?from=${from}&to=${to}`, { headers: authHeaders });
    expect(trips.status(), `trips: ${await trips.text()}`).toBe(200);

    const today = await request.get(`${base}/today-summary`, { headers: authHeaders });
    expect(today.status()).toBe(200);

    const fleet = await request.get(`${base}/fleet-summary`, { headers: authHeaders });
    expect(fleet.status()).toBe(200);
  });
});
