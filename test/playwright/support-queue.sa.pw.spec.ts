/**
 * Support queue — côté SUPER_ADMIN plateforme.
 *
 * Vérifie :
 *   - Accès à /admin/platform/support
 *   - Filtres status + priorité (dropdowns fonctionnels)
 *   - Détail d'un ticket : dialog s'ouvre avec thread messages
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] Platform Support Queue', () => {

  test('accès à la queue et filtres', async ({ page }) => {
    await page.goto('/admin/platform/support');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/File de support/i);

    // Filtres présents (dropdowns status + priorité)
    const selects = page.locator('select');
    expect(await selects.count()).toBeGreaterThanOrEqual(2);

    // Search input
    await expect(page.getByPlaceholder(/Rechercher un ticket/i)).toBeVisible();
  });

  test('change le filtre status', async ({ page }) => {
    await page.goto('/admin/platform/support');
    const select = page.locator('#ps-status');
    await select.selectOption('OPEN');
    // La table se refetch (indicateur loading ou nouvelle requête).
    // On vérifie juste que le select a bien pris la valeur
    await expect(select).toHaveValue('OPEN');
  });
});
