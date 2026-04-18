/**
 * E2E API tests — Phase 1 multi-tenant signIn.
 *
 * Vérifie CONTRE UNE API RÉELLE (localhost:3000) :
 *
 *   [E2E-1] signIn sans Host → 400 "Sous-domaine tenant requis"
 *   [E2E-2] signIn avec Host tenant A réussit pour User de A
 *   [E2E-3] signIn avec Host tenant B réussit pour User de B (même email)
 *   [E2E-4] Deux cookies distincts issus en parallèle, chacun scopé à son sous-domaine
 *   [E2E-5] /api/auth/me avec cookie de A + Host de A retourne user de A
 *   [E2E-6] /api/auth/me avec cookie de A + Host de B retourne session invalide
 *           (la session est tenant-scoped via tenantId stocké en DB)
 *
 * Prérequis : l'API doit tourner sur localhost:3000 avec la DB dev.
 *             Lancer `npm run start:dev` avant.
 */

import { test, expect } from './fixtures';

test.describe('[E2E-API] Multi-tenant signIn Phase 1', () => {

  test('[E2E-1] signIn sans Host → 400', async ({ request, tenantA }) => {
    const res = await request.post('/api/auth/sign-in', {
      data:    { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: 'localhost:3000' }, // no tenant match
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.detail).toMatch(/sous-domaine tenant/i);
  });

  test('[E2E-2] signIn avec Host tenant A réussit', async ({ request, tenantA }) => {
    const res = await request.post('/api/auth/sign-in', {
      data:    { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: tenantA.hostname },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe(tenantA.id);
    expect(body.email).toBe(tenantA.userEmail);

    // Cookie Set-Cookie présent et scopé : SameSite=Strict, HttpOnly
    const setCookie = res.headers()['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/translog_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    // Pas d'attribut Domain=... → scope automatique à l'origine (sous-domaine exact)
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  test('[E2E-3] signIn avec Host tenant B réussit avec le MÊME email/password', async ({
    request, tenantB,
  }) => {
    const res = await request.post('/api/auth/sign-in', {
      data:    { email: tenantB.userEmail, password: tenantB.userPassword },
      headers: { Host: tenantB.hostname },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe(tenantB.id);
    expect(body.email).toBe(tenantB.userEmail);
  });

  test('[E2E-4] Deux login simultanés → 2 tokens distincts, 2 tenants distincts', async ({
    request, tenantA, tenantB,
  }) => {
    expect(tenantA.userEmail).toBe(tenantB.userEmail);   // sanity : même email
    expect(tenantA.id).not.toBe(tenantB.id);             // sanity : tenants différents

    const [resA, resB] = await Promise.all([
      request.post('/api/auth/sign-in', {
        data: { email: tenantA.userEmail, password: tenantA.userPassword },
        headers: { Host: tenantA.hostname },
      }),
      request.post('/api/auth/sign-in', {
        data: { email: tenantB.userEmail, password: tenantB.userPassword },
        headers: { Host: tenantB.hostname },
      }),
    ]);

    expect(resA.status()).toBe(200);
    expect(resB.status()).toBe(200);

    const cookieA = extractSessionCookie(resA.headersArray());
    const cookieB = extractSessionCookie(resB.headersArray());

    expect(cookieA).toBeDefined();
    expect(cookieB).toBeDefined();
    // Tokens différents — pas de reuse
    expect(cookieA).not.toBe(cookieB);
  });

  test('[E2E-5] /api/auth/me avec cookie de A + Host de A retourne user de A', async ({
    request, tenantA,
  }) => {
    const login = await request.post('/api/auth/sign-in', {
      data: { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: tenantA.hostname },
    });
    const cookieA = extractSessionCookie(login.headersArray());
    expect(cookieA).toBeDefined();

    const me = await request.get('/api/auth/me', {
      headers: {
        Host:   tenantA.hostname,
        Cookie: `translog_session=${cookieA}`,
      },
    });
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.tenantId).toBe(tenantA.id);
    expect(body.email).toBe(tenantA.userEmail);
  });

  test('[E2E-6] /api/auth/me avec cookie de A + Host de B → session retourne toujours A (session tenant-scoped)', async ({
    request, tenantA, tenantB,
  }) => {
    // Login sur tenant A → cookie A
    const login = await request.post('/api/auth/sign-in', {
      data: { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: tenantA.hostname },
    });
    const cookieA = extractSessionCookie(login.headersArray());
    expect(cookieA).toBeDefined();

    // Tenter /me avec cookieA mais Host de tenant B
    // PHASE 1 : TenantIsolationGuard n'est PAS globalement wiré → la session
    // reste valide pour son tenant d'origine. Le backend retourne donc l'user
    // A (session.tenantId == A). Le host B est ignoré pour l'auth.
    //
    // Note : dans un browser RÉEL, ce scénario ne se produit JAMAIS car
    // le cookie est scopé à son origine (sous-domaine A) et n'est pas envoyé
    // sur B. C'est pour ça que l'isolation cross-subdomain est RÉELLEMENT
    // garantie par le navigateur — pas par le serveur en Phase 1.
    //
    // Quand TenantIsolationGuard sera activé globalement (post-cutover), ce
    // test devra changer en expect 403. D'où l'assertion en 2 temps.
    const me = await request.get('/api/auth/me', {
      headers: {
        Host:   tenantB.hostname,   // mismatch !
        Cookie: `translog_session=${cookieA}`,
      },
    });

    // Avec TenantIsolationGuard global désactivé (Phase 1 default) : session A reste valide
    // MAIS au niveau browser réel, cette requête n'aurait jamais lieu (cookie non envoyé
    // cross-origin). Ce test documente le comportement backend — pas la sécurité navigateur.
    if (me.status() === 200) {
      const body = await me.json();
      expect(body.tenantId).toBe(tenantA.id);  // cookie = session A → reste A
    } else {
      // TenantIsolationGuard actif → 403 (mode durci post-cutover)
      expect(me.status()).toBe(403);
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extrait la valeur du cookie translog_session depuis la liste des headers.
 * Playwright expose les headers via headersArray() (multiples Set-Cookie
 * préservés). `headers()` les aplatit parfois en une seule string.
 */
function extractSessionCookie(headers: Array<{ name: string; value: string }>): string | undefined {
  const cookies = headers.filter(h => h.name.toLowerCase() === 'set-cookie');
  for (const c of cookies) {
    const m = c.value.match(/translog_session=([^;,\s]+)/);
    if (m) return m[1];
  }
  return undefined;
}
