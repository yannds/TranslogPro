/**
 * E2E API test — QHSE accident reports + sub-entities (third-parties, injuries,
 * follow-ups, disputes, expenses) + presigned upload URLs.
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] QHSE accidents flow', () => {

  test('[QHSE-1] Severity-type CRUD + accident creation', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA, ['QHSE']);
    const base = `/api/tenants/${tenantA.id}/qhse`;

    // Severity type
    const sev = await (await request.post(`${base}/severity-types`, {
      headers: authHeaders,
      data:    { code: `MIN-${Date.now()}`, name: 'Mineur' },
    })).json();
    expect(sev.id).toBeTruthy();

    // Accident
    const acc = await request.post(`${base}/accidents`, {
      headers: authHeaders,
      data: {
        severityTypeId: sev.id,
        reportedById:   tenantA.userId,
        reportedByRole: 'QHSE',
        occurredAt:     new Date().toISOString(),
        description:    'Test E2E',
      },
    });
    expect(acc.status(), `accident: ${await acc.text()}`).toBeLessThan(300);
    expect((await acc.json()).id).toBeTruthy();
  });

  test('[QHSE-2] photo-url + third-party + injury + follow-up + dispute + expense', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA, ['QHSE']);
    const base = `/api/tenants/${tenantA.id}/qhse`;

    const sev = await (await request.post(`${base}/severity-types`, {
      headers: authHeaders, data: { code: `M-${Date.now()}`, name: 'Mineur' },
    })).json();
    const accident = await (await request.post(`${base}/accidents`, {
      headers: authHeaders,
      data: {
        severityTypeId: sev.id, reportedById: tenantA.userId, reportedByRole: 'QHSE',
        occurredAt: new Date().toISOString(), description: 'E2E full flow',
      },
    })).json();

    // Photo URL
    const photoUrl = await request.post(`${base}/accidents/${accident.id}/photo-url`, {
      headers: authHeaders, data: {},
    });
    expect(photoUrl.status(), `photo-url: ${await photoUrl.text()}`).toBeLessThan(300);
    const { uploadUrl, fileKey, expiresAt } = await photoUrl.json();
    expect(uploadUrl).toMatch(/^https?:\/\//);
    expect(fileKey).toBeTruthy();
    expect(expiresAt).toBeTruthy();

    // Third-party + statement-url
    const tp = await (await request.post(`${base}/accidents/${accident.id}/third-parties`, {
      headers: authHeaders,
      data: { type: 'PEDESTRIAN', name: 'Tiers test', phone: '+242000000' },
    })).json();
    expect(tp.id).toBeTruthy();
    const stmtUrl = await request.post(`${base}/third-parties/${tp.id}/statement-url`, {
      headers: authHeaders, data: {},
    });
    expect(stmtUrl.status(), `statement-url: ${await stmtUrl.text()}`).toBeLessThan(300);

    // Injury + follow-up + upload-url
    const injury = await (await request.post(`${base}/accidents/${accident.id}/injuries`, {
      headers: authHeaders,
      data: { personType: 'PASSENGER', personName: 'Victime', severity: 'LIGHT' },
    })).json();
    expect(injury.id).toBeTruthy();
    const fu = await (await request.post(`${base}/injuries/${injury.id}/follow-ups`, {
      headers: authHeaders,
      data: { date: new Date().toISOString(), notes: 'OK' },
    })).json();
    expect(fu.id).toBeTruthy();
    const fuUrl = await request.post(`${base}/follow-ups/${fu.id}/upload-url`, {
      headers: authHeaders, data: {},
    });
    expect(fuUrl.status(), `fu upload: ${await fuUrl.text()}`).toBeLessThan(300);

    // Dispute + expense + upload-url
    const dispute = await (await request.post(`${base}/accidents/${accident.id}/dispute`, {
      headers: authHeaders,
      data: { mode: 'INSURANCE', insurerName: 'PW Insurer' },
    })).json();
    expect(dispute.id).toBeTruthy();
    const expense = await (await request.post(`${base}/disputes/${dispute.id}/expenses`, {
      headers: authHeaders,
      data: { type: 'LEGAL', amountXaf: 50000, description: 'Avocat' },
    })).json();
    expect(expense.id).toBeTruthy();
    const expUrl = await request.post(`${base}/dispute-expenses/${expense.id}/upload-url`, {
      headers: authHeaders, data: {},
    });
    expect(expUrl.status(), `expense upload: ${await expUrl.text()}`).toBeLessThan(300);
  });
});
