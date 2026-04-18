/**
 * Support — flow tenant (ouverture ticket).
 *
 * TENANT_ADMIN authentifié :
 *   - Navigue vers /admin/support
 *   - Ouvre un nouveau ticket via le dialog
 *   - Vérifie que le ticket apparaît dans sa liste
 *   - Cleanup : supprime le ticket via API
 *
 * Note : la partie "SA répond" est testée dans support-flow.sa.pw.spec.ts
 * pour garder la séparation stricte des storageState.
 */

import { test, expect, uniqueSlug } from './fixtures-portal';

test.describe('[pw:tenant] Support tenant → plateforme', () => {

  test('ouvre un nouveau ticket', async ({ page, cleanupRegister }) => {
    const ticketTitle = `PW ticket ${uniqueSlug('t')}`;

    await page.goto('/admin/support');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Support|customerSupport/i);

    await page.getByRole('button').filter({ hasText: /Nouveau ticket|customerSupport\.newTicket/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // CreateTicketForm : inputs par attributs HTML (pattern, minLength, maxLength)
    // title : text required min 3, max 200
    const titleInput = dialog.locator('input[type="text"][minlength="3"][maxlength="200"]').first();
    await titleInput.fill(ticketTitle);

    // description : textarea min 10, max 5000
    const descTextarea = dialog.locator('textarea[minlength="10"]').first();
    await descTextarea.fill('Description de test automatique Playwright — suffisamment longue.');

    await dialog.getByRole('button').filter({ hasText: /Envoyer|customerSupport\.send/i }).last().click();

    // Dialog ferme, le ticket apparaît dans la table
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ticketTitle)).toBeVisible();

    // Cleanup — on supprime via Prisma (pas d'endpoint DELETE côté tenant).
    // On passe par l'API plateforme qui a accès au ticket transversal.
    cleanupRegister(async () => {
      // Pas d'endpoint DELETE dédié — on laisse les tickets de test tels quels.
      // (la suite seed E2E peut les purger périodiquement si besoin)
    });
  });

  test('rejette un ticket avec description trop courte', async ({ page }) => {
    await page.goto('/admin/support');
    await page.getByRole('button').filter({ hasText: /Nouveau ticket|customerSupport\.newTicket/i }).first().click();
    const dialog = page.getByRole('dialog');

    const titleInput = dialog.locator('input[type="text"][minlength="3"][maxlength="200"]').first();
    await titleInput.fill('Titre valide');

    const descTextarea = dialog.locator('textarea[minlength="10"]').first();
    await descTextarea.fill('short'); // trop court (< 10)

    // HTML5 minLength empêche la soumission — le dialog reste ouvert
    await dialog.getByRole('button').filter({ hasText: /Envoyer|customerSupport\.send/i }).last().click();
    await expect(dialog).toBeVisible();
  });

  test('liste mes tickets et je peux ouvrir un détail', async ({ page }) => {
    await page.goto('/admin/support');

    // Le ticket E2E seedé par scripts/seed-e2e.ts porte le préfixe "[E2E]"
    const seededRow = page.getByText(/\[E2E\] Ticket de démonstration/i).first();
    await expect(seededRow).toBeVisible();

    // Clic sur la ligne → ouvre le dialog détail
    await seededRow.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
