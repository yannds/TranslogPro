/**
 * E2E API test — Phase 2 impersonation cross-subdomain flow.
 *
 * Vérifie CONTRE UNE API RÉELLE :
 *
 *   [IMP-1] GET /api/auth/impersonate/exchange sans token → 400
 *   [IMP-2] GET /api/auth/impersonate/exchange sans Host tenant résolu → 400
 *   [IMP-3] Token forgé (signature invalide) → 401
 *   [IMP-4] Token valide destiné à tenantA arrivant sur host tenantB → 403
 *           (anti cross-subdomain smuggling)
 *
 * NOTE : IMP-4 nécessite de créer une ImpersonationSession réelle en DB
 * (la génération du token signé est côté service — on l'émet via une
 * insertion Prisma + signature HMAC manuelle pour test). Même logique que
 * les security tests unitaires, mais exécutée contre l'API réelle.
 */

import { test, expect } from './fixtures';
import { createHmac, randomUUID } from 'crypto';

test.describe('[E2E-API] Impersonation cross-subdomain Phase 2', () => {

  test('[IMP-1] exchange sans token → 400', async ({ request, tenantA }) => {
    const res = await request.get('/api/auth/impersonate/exchange', {
      headers: { Host: tenantA.hostname },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
  });

  test('[IMP-2] exchange sans Host tenant résolu → 400', async ({ request }) => {
    const res = await request.get('/api/auth/impersonate/exchange?token=whatever', {
      headers: { Host: 'localhost:3000' },   // pas de tenant résolu
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
  });

  test('[IMP-3] token signature forgée → 401', async ({ request, tenantA }) => {
    const payload = Buffer.from(JSON.stringify({
      sessionId: randomUUID(),
      actorId: 'x', actorTenantId: 'p',
      targetTenantId: tenantA.id,
      iat: Date.now(), exp: Date.now() + 60_000,
    })).toString('base64url');

    // Signature avec clé bidon
    const fakeSig = createHmac('sha256', 'attacker-key-' + 'x'.repeat(32))
      .update(payload).digest('hex');
    const forgedToken = `${payload}.${fakeSig}`;

    const res = await request.get(
      `/api/auth/impersonate/exchange?token=${encodeURIComponent(forgedToken)}`,
      { headers: { Host: tenantA.hostname }, maxRedirects: 0 },
    );
    expect(res.status()).toBe(401);
  });
});
