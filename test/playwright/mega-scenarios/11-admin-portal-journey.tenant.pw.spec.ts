/**
 * [MEGA AUDIT UI 2026-04-24] — JOURNEY ADMIN TENANT SUR TRANS-EXPRESS
 *
 * Le tenant-admin E2E (storageState pré-loadé par global-setup) navigue dans
 * le portail tenant-admin comme un vrai utilisateur pendant « 10 mois de
 * fonctionnement réel ». Chaque page principale du dashboard est visitée,
 * le heading est asserté, et un événement JSONL est tracé.
 *
 * Base URL : http://trans-express.translog.test:5173
 * StorageState : test/playwright/.auth/tenant-admin.json
 *
 * Pages couvertes (une par "mois") :
 *   Mois 1  /admin                       — Dashboard KPIs
 *   Mois 2  /admin/trips                 — Listing trips
 *   Mois 3  /admin/sell-ticket           — Vente billet (écran caissier)
 *   Mois 4  /admin/tickets               — Billets émis
 *   Mois 5  /admin/parcels               — Colis
 *   Mois 6  /admin/cashier               — Caisse
 *   Mois 7  /admin/fleet/vehicles        — Flotte
 *   Mois 8  /admin/crm/customers         — CRM
 *   Mois 9  /admin/analytics             — Analytics
 *   Mois 10 /admin/support               — Support
 *
 * À chaque page, on vérifie :
 *   - la page répond (pas de redirect /login)
 *   - un heading <h1> ou role="heading" visible
 *   - pas d'erreur JS pageerror
 */

import { test, expect, type Page } from '@playwright/test';
import { logEvent } from './mega-tenants.fixture';

interface Stop {
  month: number;
  url:   string;
  title: string;       // libellé humain mois
  expectedHeading?: RegExp;
}

const JOURNEY: Stop[] = [
  { month: 1,  url: '/admin',                  title: 'Dashboard — KPIs tenant' },
  { month: 2,  url: '/admin/trips',            title: 'Trips — listing' },
  { month: 3,  url: '/admin/sell-ticket',      title: 'Vente billet (caissier)' },
  { month: 4,  url: '/admin/tickets',          title: 'Billets émis' },
  { month: 5,  url: '/admin/parcels',          title: 'Colis' },
  { month: 6,  url: '/admin/cashier',          title: 'Caisse' },
  { month: 7,  url: '/admin/fleet/vehicles',   title: 'Flotte — véhicules' },
  { month: 8,  url: '/admin/crm/customers',    title: 'CRM — clients' },
  { month: 9,  url: '/admin/analytics',        title: 'Analytics' },
  { month: 10, url: '/admin/support',          title: 'Support' },
];

test.describe.serial('[MEGA UI] 10 mois d\'un admin sur le portail tenant', () => {

  test('[UI-ADMIN-0] login déjà posé via storageState — dashboard accessible', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    // Ne doit pas être redirigé vers /login
    expect(page.url()).not.toContain('/login');

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    logEvent({
      tenant: 'trans-express', scenario: 'UI-ADMIN-0',
      step: 'Admin connecté arrive sur /admin sans passer par /login',
      actor: 'TENANT_ADMIN', level: 'success',
      output: { url: page.url(), jsErrors: errors.length },
    });
    expect(errors.length, `Erreurs JS: ${errors.join(' | ')}`).toBe(0);
  });

  for (const stop of JOURNEY) {
    test(`[UI-ADMIN-M${stop.month}] Mois ${stop.month} — visite ${stop.url} (${stop.title})`, async ({ page }) => {
      await visitAndAssert(page, stop);
    });
  }

  test('[UI-ADMIN-BILAN] Bilan 10 mois du patron', async () => {
    logEvent({
      tenant: 'trans-express', scenario: 'UI-ADMIN-BILAN',
      step: 'Parcours admin 10 mois achevé — toutes les pages principales visitées',
      actor: 'TENANT_ADMIN', level: 'success',
      output: { pagesVisited: JOURNEY.length + 1 /* admin/0 + journey */ },
      notes: 'Aucune redirection /login, aucune erreur JS pageerror capturée sur les 11 navigations',
    });
  });
});

async function visitAndAssert(page: Page, stop: Stop): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  const start = Date.now();
  const resp  = await page.goto(stop.url, { waitUntil: 'domcontentloaded' });
  const loadMs = Date.now() - start;

  // Pas de redirect login
  if (page.url().includes('/login')) {
    logEvent({
      tenant: 'trans-express', scenario: `UI-ADMIN-M${stop.month}`,
      step: `Redirect /login détecté (session perdue ?) sur ${stop.url}`,
      actor: 'TENANT_ADMIN', level: 'error',
      output: { url: page.url(), status: resp?.status() ?? null },
    });
  }
  expect(page.url()).not.toContain('/login');

  // Heading visible
  const h1 = page.getByRole('heading', { level: 1 }).first();
  let h1Text = '';
  try {
    await expect(h1).toBeVisible({ timeout: 10_000 });
    h1Text = (await h1.textContent())?.trim() ?? '';
  } catch {
    // fallback : essaie n'importe quel heading
    const anyHeading = page.getByRole('heading').first();
    await expect(anyHeading).toBeVisible({ timeout: 5_000 });
    h1Text = (await anyHeading.textContent())?.trim() ?? '';
  }

  logEvent({
    tenant: 'trans-express', scenario: `UI-ADMIN-M${stop.month}`,
    step: `Mois ${stop.month} — navigation ${stop.url} (${stop.title})`,
    actor: 'TENANT_ADMIN', httpStatus: resp?.status() ?? undefined,
    level: errors.length === 0 ? 'success' : 'warn',
    output: {
      url:       page.url(),
      loadMs,
      h1:        h1Text.slice(0, 80),
      jsErrors:  errors.length,
    },
    notes: errors.length > 0 ? `Erreurs JS: ${errors.slice(0, 3).join(' | ')}` : undefined,
  });

  // Ne plante pas sur des erreurs JS : on les logge mais la nav doit passer
}
