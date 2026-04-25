/**
 * E2E API test — Endpoints /platform/* (super-admin only).
 *
 *   [PA-1] platform-analytics : growth/adoption/health/tenant/:id
 *   [PA-2] platform-plans : catalog/list/create/delete/modules add+remove
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupPlatformAdmin } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] Platform admin (super-admin)', () => {

  test('[PA-1] platform-analytics endpoints répondent', async ({ request, tenantA }) => {
    const { authHeaders } = await setupPlatformAdmin(request, tenantA);

    const growth = await request.get('/api/platform/analytics/growth', { headers: authHeaders });
    expect(growth.status(), `growth: ${await growth.text()}`).toBe(200);

    const adoption = await request.get('/api/platform/analytics/adoption', { headers: authHeaders });
    expect(adoption.status()).toBe(200);

    const health = await request.get('/api/platform/analytics/health', { headers: authHeaders });
    expect(health.status()).toBe(200);

    const tenantAnalytics = await request.get(`/api/platform/analytics/tenant/${tenantA.id}`, { headers: authHeaders });
    expect(tenantAnalytics.status()).toBe(200);
  });

  test('[PA-2] platform-plans CRUD + modules add/remove', async ({ request, tenantA }) => {
    const { authHeaders } = await setupPlatformAdmin(request, tenantA);

    // Catalog (modules disponibles)
    const catalog = await request.get('/api/platform/plans/catalog', { headers: authHeaders });
    expect(catalog.status(), `catalog: ${await catalog.text()}`).toBe(200);

    // List plans
    const list = await request.get('/api/platform/plans', { headers: authHeaders });
    expect(list.status()).toBe(200);

    // Create plan
    const slug = `pw-plan-${Date.now()}`;
    const create = await request.post('/api/platform/plans', {
      headers: authHeaders,
      data: {
        name:         'PW Test Plan',
        slug,
        description:  'E2E test',
        price:        10000,
        currency:     'XAF',
        billingCycle: 'MONTHLY',
      },
    });
    expect(create.status(), `create: ${await create.text()}`).toBeLessThan(300);
    const plan = await create.json();
    expect(plan.id).toBeTruthy();

    // Add module to plan
    const addMod = await request.post(`/api/platform/plans/${plan.id}/modules`, {
      headers: authHeaders, data: { moduleKey: 'FLEET_DOCS' },
    });
    expect(addMod.status(), `add module: ${await addMod.text()}`).toBeLessThan(300);

    // Remove module
    const delMod = await request.delete(`/api/platform/plans/${plan.id}/modules/FLEET_DOCS`, { headers: authHeaders });
    expect(delMod.status(), `del module: ${await delMod.text()}`).toBeLessThan(300);

    // Delete plan
    const del = await request.delete(`/api/platform/plans/${plan.id}`, { headers: authHeaders });
    expect(del.status(), `delete: ${await del.text()}`).toBeLessThan(300);
  });
});
