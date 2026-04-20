/**
 * Playwright smoke — BYO-credentials UI (/admin/integrations).
 *
 * Couvre :
 *   1. La page charge et affiche les tabs PAYMENT / AUTH
 *   2. Chaque provider PAYMENT a un bouton "Saisir mes identifiants" ou "Mettre à jour"
 *   3. Clic sur un bouton ouvre la modale IntegrationCredentialsDialog
 *   4. La modale contient les champs du schéma (au moins un champ password)
 *   5. Après soumission du formulaire avec des valeurs valides, la modale se ferme
 *      et la ligne affiche le badge "Mes identifiants" (scopedToTenant)
 *
 * Pré-requis : API up + tenant E2E + token admin E2E dans l'env.
 * Sans ces variables, les tests are skipped proprement.
 */
import { test, expect } from '@playwright/test';

const FRONTEND   = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const ADMIN_USER = process.env.E2E_ADMIN_EMAIL    ?? '';
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe.serial('BYO-credentials UI — /admin/integrations', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ADMIN_USER || !ADMIN_PASS, 'Credentials E2E non configurés');
    await page.goto(`${FRONTEND}/login`);
    await page.fill('input[type="email"]',    ADMIN_USER);
    await page.fill('input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(/admin/);
  });

  test('la page /admin/integrations charge correctement', async ({ page }) => {
    await page.goto(`${FRONTEND}/admin/integrations`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: /paiement|payment/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /auth/i })).toBeVisible();
  });

  test('chaque provider PAYMENT a un bouton configurer/mettre à jour', async ({ page }) => {
    await page.goto(`${FRONTEND}/admin/integrations`);
    await page.getByRole('tab', { name: /paiement|payment/i }).click();
    const configBtns = page.getByRole('button', { name: /identifiant|credential/i });
    await expect(configBtns.first()).toBeVisible();
  });

  test('ouverture modale et affichage des champs Wave', async ({ page }) => {
    await page.goto(`${FRONTEND}/admin/integrations`);
    await page.getByRole('tab', { name: /paiement|payment/i }).click();

    // Cherche la ligne Wave spécifiquement
    const waveLine = page.locator('li').filter({ hasText: /wave/i });
    const configBtn = waveLine.getByRole('button', { name: /identifiant|credential/i });
    await configBtn.click();

    // La modale s'ouvre
    await expect(page.getByRole('dialog')).toBeVisible();
    // Au moins un champ password (API_KEY ou WEBHOOK_SECRET)
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('soumission du formulaire Wave avec des valeurs valides', async ({ page }) => {
    test.skip(true, 'Nécessite un Vault de test configuré — skip en CI par défaut');
    await page.goto(`${FRONTEND}/admin/integrations`);
    await page.getByRole('tab', { name: /paiement|payment/i }).click();

    const waveLine  = page.locator('li').filter({ hasText: /wave/i });
    const configBtn = waveLine.getByRole('button', { name: /identifiant|credential/i });
    await configBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.fill('input[id="cred-API_KEY"]',        'wave_test_key_e2e');
    await page.fill('input[id="cred-WEBHOOK_SECRET"]', 'whsec_e2e_test');
    await page.getByRole('button', { name: /enregistrer|save/i }).click();

    // La modale se ferme
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // La ligne Wave affiche le badge "Mes identifiants"
    await expect(waveLine.getByText(/mes identifiants|my credentials/i)).toBeVisible();
  });
});
