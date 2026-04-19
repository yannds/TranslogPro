/**
 * E2E API tests — Self-service compte (PageAccount)
 *
 * Vérifie CONTRE UNE API RÉELLE (localhost:3000) les 3 flows self-service :
 *
 *   [ACC-1] PATCH /auth/me/preferences persiste locale/timezone et revient dans /me
 *   [ACC-2] POST  /auth/change-password refuse un currentPassword faux → 401
 *   [ACC-3] POST  /auth/change-password réussit, invalide les sessions existantes
 *           (le cookie posé avant le change est rejeté par /me ensuite)
 *
 * Prérequis : l'API doit tourner sur localhost:3000 avec la DB dev.
 *             Les fixtures Playwright provisionnent un user.
 */
import { test, expect } from './fixtures';

test.describe('[E2E-API] Account self-service', () => {

  test('[ACC-1] PATCH /auth/me/preferences persiste locale + timezone', async ({
    request, tenantA,
  }) => {
    // 1. Login pour obtenir un cookie
    const signIn = await request.post('/api/auth/sign-in', {
      data:    { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: tenantA.hostname },
    });
    expect(signIn.status()).toBe(200);
    const cookie = signIn.headers()['set-cookie']!.split(';')[0];

    // 2. PATCH preferences
    const patch = await request.patch('/api/auth/me/preferences', {
      data:    { locale: 'ln', timezone: 'Africa/Brazzaville' },
      headers: { Host: tenantA.hostname, Cookie: cookie },
    });
    expect(patch.status()).toBe(200);
    const out = await patch.json();
    expect(out).toEqual({ locale: 'ln', timezone: 'Africa/Brazzaville' });

    // 3. /me renvoie les valeurs persistées
    const me = await request.get('/api/auth/me', {
      headers: { Host: tenantA.hostname, Cookie: cookie },
    });
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.locale).toBe('ln');
    expect(body.timezone).toBe('Africa/Brazzaville');
  });

  test('[ACC-2] change-password refuse un currentPassword faux → 401', async ({
    request, tenantA,
  }) => {
    const signIn = await request.post('/api/auth/sign-in', {
      data:    { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: tenantA.hostname },
    });
    const cookie = signIn.headers()['set-cookie']!.split(';')[0];

    const res = await request.post('/api/auth/change-password', {
      data:    { currentPassword: 'WRONG-PWD!', newPassword: 'AnotherPwd123!' },
      headers: { Host: tenantA.hostname, Cookie: cookie },
    });
    expect(res.status()).toBe(401);
  });

  test('[ACC-3] change-password succès : sessions invalidées', async ({
    request, tenantA,
  }) => {
    // 1. Login → cookie A
    const signIn = await request.post('/api/auth/sign-in', {
      data:    { email: tenantA.userEmail, password: tenantA.userPassword },
      headers: { Host: tenantA.hostname },
    });
    const cookieA = signIn.headers()['set-cookie']!.split(';')[0];

    // 2. /me OK avec cookie A
    const meBefore = await request.get('/api/auth/me', {
      headers: { Host: tenantA.hostname, Cookie: cookieA },
    });
    expect(meBefore.status()).toBe(200);

    // 3. Change password — retour 200 + Set-Cookie vide
    const NEW_PWD = `NewPwd${Date.now()}!`;
    const change = await request.post('/api/auth/change-password', {
      data:    { currentPassword: tenantA.userPassword, newPassword: NEW_PWD },
      headers: { Host: tenantA.hostname, Cookie: cookieA },
    });
    expect(change.status()).toBe(200);

    // 4. /me avec l'ancien cookie retourne 401 (session purgée)
    const meAfter = await request.get('/api/auth/me', {
      headers: { Host: tenantA.hostname, Cookie: cookieA },
    });
    expect(meAfter.status()).toBe(401);

    // 5. Nouveau login avec le nouveau mdp réussit
    const reLogin = await request.post('/api/auth/sign-in', {
      data:    { email: tenantA.userEmail, password: NEW_PWD },
      headers: { Host: tenantA.hostname },
    });
    expect(reLogin.status()).toBe(200);

    // 6. Restore le mdp initial pour ne pas casser les tests suivants
    const cookieNew = reLogin.headers()['set-cookie']!.split(';')[0];
    const restore = await request.post('/api/auth/change-password', {
      data:    { currentPassword: NEW_PWD, newPassword: tenantA.userPassword },
      headers: { Host: tenantA.hostname, Cookie: cookieNew },
    });
    expect(restore.status()).toBe(200);
  });
});
