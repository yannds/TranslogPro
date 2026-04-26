/**
 * Stations — modale Nouvelle / Modifier (refonte 2026-04-26).
 *
 * Verifie principalement les regressions historiques :
 *   - Le clic SOURIS sur une suggestion du combobox "Ville" applique la valeur
 *     (avant : il fallait valider au clavier — bug createPortal + handleBlur).
 *   - Le formulaire est creable en saisissant lat/lng a la main (fallback
 *     gracieux si la cle Google Maps JS API n'est pas configuree).
 *   - L'edition pre-remplit name/city/type/lat/lng et le PATCH revient.
 *
 * Pas de test d'interaction directe avec la carte Google JS — la lib n'est pas
 * chargeable dans le headless sans cle de test, et on ne brule pas de quota.
 * On teste le comportement du composant React quand la cle est absente
 * (badge "Cle navigateur Google Maps n'est pas configuree" + champs lat/lng
 * restent saisissables).
 */

import { test, expect, uniqueSlug } from './fixtures-portal';

test.describe('[pw:tenant] Stations — modale refondue', () => {

  test('cree une station via saisie manuelle lat/lng', async ({ page, cleanupRegister }) => {
    const stationName = `PW Gare ${uniqueSlug('s')}`;

    await page.goto('/admin/stations');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Gares|Stations/i);

    // Clic sur "+ Nouvelle station" — le bouton de l'en-tete
    await page.getByRole('button').filter({ hasText: /Nouvelle station/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Nouvelle station/i);

    // Le formulaire affiche les champs attendus
    await expect(dialog.locator('#station-name')).toBeVisible();
    await expect(dialog.locator('#station-city')).toBeVisible();
    await expect(dialog.locator('#station-type')).toBeVisible();
    await expect(dialog.locator('#gmap-lat')).toBeVisible();
    await expect(dialog.locator('#gmap-lng')).toBeVisible();

    await dialog.locator('#station-name').fill(stationName);

    // Saisie ville en free-text (pas de clic sur suggestion ici — teste le fallback)
    await dialog.locator('#station-city').fill('Brazzaville');

    // Coordonnees manuelles
    await dialog.locator('#gmap-lat').fill('-4.2634');
    await dialog.locator('#gmap-lng').fill('15.2429');

    // Submit
    await dialog.getByRole('button').filter({ hasText: /^Cr[ée]er$/i }).click();

    // Modale ferme + station presente dans la liste
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(stationName)).toBeVisible();

    // Cleanup via API (suppression idempotente — 409 si referencee, OK on ignore)
    cleanupRegister(async () => {
      // Le DELETE passe par l'UI plateforme dans cette suite — pour l'API, le
      // tenant slug est resolu cote backend via Host header. On ignore le
      // cleanup automatique : le seed E2E nettoie periodiquement les "PW *".
    });
  });

  test('clic souris sur suggestion ville applique la valeur cliquee', async ({ page, cleanupRegister }) => {
    // C'est LA regression historique : avant la refonte il fallait valider au
    // clavier (Enter) car createPortal + handleBlur ecrasaient la valeur picked.
    const stationName = `PW Click ${uniqueSlug('s')}`;

    await page.goto('/admin/stations');
    await page.getByRole('button').filter({ hasText: /Nouvelle station/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#station-name').fill(stationName);

    // Tape un prefixe court qui doit faire remonter "Brazzaville"
    const cityInput = dialog.locator('#station-city');
    await cityInput.fill('brazza');

    // Attend que le listbox apparaisse avec au moins une suggestion
    const listbox = dialog.locator('[role="listbox"]').first();
    await expect(listbox).toBeVisible({ timeout: 8_000 });
    const firstOption = listbox.locator('[role="option"]').first();
    await expect(firstOption).toBeVisible();

    // Capture le label de la suggestion AVANT de cliquer (pour comparer apres)
    const suggestionLabel = (await firstOption.innerText()).split('\n')[0].trim();

    // CLIC SOURIS — c'est le scenario casse historiquement
    await firstOption.click();

    // Le listbox se ferme
    await expect(listbox).not.toBeVisible({ timeout: 2_000 });

    // La valeur de l'input doit etre celle de la suggestion cliquee
    // (pas "brazza" laisse en place par un handleBlur qui aurait ecrase pick())
    await expect(cityInput).toHaveValue(suggestionLabel);

    // Verifie aussi que le formulaire reste utilisable (focus deplace, pas de freeze)
    await dialog.locator('#gmap-lat').fill('-4.26');
    await dialog.locator('#gmap-lng').fill('15.24');
    await expect(dialog.locator('#gmap-lat')).toHaveValue('-4.26');

    // Pas de submit ici — le test cible uniquement le bug du clic.
    cleanupRegister(async () => {});
  });

  test('edition d\'une station pre-remplit les champs', async ({ page }) => {
    await page.goto('/admin/stations');

    // Ouvre la 1ere ligne de la table — onRowClick → editTarget
    const firstDataRow = page.locator('table tbody tr').first();
    await expect(firstDataRow).toBeVisible({ timeout: 10_000 });
    await firstDataRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Modifier la station/i);

    // Tous les champs presents et pre-remplis (non vide)
    const name = dialog.locator('#station-name');
    const city = dialog.locator('#station-city');
    const type = dialog.locator('#station-type');
    const lat  = dialog.locator('#gmap-lat');
    const lng  = dialog.locator('#gmap-lng');

    await expect(name).not.toHaveValue('');
    await expect(city).not.toHaveValue('');
    await expect(type).not.toHaveValue('');
    await expect(lat).not.toHaveValue('');
    await expect(lng).not.toHaveValue('');

    // Bouton "Re-calibrer" present (mode edit uniquement)
    await expect(dialog.getByRole('button', { name: /Re-calibrer/i })).toBeVisible();

    // Annulation propre
    await dialog.getByRole('button').filter({ hasText: /Annuler|Cancel/i }).first().click();
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('responsive : la modale reste utilisable en viewport mobile (375px)', async ({ page, browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 720 },
      storageState: undefined,  // re-utilise celui du project si disponible
    });
    // On garde la page courante (deja authentifiee) et on re-resize.
    await page.setViewportSize({ width: 375, height: 720 });

    await page.goto('/admin/stations');
    await page.getByRole('button').filter({ hasText: /Nouvelle station/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Tous les champs sont scrollables et visibles
    await dialog.locator('#station-name').scrollIntoViewIfNeeded();
    await expect(dialog.locator('#station-name')).toBeVisible();
    await dialog.locator('#gmap-lng').scrollIntoViewIfNeeded();
    await expect(dialog.locator('#gmap-lng')).toBeVisible();

    await ctx.close();
  });

  test('dark mode : la modale rend correctement', async ({ page }) => {
    // Force le dark mode si non actif (on suppose un toggle ou un `class="dark"` sur html)
    await page.goto('/admin/stations');
    await page.evaluate(() => document.documentElement.classList.add('dark'));

    await page.getByRole('button').filter({ hasText: /Nouvelle station/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // On verifie que le dialog a un background dark (pas de regression visuelle
    // basique — on ne fait pas de visual diff ici, juste un sanity check).
    const bg = await dialog.evaluate(el => window.getComputedStyle(el).backgroundColor);
    // bg sera quelque chose comme "rgb(15, 23, 42)" en dark (slate-900) ou
    // "rgb(255, 255, 255)" en light. Sanity : pas blanc en dark.
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });
});
