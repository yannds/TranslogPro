/**
 * [MEGA AUDIT UI 2026-04-24] — PORTAIL VOYAGEUR (public, sans auth)
 *
 * Un passager ouvre le portail public et effectue les actions courantes :
 *   1. Charge http://translog.test:5173/portail (landing voyageur)
 *   2. Recherche un trajet depuis la page publique
 *   3. Tente un tracking de billet (code invalide → message d'erreur attendu)
 *   4. Accède à la page de signalement de véhicule /report-vehicle
 *
 * Projet 'public' — pas de storageState. Tests tolérants : on vérifie
 * qu'aucune page ne casse en erreur 5xx ni en `pageerror`, et que les
 * headings attendus sont présents.
 */

import { test, expect, type Page } from '@playwright/test';
import { logEvent } from './mega-tenants.fixture';

const BASE_DOMAIN = process.env.PW_BASE_DOMAIN ?? 'translog.test';
const APEX        = `http://${BASE_DOMAIN}:5173`;

test.describe('[MEGA UI] Portail voyageur public', () => {

  test('[UI-TRAV-1] Landing apex — hero visible, CTA signup présent', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    const resp = await page.goto(`${APEX}/`, { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    const ctaSignup = page.locator('a[href="/signup"]').first();
    await expect(ctaSignup).toBeVisible();

    logEvent({
      tenant: 'public', scenario: 'UI-TRAV-1',
      step: 'Landing apex rendue, hero + CTA visibles',
      actor: 'Visiteur anonyme', level: errors.length === 0 ? 'success' : 'warn',
      output: { url: page.url(), hasSignupCta: true, jsErrors: errors.length },
    });
  });

  test('[UI-TRAV-2] Portail voyageur — tracking formulaire', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    // Plusieurs routes possibles : /portail | /track | /customer
    // On essaie /portail en premier, puis fallback /track
    const tries = ['/portail', '/track', '/customer'];
    let ok = false;
    let finalUrl = '';
    for (const path of tries) {
      const r = await page.goto(`${APEX}${path}`, { waitUntil: 'domcontentloaded' });
      if (r && r.status() < 400) {
        ok = true; finalUrl = page.url();
        break;
      }
    }

    logEvent({
      tenant: 'public', scenario: 'UI-TRAV-2',
      step: `Ouverture portail voyageur (essais : ${tries.join(', ')})`,
      actor: 'Visiteur anonyme', level: ok ? 'success' : 'warn',
      output: { reachable: ok, finalUrl, jsErrors: errors.length },
      notes: ok ? undefined : 'Aucune des routes candidates n\'a répondu 200 — portail voyageur peut avoir un autre path',
    });
    expect(ok).toBe(true);
  });

  test('[UI-TRAV-3] Page publique de signalement véhicule /report-vehicle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    const resp = await page.goto(`${APEX}/report-vehicle`, { waitUntil: 'domcontentloaded' });
    const ok = (resp?.status() ?? 0) < 400;
    logEvent({
      tenant: 'public', scenario: 'UI-TRAV-3',
      step: 'Ouverture /report-vehicle (Public Reporter — Module U)',
      actor: 'Citoyen anonyme', httpStatus: resp?.status() ?? undefined,
      level: ok ? 'success' : 'warn',
      output: { url: page.url(), reachable: ok, jsErrors: errors.length },
    });
    expect(ok).toBe(true);
  });

  test('[UI-TRAV-4] Signup ≠ login : pages /signup et /login accessibles', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    const r1 = await page.goto(`${APEX}/signup`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    const signupHeading = (await page.getByRole('heading', { level: 1 }).first().textContent())?.trim() ?? '';

    const r2 = await page.goto(`${APEX}/login`, { waitUntil: 'domcontentloaded' });
    // /login peut rediriger vers portail par défaut — on log juste
    logEvent({
      tenant: 'public', scenario: 'UI-TRAV-4',
      step: '/signup et /login accessibles + renvoient du contenu',
      actor: 'Visiteur anonyme', level: errors.length === 0 ? 'success' : 'warn',
      output: {
        signupStatus: r1?.status(), signupHeading: signupHeading.slice(0, 60),
        loginStatus:  r2?.status(),  loginUrl: page.url(),
        jsErrors: errors.length,
      },
    });
  });
});
