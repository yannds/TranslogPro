/**
 * Plans SaaS — CRUD via UI, SUPER_ADMIN.
 *
 * Flow :
 *   1. SA navigue vers /admin/platform/plans
 *   2. Crée un plan via le dialog (slug unique)
 *   3. Vérifie qu'il apparaît dans le DataTable
 *   4. Soft-delete via l'action row (ou réel si aucun tenant rattaché)
 *   5. Cleanup DB via apiRequest au cas où (idempotent)
 */

import { test, expect, uniqueSlug } from './fixtures-portal';
import { deletePlanBySlug } from '../../scripts/cleanup-e2e-tenants';

test.describe('[pw:sa] Platform Plans — CRUD', () => {

  test('liste se charge avec au moins la table (vide ou non)', async ({ page }) => {
    await page.goto('/admin/platform/plans');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Plans SaaS/i);
    // Search input de DataTableMaster
    await expect(page.getByPlaceholder(/Rechercher/i).first()).toBeVisible();
  });

  test('crée un nouveau plan via le dialog', async ({ page, cleanupRegister }) => {
    const slug = uniqueSlug('pw-pln');

    await page.goto('/admin/platform/plans');
    await page.getByRole('button').filter({ hasText: /Nouveau plan|platformPlans\.newPlan/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // PlanForm n'a pas d'IDs explicites — on cible par attributs HTML
    // (pattern, type, maxLength) pour rester robuste aux labels i18n non résolus.
    const slugInput = dialog.locator('input[pattern="[a-z0-9-]+"]').first();
    await slugInput.fill(slug);

    const nameInput = dialog.locator('input[type="text"][maxlength="128"]').first();
    await nameInput.fill('PW Test Plan');

    const priceInput = dialog.locator('input[type="number"]').first();
    await priceInput.fill('49.99');

    const currencyInput = dialog.locator('input[pattern="[A-Z]{3}"]').first();
    await currencyInput.fill('EUR');

    // Cycle de facturation = select avec option MONTHLY
    const cycleSelect = dialog.locator('select').first();
    await cycleSelect.selectOption('MONTHLY');

    // Bouton Créer — soit "Créer" (FR), soit la clé brute
    await dialog.getByRole('button').filter({ hasText: /Créer$|Create$|common\.create/i }).first().click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // refetch() après handleCreate est async. On recherche d'abord le slug via
    // la barre de recherche DataTableMaster pour éviter un potentiel problème
    // de pagination/scroll (le slug peut être sur une page suivante). Si
    // l'UI filtre côté client, cela force la visibilité peu importe l'ordre.
    const search = page.getByPlaceholder(/Rechercher/i).first();
    await search.fill(slug);
    await expect(page.getByText(slug)).toBeVisible({ timeout: 10_000 });

    // Cleanup direct DB — l'ancienne version passait par apiRequest.delete()
    // mais l'APIRequestContext de la fixture n'est pas authentifié (401 silencieux),
    // ce qui laissait des plans orphelins s'accumuler.
    cleanupRegister(() => deletePlanBySlug(slug).then(() => undefined));
  });

  test('rejette un slug invalide (UI validation)', async ({ page }) => {
    await page.goto('/admin/platform/plans');
    await page.getByRole('button').filter({ hasText: /Nouveau plan|platformPlans\.newPlan/i }).first().click();

    const dialog = page.getByRole('dialog');
    const slugInput = dialog.locator('input[pattern="[a-z0-9-]+"]').first();
    await slugInput.fill('Not_A_Kebab');
    const slugValue = await slugInput.inputValue();
    // L'input force onChange lowercase + filter non-[a-z0-9-]
    expect(slugValue).not.toMatch(/[A-Z_]/);
  });

  test('recherche dans la table filtre les résultats', async ({ page }) => {
    await page.goto('/admin/platform/plans');
    const search = page.getByPlaceholder(/Rechercher/i).first();
    await search.fill('zzzz-pas-present-zzzz');
    // Empty state
    await expect(page.getByText(/Aucun plan|empty/i).first()).toBeVisible();
  });
});
