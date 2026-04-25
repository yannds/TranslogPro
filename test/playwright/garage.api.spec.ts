/**
 * E2E API test — Garage maintenance reports + upload-url + reminders.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { setupAdminTenant } from './helpers/admin-setup';

const prisma = new PrismaClient();

test.describe('[E2E-API] Garage maintenance', () => {

  test('[GR-1] Report CRUD + upload-url + reminders/performed', async ({ request, tenantA }) => {
    const { agencyId, authHeaders } = await setupAdminTenant(request, tenantA, ['GARAGE_PRO']);
    const base = `/api/tenants/${tenantA.id}/garage`;

    // Bus prérequis
    const bus = await prisma.bus.create({
      data: {
        tenantId: tenantA.id, agencyId,
        plateNumber: `PW-GR-${Date.now()}`,
        model: 'Truck', type: 'STANDARD', capacity: 30,
        luggageCapacityKg: 300, luggageCapacityM3: 5,
      },
    });

    // Create report
    const reportRes = await request.post(`${base}/reports`, {
      headers: authHeaders,
      data: {
        busId: bus.id, type: 'PREVENTIVE', description: 'Vidange E2E',
        scheduledAt: new Date().toISOString(), odometer: 50000,
      },
    });
    expect(reportRes.status(), `create report: ${await reportRes.text()}`).toBeLessThan(300);
    const report = await reportRes.json();
    expect(report.id).toBeTruthy();

    // Upload-url
    const upl = await request.get(`${base}/reports/${report.id}/upload-url`, { headers: authHeaders });
    expect(upl.status(), `upload-url: ${await upl.text()}`).toBeLessThan(300);

    // Reports list
    const list = await (await request.get(`${base}/reports`, { headers: authHeaders })).json();
    expect(list.find((r: { id: string }) => r.id === report.id)).toBeTruthy();

    // Bus reports
    const busReports = await (await request.get(`${base}/buses/${bus.id}/reports`, { headers: authHeaders })).json();
    expect(busReports.find((r: { id: string }) => r.id === report.id)).toBeTruthy();

    // Reminders performed
    const perf = await request.post(`${base}/reminders/${bus.id}/OIL_CHANGE/performed`, {
      headers: authHeaders, data: { performedKm: 50000, performedDate: new Date().toISOString() },
    });
    expect(perf.status(), `performed: ${await perf.text()}`).toBeLessThan(300);
  });
});
