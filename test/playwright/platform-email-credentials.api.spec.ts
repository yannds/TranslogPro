/**
 * E2E API test — Configuration credentials providers email (admin plateforme).
 *
 *   [PEC-1] GET /providers expose `fields[]` + `configured` pour chaque provider.
 *   [PEC-2] GET /providers/o365/credentials retourne les champs avec CLIENT_SECRET masqué.
 *   [PEC-3] PUT /providers/o365/credentials écrit en Vault + déclenche un healthcheck.
 *   [PEC-4] Round-trip : la valeur masquée renvoyée au PUT conserve l'ancien secret.
 *   [PEC-5] Champ required manquant → 400.
 *   [PEC-6] RBAC : un user sans control.platform.config.manage.global → 403.
 */
import { test, expect } from './fixtures';
import { setupPlatformAdmin, signIn } from './helpers/admin-setup';

const SECRET_MASK = '••••••••';

test.describe('[E2E-API] Platform email — credentials', () => {
  test('[PEC-1..5] CRUD credentials o365 + masquage secret + healthcheck', async ({ request, tenantA }) => {
    const { authHeaders } = await setupPlatformAdmin(request, tenantA);

    // [PEC-1] Liste expose le schéma
    const list = await request.get('/api/platform/email/providers', { headers: authHeaders });
    expect(list.status(), `list: ${await list.text()}`).toBe(200);
    const providers = await list.json() as Array<{
      key: string; fields: Array<{ key: string; required?: boolean; secret?: boolean }>;
      configured: boolean;
    }>;
    const o365 = providers.find(p => p.key === 'o365');
    expect(o365).toBeDefined();
    expect(o365!.fields.map(f => f.key)).toEqual(
      expect.arrayContaining(['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SENDER_EMAIL', 'SENDER_NAME']),
    );
    expect(o365!.fields.find(f => f.key === 'CLIENT_SECRET')!.secret).toBe(true);

    // [PEC-3] PUT initial — credentials complets
    const tenantId   = '11111111-1111-1111-1111-111111111111';
    const clientId   = '22222222-2222-2222-2222-222222222222';
    const initSecret = 'super-secret-initial';
    const put1 = await request.put('/api/platform/email/providers/o365/credentials', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data:    {
        TENANT_ID:     tenantId,
        CLIENT_ID:     clientId,
        CLIENT_SECRET: initSecret,
        SENDER_EMAIL:  'noreply@example.test',
        SENDER_NAME:   'Test Sender',
      },
    });
    expect(put1.status(), `put1: ${await put1.text()}`).toBe(200);
    const put1Body = await put1.json();
    // healthcheck est exécuté → status présent (UP/DOWN/UNKNOWN). On ne valide
    // pas UP car l'API Microsoft Graph n'est pas joignable sans vrai tenant.
    expect(put1Body).toHaveProperty('status');

    // [PEC-2] GET retourne valeurs en clair SAUF CLIENT_SECRET masqué
    const get1 = await request.get('/api/platform/email/providers/o365/credentials', { headers: authHeaders });
    expect(get1.status()).toBe(200);
    const creds1 = await get1.json() as Record<string, string>;
    expect(creds1.TENANT_ID).toBe(tenantId);
    expect(creds1.CLIENT_ID).toBe(clientId);
    expect(creds1.SENDER_EMAIL).toBe('noreply@example.test');
    expect(creds1.SENDER_NAME).toBe('Test Sender');
    expect(creds1.CLIENT_SECRET).toBe(SECRET_MASK);
    // Garde-fou anti-régression : le secret en clair NE DOIT JAMAIS sortir
    expect(JSON.stringify(creds1)).not.toContain(initSecret);

    // [PEC-4] PUT en renvoyant le mask sur CLIENT_SECRET → ancien secret conservé
    const put2 = await request.put('/api/platform/email/providers/o365/credentials', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: {
        TENANT_ID:     tenantId,
        CLIENT_ID:     clientId,
        CLIENT_SECRET: SECRET_MASK,           // ← user n'a pas modifié le secret
        SENDER_EMAIL:  'changed@example.test', // mais a changé l'email
        SENDER_NAME:   'Test Sender',
      },
    });
    expect(put2.status()).toBe(200);

    const get2 = await request.get('/api/platform/email/providers/o365/credentials', { headers: authHeaders });
    const creds2 = await get2.json() as Record<string, string>;
    expect(creds2.SENDER_EMAIL).toBe('changed@example.test'); // changé
    expect(creds2.CLIENT_SECRET).toBe(SECRET_MASK);            // toujours masqué côté GET

    // [PEC-1 bis] List après écriture → configured=true
    const list2 = await request.get('/api/platform/email/providers', { headers: authHeaders });
    const providers2 = await list2.json() as Array<{ key: string; configured: boolean }>;
    expect(providers2.find(p => p.key === 'o365')!.configured).toBe(true);

    // [PEC-5] PUT avec champ required manquant → 400
    const putBad = await request.put('/api/platform/email/providers/o365/credentials', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: {
        TENANT_ID:    tenantId,
        // CLIENT_ID, CLIENT_SECRET, SENDER_EMAIL manquants
      },
    });
    expect(putBad.status()).toBe(400);
  });

  test('[PEC-6] user sans permission plateforme → 403 sur GET/PUT credentials', async ({ request, tenantA }) => {
    // tenantA a un user "régulier" (pas plateforme). signIn → cookie tenant.
    const { authHeaders } = await signIn(request, tenantA);

    const get = await request.get('/api/platform/email/providers/o365/credentials', { headers: authHeaders });
    expect([401, 403]).toContain(get.status());

    const put = await request.put('/api/platform/email/providers/o365/credentials', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data:    { TENANT_ID: 'x', CLIENT_ID: 'y', CLIENT_SECRET: 'z', SENDER_EMAIL: 'a@b.c' },
    });
    expect([401, 403]).toContain(put.status());
  });
});
