/**
 * Fixtures Playwright pour les tests du portail plateforme.
 *
 * Exporte un `test` custom qui accepte :
 *   - page déjà authentifiée (via storageState du project)
 *   - apiRequest : APIRequestContext pointé sur l'API Nest (pour setup/cleanup)
 *   - seedCleanup : helper pour supprimer les entités créées pendant le test
 *
 * Les tests d'écriture (plans, tickets, config) doivent nettoyer leurs traces
 * en DB pour rester idempotents. On ne dépend pas de `afterAll` strict car
 * Playwright isole chaque test — chaque test s'auto-nettoie via la fixture.
 */

import { test as base, APIRequestContext, request as pwRequest } from '@playwright/test';

const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';

interface PortalFixtures {
  apiRequest: APIRequestContext;
  // Callback enregistré par le test pour rollback en fin (DELETE d'un plan créé, etc.)
  cleanupRegister: (fn: () => Promise<void>) => void;
}

export const test = base.extend<PortalFixtures>({
  apiRequest: async ({}, use) => {
    const ctx = await pwRequest.newContext({
      baseURL:           API_URL,
      ignoreHTTPSErrors: true,
    });
    await use(ctx);
    await ctx.dispose();
  },

  cleanupRegister: async ({}, use) => {
    const cleanups: Array<() => Promise<void>> = [];
    await use((fn) => cleanups.push(fn));
    for (const fn of cleanups.reverse()) {
      try { await fn(); } catch (e) { console.warn('[pw cleanup] ', e); }
    }
  },
});

export const expect = test.expect;

/**
 * Helper pour générer un slug unique par run — évite les collisions quand
 * plusieurs tests parallèles créent des plans ou tenants.
 */
export function uniqueSlug(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${ts}-${rand}`;
}
