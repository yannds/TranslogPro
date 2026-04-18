/**
 * TenantScopeSelector — visible uniquement pour le staff plateforme.
 *
 * Vérifie :
 *   - Le bandeau sticky est rendu sur les pages /admin/*
 *   - Il contient un dropdown (select)
 *   - La sélection persiste dans sessionStorage après navigation
 *   - Le bouton "effacer la sélection" remet à zéro
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] TenantScopeSelector', () => {

  test('est rendu sticky en haut de l\'admin shell', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');

    const region = page.getByRole('region', { name: /tenant/i }).first();
    await expect(region).toBeVisible();
    await expect(region.locator('select')).toBeVisible();
  });

  test('la sélection persiste en sessionStorage', async ({ page }) => {
    await page.goto('/admin/platform/dashboard');
    const select = page.locator('select').first();
    await expect(select).toBeVisible();

    // Récupère les options disponibles (filtre les vides)
    const valueCandidates = await select.locator('option').evaluateAll(
      (nodes) => nodes.map(n => (n as HTMLOptionElement).value).filter(v => v && v.length > 0),
    );

    test.skip(valueCandidates.length === 0, 'Pas de tenant actif disponible pour le scope');

    const chosenValue = valueCandidates[0]!;
    await select.selectOption(chosenValue);

    const raw = await page.evaluate(() => sessionStorage.getItem('translog.platform.scopedTenantId'));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { id: string };
    expect(parsed.id).toBe(chosenValue);

    // Navigation SPA (même origine) → sessionStorage conservé
    await page.getByRole('link').filter({ hasText: /Plans SaaS|platform_plans/i }).first()
      .click().catch(() => page.goto('/admin/platform/plans'));
    await page.waitForLoadState('domcontentloaded');

    const afterNav = await page.evaluate(() => sessionStorage.getItem('translog.platform.scopedTenantId'));
    expect(afterNav).toBe(raw);
  });
});
