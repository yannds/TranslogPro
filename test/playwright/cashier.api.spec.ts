/**
 * E2E API test — Cashier register/transaction/daily-report.
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Cashier', () => {

  test('[CSH-1] Open register + transaction + register detail', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/cashier`;

    // Open
    const openRes = await request.post(`${base}/registers`, {
      headers: authHeaders, data: { agencyId, openingBalance: 100000, note: 'PW E2E' },
    });
    expect(openRes.status(), `open: ${await openRes.text()}`).toBeLessThan(300);
    const reg = await openRes.json();
    expect(reg.id).toBeTruthy();

    // GET registers/:id (orphelin §1)
    const detail = await request.get(`${base}/registers/${reg.id}`, { headers: authHeaders });
    expect(detail.status(), `detail: ${await detail.text()}`).toBe(200);
    const got = await detail.json();
    expect(got.id).toBe(reg.id);

    // Transaction
    const tx = await request.post(`${base}/registers/${reg.id}/transactions`, {
      headers: authHeaders,
      data: {
        type:          'CASH_IN',
        amount:        5000,
        paymentMethod: 'CASH',
        note:          'Test E2E',
      },
    });
    expect(tx.status(), `transaction: ${await tx.text()}`).toBeLessThan(300);
  });

  test('[CSH-2] Daily report répond', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/cashier`;

    // Open at least one register so daily report is meaningful
    await request.post(`${base}/registers`, {
      headers: authHeaders, data: { agencyId, openingBalance: 0 },
    });

    const today = new Date().toISOString().slice(0, 10);
    const res = await request.get(`${base}/report/daily?date=${today}`, { headers: authHeaders });
    expect(res.status(), `daily: ${await res.text()}`).toBe(200);
    expect(typeof await res.json()).toBe('object');
  });
});
