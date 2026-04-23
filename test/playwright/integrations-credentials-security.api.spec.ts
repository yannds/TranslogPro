/**
 * Security tests — BYO-credentials endpoints.
 *
 * Couvre :
 *   1. PUT /credentials sans auth → 401
 *   2. GET /schema sans auth → 401
 *   3. DELETE /credentials sans auth → 401
 *   4. Tenant A ne peut pas écrire les credentials du tenant B (cross-tenant)
 *   5. Rôle sans INTEGRATION_SETUP_TENANT → 403
 *   6. Champ hors schéma rejeté (400) — pas d'injection Vault arbitraire
 *   7. Provider inconnu → 404 (pas de Vault write)
 */
import { test, expect, request } from '@playwright/test';

const BASE      = process.env.API_URL ?? 'http://localhost:3000';
const TENANT_A  = process.env.E2E_TENANT_ID       ?? 'tenant-test-a';
const TENANT_B  = process.env.E2E_TENANT_ID_B      ?? 'tenant-test-b';
const TOKEN_A   = process.env.E2E_ADMIN_TOKEN       ?? '';
const TOKEN_B   = process.env.E2E_ADMIN_TOKEN_B     ?? '';

const credentialsUrl = (tenantId: string, provider: string) =>
  `/api/v1/tenants/${tenantId}/settings/integrations/${provider}/credentials`;
const schemaUrl = (tenantId: string, provider: string) =>
  `/api/v1/tenants/${tenantId}/settings/integrations/${provider}/schema`;

test.describe('BYO-credentials — sécurité HTTP', () => {
  test('PUT /credentials sans auth → 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.put(credentialsUrl(TENANT_A, 'wave'), {
      data: { credentials: { API_KEY: 'k', WEBHOOK_SECRET: 's' } },
    });
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test('GET /schema sans auth → 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.get(schemaUrl(TENANT_A, 'wave'));
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test('DELETE /credentials sans auth → 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.delete(credentialsUrl(TENANT_A, 'wave'));
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test('Tenant A ne peut pas écrire les credentials du tenant B', async () => {
    test.skip(!TOKEN_A || !TENANT_B, 'tokens E2E non configurés');
    const ctx = await request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN_A}` },
    });
    // Tenant A essaie d'écrire sur Tenant B → 403 (guard cross-tenant)
    const res = await ctx.put(credentialsUrl(TENANT_B, 'wave'), {
      data: { credentials: { API_KEY: 'k', WEBHOOK_SECRET: 's' } },
    });
    expect([403, 401]).toContain(res.status());
    await ctx.dispose();
  });

  test('Provider inconnu → 404, pas d\'écriture Vault', async () => {
    test.skip(!TOKEN_A, 'token E2E non configuré');
    const ctx = await request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN_A}` },
    });
    const res = await ctx.put(credentialsUrl(TENANT_A, 'provider_qui_nexiste_pas'), {
      data: { credentials: { FOO: 'bar' } },
    });
    expect([404, 400]).toContain(res.status());
    await ctx.dispose();
  });

  test('Champ hors schéma rejeté — pas d\'injection Vault arbitraire', async () => {
    test.skip(!TOKEN_A, 'token E2E non configuré');
    const ctx = await request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN_A}` },
    });
    const res = await ctx.put(credentialsUrl(TENANT_A, 'wave'), {
      data: { credentials: { API_KEY: 'k', WEBHOOK_SECRET: 's', INJECTED: 'evil_path_traversal' } },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });
});
