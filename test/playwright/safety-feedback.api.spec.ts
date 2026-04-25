/**
 * E2E API test — Safety alerts + Feedback ratings.
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Safety alerts + Feedback', () => {

  test('[SAF-1] POST /safety/alerts + GET list + PATCH dismiss', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/safety`;

    const res = await request.post(`${base}/alerts`, {
      headers: authHeaders,
      data: {
        type:        'OTHER',
        description: 'Test PW',
        gpsLat:      -4.2634,
        gpsLng:      15.2429,
      },
    });
    expect(res.status(), `report alert: ${await res.text()}`).toBeLessThan(300);
    const alert = await res.json();
    expect(alert.id).toBeTruthy();

    const list = await request.get(`${base}/alerts`, { headers: authHeaders });
    expect(list.status()).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);

    const dismiss = await request.patch(`${base}/alerts/${alert.id}/dismiss`, {
      headers: authHeaders, data: { reason: 'Test E2E' },
    });
    expect(dismiss.status(), `dismiss: ${await dismiss.text()}`).toBeLessThan(300);
  });

  test('[FBK-1] POST feedback + GET ratings', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/feedback`;

    const post = await request.post(base, {
      headers: authHeaders,
      data: {
        ratings:     { conduct: 5, punctuality: 4, comfort: 4 },
        comment:     'Trajet agréable PW',
        rgpdConsent: true,
      },
    });
    expect(post.status(), `feedback post: ${await post.text()}`).toBeLessThan(300);

    // GET ratings (placeholder entityType — accepts any)
    const ratings = await request.get(`${base}/ratings/Trip/dummy`, { headers: authHeaders });
    expect(ratings.status()).toBe(200);
  });
});
