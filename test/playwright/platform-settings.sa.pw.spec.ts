/**
 * Settings plateforme — CRUD PlatformConfig via UI, SUPER_ADMIN.
 *
 * Vérifie :
 *   - Page affiche au moins les groupes Health + Billing
 *   - Input change, badge "modifié" apparaît
 *   - Save fonctionne (badge "Enregistré")
 *   - Reset (per-key) remet au default
 */

import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] Platform Settings — PlatformConfig', () => {

  test.afterEach(async ({ apiRequest }) => {
    // Cleanup : reset les clés potentiellement modifiées
    await apiRequest.delete('/api/platform/config/health.riskThreshold').catch(() => {});
  });

  test('affiche le titre et les groupes Health / Billing', async ({ page }) => {
    await page.goto('/admin/platform/settings');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Paramètres plateforme/i);

    // Attendre qu'au moins un groupe (h2 dans une région) soit rendu — la page
    // fetch PlatformConfig en async. Puis compter les h2 des groupes présents.
    await expect(page.getByRole('heading', { level: 2, name: /Score de santé/i })).toBeVisible({ timeout: 10_000 });
    const groupHeadings = page.getByRole('heading', { level: 2 });
    // Au moins 2 groupes attendus sur le registre par défaut (Health + Billing).
    expect(await groupHeadings.count()).toBeGreaterThanOrEqual(2);
  });

  test('modifie riskThreshold → badge "modifié" + save OK', async ({ page }) => {
    await page.goto('/admin/platform/settings');

    const input = page.locator('#cfg-input-health\\.riskThreshold');
    await expect(input).toBeVisible();

    // Incrément relatif (ne suppose aucune valeur initiale précise)
    const before = Number(await input.inputValue());
    const target = (before === 60 ? 72 : 60).toString();

    await input.fill(target);

    // Badge "modifié" apparaît (au moins 1)
    await expect(page.getByText(/modifié/i).first()).toBeVisible();

    // Clic Enregistrer
    await page.getByRole('button', { name: /Enregistrer$/i }).click();

    // Feedback "Enregistré" — badge live-region (role="status" ou span à proximité
    // du bouton Save). On cible le PREMIER match pour éviter les collisions
    // avec les help-texts qui contiennent le mot "enregistré" (ex: "aucune vente
    // n'a été enregistrée"). `.first()` suffit car le badge est en haut de la page.
    await expect(page.getByText(/Enregistré/i).first()).toBeVisible({ timeout: 5_000 });

    // Recharger la page → la valeur doit persister
    await page.reload();
    await expect(page.locator('#cfg-input-health\\.riskThreshold')).toHaveValue(target);
  });

  test('reset d\'une clé la remet au défaut', async ({ page }) => {
    // Pré-condition : pose une valeur non-default via l'UI (plus fiable que
    // l'API qui nécessite Host header spécifique).
    await page.goto('/admin/platform/settings');

    const input = page.locator('#cfg-input-health\\.riskThreshold');
    await input.fill('88');
    await page.getByRole('button').filter({ hasText: /Enregistrer|saveAll|platformConfig/i }).first().click();
    await page.waitForTimeout(1500); // laisser le save se terminer

    // Reload → vérifie que 88 est persisté
    await page.reload();
    await expect(input).toHaveValue('88');

    // Clic sur le bouton "Réinitialiser"
    const resetBtn = page.getByRole('button').filter({ hasText: /Réinitialiser|reset|platformConfig\.reset/i }).first();
    await resetBtn.click();

    // La valeur revient à 60 (default) — tolère un délai pour le refetch
    await expect(input).toHaveValue('60', { timeout: 10_000 });
  });
});
