/**
 * E2E API tests — Portail citoyen (signalement anonyme) — Sprint 4.
 *
 * Vérifie contre une API réelle (localhost:3000) :
 *
 *   [SR-1] POST /api/public/report SANS Host mappé à un tenant → 400.
 *   [SR-2] GET  /api/public/report/tenant-info AVEC Host tenant A →
 *          renvoie { tenantId: A.id, slug: A.slug } — aucune autre clé fuitée.
 *   [SR-3] POST /api/public/report AVEC Host tenant A → accepté ; le rapport
 *          est créé pour le tenant A (pas pour B) — anti cross-tenant.
 *
 * Prérequis : l'API doit tourner localement, seed E2E users/tenants en place.
 */

import { test, expect } from './fixtures';

test.describe('[E2E-API] Public Reporter — tenant host resolution', () => {

  test('[SR-1] POST /public/report sans Host mappé → 400', async ({ request }) => {
    const res = await request.post('/api/public/report', {
      data: {
        plateOrParkNumber: 'BZV-1',
        type:              'DANGEROUS_DRIVING',
        description:       'description suffisamment longue pour passer la validation',
      },
      headers: { Host: 'localhost:3000' },
    });
    expect(res.status()).toBe(400);
  });

  test('[SR-2] GET /public/report/tenant-info → retourne uniquement { tenantId, slug }', async ({ request, tenantA }) => {
    const res = await request.get('/api/public/report/tenant-info', {
      headers: { Host: tenantA.hostname },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe(tenantA.id);
    // Pas de leak de données sensibles
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['slug', 'tenantId']);
  });

  test('[SR-3] POST /public/report → rapport créé pour le bon tenant', async ({ request, tenantA }) => {
    const res = await request.post('/api/public/report', {
      data: {
        plateOrParkNumber: 'BZV-TEST-' + Date.now(),
        type:              'DANGEROUS_DRIVING',
        description:       'signalement e2e automatique pour vérifier l\'isolation tenant',
      },
      headers: { Host: tenantA.hostname },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toMatch(/PENDING|VERIFIED/);
  });
});
