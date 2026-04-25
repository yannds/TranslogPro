/**
 * E2E API test — Notifications preferences + unread.
 *
 *   [NOTIF-1] GET /notifications/preferences renvoie les préférences (defaults si absent)
 *   [NOTIF-2] PATCH /notifications/preferences persiste les flags sms/whatsapp/email
 *   [NOTIF-3] GET /notifications/unread renvoie une liste (potentiellement vide)
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Notifications preferences', () => {

  test('[NOTIF-1] GET preferences renvoie un objet (default si absent)', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const res = await request.get(`/api/tenants/${tenantA.id}/notifications/preferences`, {
      headers: authHeaders,
    });
    expect(res.status(), `prefs get: ${await res.text()}`).toBe(200);
    const prefs = await res.json();
    expect(typeof prefs).toBe('object');
  });

  test('[NOTIF-2] PATCH preferences persiste sms/whatsapp/email', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const patch = await request.patch(`/api/tenants/${tenantA.id}/notifications/preferences`, {
      headers: authHeaders,
      data:    { sms: true, whatsapp: false, email: true },
    });
    expect(patch.status(), `prefs patch: ${await patch.text()}`).toBeLessThan(300);

    const after = await request.get(`/api/tenants/${tenantA.id}/notifications/preferences`, {
      headers: authHeaders,
    });
    const prefs = await after.json();
    expect(prefs.sms).toBe(true);
    expect(prefs.whatsapp).toBe(false);
    expect(prefs.email).toBe(true);
  });

  test('[NOTIF-3] GET unread renvoie une liste (vide ou non)', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const res = await request.get(`/api/tenants/${tenantA.id}/notifications/unread`, {
      headers: authHeaders,
    });
    expect(res.status(), `unread: ${await res.text()}`).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
  });
});
