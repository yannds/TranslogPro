/**
 * Dashboard plateforme — SUPER_ADMIN authentifié.
 *
 * Vérifie :
 *   - Redirect depuis / vers /admin/platform/dashboard (HomeRedirect)
 *   - Titre et section Growth visibles
 *   - KPI cards présentes (total tenants, MRR, DAU…)
 *   - Section quick actions (liens Plans / Billing / Support / Settings)
 *   - Bandeau TenantScopeSelector visible (user plateforme)
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] Platform Dashboard', () => {

  test('/ redirige le SA vers /admin/platform/dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/admin\/platform\/dashboard/);
  });

  test('affiche le titre et les sections principales', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');

    // Titre i18n FR — doit résoudre via I18nProvider (fallback fr.ts garanti)
    await expect(page.getByRole('heading', { level: 1 }))
      .toContainText(/Tableau de bord plateforme/i);

    // Badge rôle
    await expect(page.getByText('SUPER_ADMIN').first()).toBeVisible();

    // Au moins une section via aria-labelledby
    const sections = page.locator('section[aria-labelledby]');
    await expect(sections.first()).toBeVisible();
    expect(await sections.count()).toBeGreaterThan(2);
  });

  test('affiche les KPI cards Growth (Tenants / MRR / Churn)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    await expect(page.getByText(/Tenants/i).first()).toBeVisible();
    await expect(page.getByText(/MRR/i)).toBeVisible();
    await expect(page.getByText(/Churn/i)).toBeVisible();
  });

  test('affiche les quick actions (Plans / Billing / Settings)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    await expect(page.getByRole('link', { name: /Plans SaaS/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Facturation/i }).first()).toBeVisible();
  });

  test('TenantScopeSelector est visible pour le staff plateforme', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    // Region sticky en haut de l'admin shell
    await expect(page.getByRole('region', { name: /tenant/i }).first()).toBeVisible();
  });

  test('navigation sidebar vers /platform/plans', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    // Item nav (sidebar) — on clique sur le lien "Plans SaaS"
    await page.getByRole('link', { name: /Plans SaaS/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/platform\/plans/);
  });
});
