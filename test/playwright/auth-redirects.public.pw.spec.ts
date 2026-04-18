/**
 * Redirections non-authentifiées.
 *
 * Vérifie qu'un utilisateur anonyme :
 *   - sur /admin/... est redirigé vers /login
 *   - voit la page de login
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:public] Auth redirects', () => {

  test('/ redirige vers /login quand non-authentifié', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/admin/platform/dashboard → /login', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('page de login rend le formulaire', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('textbox').first()).toBeVisible();
    // Au moins un bouton submit
    await expect(page.getByRole('button').first()).toBeVisible();
  });
});
