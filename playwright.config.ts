/**
 * Playwright config — E2E tests TransLog Pro
 *
 * Profils :
 *   - api              : HTTP direct contre localhost:3000 avec Host header
 *                        manipulé (tests impersonation / multi-tenant signin).
 *                        Ne nécessite PAS mkcert/dnsmasq/Caddy.
 *   - browser          : browser réel contre https://{slug}.translog.test —
 *                        setup local complet requis (mkcert + dnsmasq + Caddy).
 *                        Activé par PLAYWRIGHT_BROWSER=1.
 *   - setup            : global setup — seed E2E users + login → storageState.
 *   - super-admin      : tests navigateur authentifiés en SUPER_ADMIN.
 *   - tenant-admin     : tests navigateur authentifiés en TENANT_ADMIN.
 *   - public           : tests navigateur non-authentifiés (login page, redirects).
 *
 * Pré-requis pour la suite browser-portal :
 *   - `./scripts/dev.sh` up (Vite :5173, Nest :3000, Postgres :5434 seedés)
 *   - `npm run test:pw` pour exécuter la suite portail plateforme
 *
 * Conventions de nommage :
 *   - *.api.spec.ts       → project 'api'     (existant)
 *   - *.browser.spec.ts   → project 'browser' (existant, opt-in)
 *   - *.setup.pw.ts       → project 'setup'   (new — auth helpers)
 *   - *.sa.pw.spec.ts     → project 'super-admin'
 *   - *.tenant.pw.spec.ts → project 'tenant-admin'
 *   - *.public.pw.spec.ts → project 'public'
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const runBrowserTests = process.env.PLAYWRIGHT_BROWSER === '1';
const IS_CI           = !!process.env.CI;

// Base domain pour les sous-domaines tenants (DOIT correspondre à la config
// backend HostConfigService — défaut 'translog.test').
const BASE_DOMAIN = process.env.PW_BASE_DOMAIN ?? 'translog.test';

// Les URLs de navigation utilisent les sous-domaines (admin + tenant slugs)
// résolus localement via `--host-resolver-rules` sur Chromium — pas besoin
// de toucher /etc/hosts pour les tenants E2E dynamiques.
const BASE_URL     = process.env.PW_BASE_URL ?? `http://admin.${BASE_DOMAIN}:5173`;
// Tenant E2E = `trans-express` (pré-provisionné par dev.sh + /etc/hosts).
// Si besoin de changer : override via PW_TENANT_URL.
const TENANT_URL   = process.env.PW_TENANT_URL ?? `http://trans-express.${BASE_DOMAIN}:5173`;
const API_URL      = process.env.API_URL ?? 'http://localhost:3000';

// ─── Storage state paths (écrits par global-setup.ts) ────────────────────────
export const STORAGE_PATHS = {
  superAdmin:  path.resolve(__dirname, 'test/playwright/.auth/super-admin.json'),
  tenantAdmin: path.resolve(__dirname, 'test/playwright/.auth/tenant-admin.json'),
};

export default defineConfig({
  testDir: './test/playwright',
  timeout: 30_000,
  expect:  { timeout: 5_000 },
  fullyParallel: false,  // Les tests créent des tenants — éviter les collisions
  workers: 1,            // serial — l'API en watch-mode peut lâcher en concurrence
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'test/playwright/.report', open: 'never' }],
  ],

  use: {
    baseURL:           BASE_URL,
    trace:             'retain-on-failure',
    screenshot:        'only-on-failure',
    video:             'retain-on-failure',
    ignoreHTTPSErrors: true,
    locale:            'fr-FR',
    timezoneId:        'Europe/Paris',
  },

  // Les suites browser-portal ont besoin du setup (seed + login via API).
  // Les suites *.api.spec.ts n'en ont pas besoin — elles s'auth elles-mêmes.
  globalSetup: require.resolve('./test/playwright/global-setup.ts'),

  projects: [
    // ── Existants ────────────────────────────────────────────────────────
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      // API profile utilise l'API directement, pas Vite
      use: { baseURL: API_URL },
    },
    ...(runBrowserTests ? [{
      name: 'browser',
      testMatch: /.*\.browser\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    }] : []),

    // ── Portail plateforme (navigateur, auth pré-chargée) ────────────────
    {
      name: 'setup',
      testMatch: /.*\.setup\.pw\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'super-admin',
      testMatch: /.*\.sa\.pw\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL:      BASE_URL,
        storageState: STORAGE_PATHS.superAdmin,
        // Mappe *.translog.test → 127.0.0.1 sans toucher /etc/hosts
        launchOptions: {
          args: [`--host-resolver-rules=MAP *.${BASE_DOMAIN} 127.0.0.1, MAP ${BASE_DOMAIN} 127.0.0.1`],
        },
      },
      dependencies: ['setup'],
    },
    {
      name: 'tenant-admin',
      testMatch: /.*\.tenant\.pw\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL:      TENANT_URL,
        storageState: STORAGE_PATHS.tenantAdmin,
        launchOptions: {
          args: [`--host-resolver-rules=MAP *.${BASE_DOMAIN} 127.0.0.1, MAP ${BASE_DOMAIN} 127.0.0.1`],
        },
      },
      dependencies: ['setup'],
    },
    {
      name: 'public',
      testMatch: /.*\.public\.pw\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        launchOptions: {
          args: [`--host-resolver-rules=MAP *.${BASE_DOMAIN} 127.0.0.1, MAP ${BASE_DOMAIN} 127.0.0.1`],
        },
      },
    },
  ],

  metadata: { apiUrl: API_URL, baseUrl: BASE_URL },
});
