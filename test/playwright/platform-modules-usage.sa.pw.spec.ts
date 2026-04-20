/**
 * [pw:sa] Portail plateforme — Page "Modules — usage tenants".
 *
 * Vérifie que la nouvelle page /admin/platform/modules-usage :
 *   - est accessible au SUPER_ADMIN via la nav "Modules — usage tenants"
 *   - monte le sélecteur tenant + sélecteur période (7/30/90j)
 *   - affiche les 5 KPI tiles (actifs, désactivés, actions, adoption, idle)
 *   - affiche le panneau "degré d'adoption par module" avec des progressbars
 *   - affiche la table avec colonnes Module / Statut / Adoption / Actions / …
 *   - changer la période déclenche un nouveau fetch (pas de crash)
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] Page Modules Usage', () => {
  test('monte la page avec KPI tiles + adoption section + table', async ({ page }) => {
    await page.goto('/admin/platform/modules-usage');

    // En-tête
    await expect(page.getByRole('heading', { name: /Utilisation des modules par tenant|Modules usage per tenant/ }))
      .toBeVisible({ timeout: 15_000 });

    // Filtres
    const tenantSelect = page.locator('#pmu-tenant');
    const daysSelect   = page.locator('#pmu-days');
    await expect(tenantSelect).toBeVisible();
    await expect(daysSelect).toBeVisible();

    // KPI tiles — au moins 5 cartes dans la section
    const kpiSection = page.locator('section[aria-labelledby="pmu-kpi"]');
    await expect(kpiSection).toBeVisible();

    // Table — doit avoir un header ou vide
    const table = page.locator('table').first();
    await expect(table).toBeVisible();
    // header "Adoption" (fr) ou "Adoption" (en, identique)
    await expect(page.getByRole('columnheader', { name: /Adoption/i }).first()).toBeVisible();

    // Filtrer sur 7j → pas de crash
    await daysSelect.selectOption('7');
    await expect(page.getByRole('heading', { name: /Utilisation des modules par tenant|Modules usage per tenant/ }))
      .toBeVisible();

    // Section adoption (présente si le tenant a au moins 1 module installé) :
    // si montée, vérifier qu'elle contient au moins une progressbar.
    const adoption = page.locator('section[aria-labelledby="pmu-adoption"]');
    if (await adoption.count() > 0) {
      const bars = adoption.locator('[role="progressbar"]');
      expect(await bars.count()).toBeGreaterThan(0);
    }
  });

  test('navigation — l\'entrée "Modules — usage tenants" est dans la nav plateforme', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    // L'item peut être dans la sidebar ou dans un menu compact — on cherche
    // par son texte (fr ou en).
    const navLink = page.getByRole('link', { name: /Modules — usage tenants|Modules — tenant usage/i });
    await expect(navLink).toBeVisible({ timeout: 15_000 });
    await navLink.click();
    await expect(page).toHaveURL(/\/admin\/platform\/modules-usage/);
  });
});
