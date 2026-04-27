/**
 * E2E API tests — Politique MFA assouplie 2026-04-27.
 *
 * Vérifie bout-en-bout (HTTP réel + DB Postgres réelle) :
 *
 *   [MFA-1] TENANT_ADMIN sans MFA → /me retourne suggestedEnrollMfa=true,
 *           mustEnrollMfa=false. User.mfaSuggestionSentAt marqué en DB.
 *           → l'admin peut accéder au dashboard sans blocage MFA.
 *
 *   [MFA-2] Idempotence — 2 sign-in successifs ne déclenchent qu'une seule
 *           notification (mfaSuggestionSentAt set la 1re fois, inchangé la 2e).
 *           → anti-spam validé.
 *
 *   [MFA-3] Staff PLATEFORME avec MFA actif → POST /mfa/disable retourne 403
 *           ForbiddenException. La désactivation est interdite.
 *
 *   [MFA-4] Staff TENANT avec MFA actif → POST /mfa/disable accepte
 *           l'opération (rejette 401 sur code invalide, mais PAS 403).
 *
 * Prérequis : API sur localhost:3000, DB dev seedée (dev.sh up).
 */
import { test, expect } from './fixtures';
import { authenticator } from 'otplib';
import { signIn, setupPlatformAdmin } from './helpers/admin-setup';

test.describe('[E2E-API] Politique MFA 2026-04-27', () => {

  test('[MFA-1] TENANT_ADMIN sans MFA → /me a suggestedEnrollMfa=true, mustEnrollMfa=false', async ({
    request, prisma, tenantA,
  }) => {
    // 1. Sign-in standard — déclenche maybeSendSuggestion en arrière-plan
    const { authHeaders } = await signIn(request, tenantA);

    // 2. /me reflète la nouvelle politique
    const me = await request.get('/api/auth/me', { headers: authHeaders });
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.mfaEnabled).toBe(false);
    expect(body.mustEnrollMfa).toBe(false);          // ← politique 2026-04-27 : plus jamais bloquant
    expect(body.suggestedEnrollMfa).toBe(true);      // ← banner s'affichera côté front

    // 3. La notif suggestion a été marquée en DB (anti-spam au prochain login).
    //    Le dispatch est fire-and-forget (`void mfa.maybeSendSuggestion`) — on
    //    laisse 200ms à la query async d'aboutir avant de vérifier.
    await new Promise(r => setTimeout(r, 200));
    const dbUser = await prisma.user.findUnique({
      where:  { id: tenantA.userId },
      select: { mfaSuggestionSentAt: true },
    });
    expect(dbUser?.mfaSuggestionSentAt).toBeInstanceOf(Date);
  });

  test('[MFA-2] Idempotence — 2 sign-in ne déclenchent qu\'une seule notif', async ({
    request, prisma, tenantA,
  }) => {
    // 1er sign-in → marqueur posé
    await signIn(request, tenantA);
    await new Promise(r => setTimeout(r, 200));
    const after1 = await prisma.user.findUnique({
      where:  { id: tenantA.userId },
      select: { mfaSuggestionSentAt: true },
    });
    expect(after1?.mfaSuggestionSentAt).toBeInstanceOf(Date);
    const firstTimestamp = after1!.mfaSuggestionSentAt!.getTime();

    // Délai > 0 pour pouvoir détecter une re-écriture si elle se produisait à tort
    await new Promise(r => setTimeout(r, 1100));

    // 2e sign-in → ne doit PAS re-déclencher la notif (anti-spam)
    await signIn(request, tenantA);
    await new Promise(r => setTimeout(r, 200));
    const after2 = await prisma.user.findUnique({
      where:  { id: tenantA.userId },
      select: { mfaSuggestionSentAt: true },
    });
    expect(after2?.mfaSuggestionSentAt?.getTime()).toBe(firstTimestamp);
  });

  test('[MFA-3] Staff PLATEFORME → /mfa/disable rejette 403 (verrou)', async ({
    request, prisma, tenantA,
  }) => {
    // Bascule le user fixture en staff plateforme + signIn admin host.
    const { authHeaders } = await setupPlatformAdmin(request, tenantA);

    // Active MFA en DB (skip le QR/setup flow — on teste juste le verrou
    // disable, pas le flux de setup).
    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: tenantA.userId },
      data:  {
        mfaEnabled:    true,
        mfaSecret:     secret,
        mfaVerifiedAt: new Date(),
        mfaBackupCodes: [],
      },
    });

    // Génère un code TOTP valide pour ce secret — prouve que le 403 vient
    // du verrou plateforme (pas d'un mauvais code → 401).
    const validCode = authenticator.generate(secret);

    const res = await request.post('/api/mfa/disable', {
      data:    { code: validCode },
      headers: authHeaders,
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/staff plateforme|platform staff/i);

    // Vérification post : MFA reste actif en DB.
    const dbUser = await prisma.user.findUnique({
      where:  { id: tenantA.userId },
      select: { mfaEnabled: true },
    });
    expect(dbUser?.mfaEnabled).toBe(true);
  });

  test('[MFA-4] Staff TENANT → /mfa/disable autorisé (pas 403, code invalide → 401)', async ({
    request, prisma, tenantA,
  }) => {
    // Sign-in standard tenant.
    const { authHeaders } = await signIn(request, tenantA);

    // Active MFA en DB pour ce user tenant.
    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: tenantA.userId },
      data:  {
        mfaEnabled:    true,
        mfaSecret:     secret,
        mfaVerifiedAt: new Date(),
        mfaBackupCodes: [],
      },
    });

    // Code volontairement faux — on attend 401 (pas 403). Si la politique
    // 2026-04-27 était bugguée et bloquait aussi les staff tenant, on aurait 403.
    const res = await request.post('/api/mfa/disable', {
      data:    { code: '000000' },
      headers: authHeaders,
    });
    expect(res.status()).toBe(401);
    expect(res.status()).not.toBe(403);

    // Avec un VRAI code valide → désactivation OK (statut 204 No Content).
    const validCode = authenticator.generate(secret);
    const ok = await request.post('/api/mfa/disable', {
      data:    { code: validCode },
      headers: authHeaders,
    });
    expect(ok.status()).toBe(204);

    // Vérif DB : MFA bien désactivé.
    const dbUser = await prisma.user.findUnique({
      where:  { id: tenantA.userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    expect(dbUser?.mfaEnabled).toBe(false);
    expect(dbUser?.mfaSecret).toBeNull();
  });
});
