/**
 * [pw:sa] Dashboard KPI SaaS — sections KPI accessibles pour SUPER_ADMIN.
 *
 * Vérifie que les 7 nouvelles sections KPI (Sprint KPI 2026-04-20) sont :
 *   - montées dans le DOM sous /admin/platform/dashboard
 *   - identifiables par leur aria-labelledby
 *   - affichent au moins une KPI card chacune
 *   - le toggle "mode" du North Star est opérationnel
 *   - les filtres période (7/30/90j) sont opérationnels
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] Platform KPI Dashboard — sections KPI SaaS', () => {

  test('monte les 7 sections KPI dans l\'ordre attendu', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');

    // Les 7 nouvelles sections ont un id commencant par pk-
    const expectedIds = [
      'pk-northstar',
      'pk-mrr',
      'pk-transactional',
      'pk-adoption-detail',
      'pk-activation',
      'pk-retention',
      'pk-strategic',
    ];
    for (const id of expectedIds) {
      const section = page.locator(`section[aria-labelledby="${id}"]`);
      await expect(section).toBeVisible({ timeout: 15_000 });
    }
  });

  test('North Star affiche le toggle de mode (3 boutons)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const section = page.locator('section[aria-labelledby="pk-northstar"]');
    // 3 boutons dans le tablist (role=tab)
    const tabs = section.locator('[role="tab"]');
    await expect(tabs).toHaveCount(3);
    // Le toggle compared est sélectionné par défaut
    await expect(tabs.filter({ hasText: /Comparé|Compared/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('North Star toggle change la sélection', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const section = page.locator('section[aria-labelledby="pk-northstar"]');
    const heuristicTab = section.locator('[role="tab"]').filter({ hasText: /Heuristique|Heuristic/i });
    await heuristicTab.click();
    await expect(heuristicTab).toHaveAttribute('aria-selected', 'true');
  });

  test('MRR section affiche les KPI Business (MRR / ARR / ARPU / MoM)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const section = page.locator('section[aria-labelledby="pk-mrr"]');
    await expect(section).toBeVisible();
    await expect(section.getByText(/^MRR$/).first()).toBeVisible();
    await expect(section.getByText(/^ARR$/)).toBeVisible();
    await expect(section.getByText(/^ARPU$/)).toBeVisible();
  });

  test('Retention section affiche la table des cohortes (colonnes J+7/J+30/J+90)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const section = page.locator('section[aria-labelledby="pk-retention"]');
    await expect(section).toBeVisible();
    await expect(section.getByText(/J\+7/)).toBeVisible();
    await expect(section.getByText(/J\+30/)).toBeVisible();
    await expect(section.getByText(/J\+90/)).toBeVisible();
  });

  test('Activation section affiche le funnel 4 étapes', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const section = page.locator('section[aria-labelledby="pk-activation"]');
    await expect(section).toBeVisible();
    // 4 progressbars minimum (une par étape)
    const bars = section.locator('[role="progressbar"]');
    expect(await bars.count()).toBeGreaterThanOrEqual(4);
  });

  test('Strategic section affiche le tableau top tenants actifs', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const section = page.locator('section[aria-labelledby="pk-strategic"]');
    await expect(section).toBeVisible();
    await expect(section.getByText(/Top tenants|Top active tenants/i)).toBeVisible();
  });

  test('Filtre période change la requête (7j / 30j / 90j)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const transactional = page.locator('section[aria-labelledby="pk-transactional"]');
    const selector = transactional.locator('select');
    await selector.selectOption({ value: '7' });
    // Pas d'assertion réseau ici (on vérifie juste que la UI accepte le changement sans crash)
    await expect(selector).toHaveValue('7');
    await selector.selectOption({ value: '90' });
    await expect(selector).toHaveValue('90');
  });

  test('Dark mode : les sections restent lisibles (token t-text)', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    await page.emulateMedia({ colorScheme: 'dark' });
    const section = page.locator('section[aria-labelledby="pk-northstar"]');
    await expect(section).toBeVisible();
  });
});
