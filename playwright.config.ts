/**
 * Playwright config — E2E tests TransLog Pro multi-tenant.
 *
 * 2 profils :
 *   - api     : HTTP direct contre localhost:3000 avec Host header manipulé.
 *               Ne nécessite PAS mkcert/dnsmasq/Caddy — idéal en CI rapide.
 *   - browser : browser réel contre https://{slug}.translog.test — nécessite
 *               le setup local complet (mkcert + dnsmasq + Caddy). Activé par
 *               la variable d'env PLAYWRIGHT_BROWSER=1.
 */

import { defineConfig, devices } from '@playwright/test';

const runBrowserTests = process.env.PLAYWRIGHT_BROWSER === '1';

export default defineConfig({
  testDir: './test/playwright',
  timeout: 30_000,
  expect:  { timeout: 5_000 },
  fullyParallel: false,  // Les tests créent des tenants — éviter les collisions
  workers: 1,            // serial — l'API en watch-mode peut lâcher en concurrence
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],

  use: {
    // Par défaut on parle à l'API locale sur :3000. Les tests manipulent
    // eux-mêmes le header Host pour simuler les sous-domaines.
    baseURL: process.env.API_URL ?? 'http://localhost:3000',
    trace:   'retain-on-failure',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
    },
    ...(runBrowserTests ? [{
      name: 'browser',
      testMatch: /.*\.browser\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    }] : []),
  ],
});
