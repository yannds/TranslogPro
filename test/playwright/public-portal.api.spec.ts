/**
 * E2E API test — Public portal endpoints (consultation publique, no auth).
 *
 *   [PORT-1] GET /public/:slug/portal/config
 *   [PORT-2] GET /public/:slug/portal/announcements
 *   [PORT-3] GET /public/:slug/portal/footer-pages
 *   [PORT-4] GET /public/:slug/portal/pages
 *   [PORT-5] GET /public/:slug/portal/stations
 */
import { test, expect } from './fixtures';
import { ensureTenantActive } from './helpers/admin-setup';

test.describe('[E2E-API] Public portal', () => {

  test('[PORT-1..5] endpoints publics répondent', async ({ request, tenantA }) => {
    await ensureTenantActive(tenantA.id);
    const base = `/api/public/${tenantA.slug}/portal`;
    const headers = { Host: tenantA.hostname };

    const config = await request.get(`${base}/config`, { headers });
    expect(config.status(), `config: ${await config.text()}`).toBe(200);

    const annc = await request.get(`${base}/announcements`, { headers });
    expect(annc.status(), `annonces: ${await annc.text()}`).toBe(200);
    expect(Array.isArray(await annc.json())).toBe(true);

    const footer = await request.get(`${base}/footer-pages`, { headers });
    expect(footer.status(), `footer: ${await footer.text()}`).toBe(200);
    expect(Array.isArray(await footer.json())).toBe(true);

    const pages = await request.get(`${base}/pages`, { headers });
    expect(pages.status(), `pages: ${await pages.text()}`).toBe(200);
    expect(Array.isArray(await pages.json())).toBe(true);

    const stations = await request.get(`${base}/stations`, { headers });
    expect(stations.status(), `stations: ${await stations.text()}`).toBe(200);
    expect(Array.isArray(await stations.json())).toBe(true);
  });
});
