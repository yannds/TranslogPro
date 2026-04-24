/**
 * [MEGA AUDIT UI 2026-04-24] — SIGNUP 3 TENANTS VIA LE PORTAIL LANDING
 *
 * Parcours UI réel :
 *   1. http://translog.test:5173/       (landing apex, navigateur réel)
 *   2. Clic CTA → /signup                (wizard 3 étapes)
 *   3. Saisie admin + société + plan     (formulaires, radio)
 *   4. POST /api/public/signup           (déclenché par le submit)
 *   5. Redirection tenant → /login       (sous-domaine {slug}.translog.test)
 *   6. Sign-in API + cookie cross-subdomain
 *   7. /onboarding (wizard 5 étapes : brand / agency / station / route / team)
 *   8. /welcome puis /admin (dashboard)
 *
 * On le répète pour 3 personas distincts :
 *   - Mme Bouanga (Congo, fr)  — activité TICKETING
 *   - M. Diouf    (Sénégal, fr) — activité TICKETING
 *   - M. Dubois   (France, fr)  — activité PARCELS
 *
 * Chaque spec loggue ses étapes dans scenario-events.jsonl pour le rapport.
 */

import { test, expect, uniqueSlug } from '../fixtures-portal';
import type { APIRequestContext, Page } from '@playwright/test';
import { deleteTenantBySlug } from '../../../scripts/cleanup-e2e-tenants';
import { logEvent } from './mega-tenants.fixture';

const BASE_DOMAIN = process.env.PW_BASE_DOMAIN ?? 'translog.test';
const APEX_URL    = `http://${BASE_DOMAIN}:5173`;
const PW_PASSWORD = 'MegaUi!2026';

type Activity = 'TICKETING' | 'PARCELS';

interface SignupInput {
  logKey:      string;               // "congo" | "sahel" | "atlas"
  slug:        string;
  adminEmail:  string;
  adminName:   string;
  companyName: string;
  city:        string;
  activity:    Activity;
}

test.describe('[MEGA UI] Signup 3 tenants via le landing public', () => {

  test('👤 Congo — Mme Bouanga crée "Congo Express UI" (TICKETING)', async ({ page, apiRequest, cleanupRegister }) => {
    const input: SignupInput = {
      logKey: 'congo-ui',
      slug: uniqueSlug('mui-congo'),
      adminEmail: `admin-mui-congo-${Date.now()}@mega.local`,
      adminName: 'Mme Bouanga (UI Congo)',
      companyName: 'Congo Express UI',
      city: 'Brazzaville',
      activity: 'TICKETING',
    };
    cleanupRegister(() => deleteTenantBySlug(input.slug).then(() => undefined));
    await runFullSignupFlow(page, apiRequest, input);
  });

  test('👤 Sénégal — M. Diouf crée "Sahel Transport UI" (TICKETING)', async ({ page, apiRequest, cleanupRegister }) => {
    const input: SignupInput = {
      logKey: 'sahel-ui',
      slug: uniqueSlug('mui-sahel'),
      adminEmail: `admin-mui-sahel-${Date.now()}@mega.local`,
      adminName: 'M. Diouf (UI Sénégal)',
      companyName: 'Sahel Transport UI',
      city: 'Dakar',
      activity: 'TICKETING',
    };
    cleanupRegister(() => deleteTenantBySlug(input.slug).then(() => undefined));
    await runFullSignupFlow(page, apiRequest, input);
  });

  test('👤 France — M. Dubois crée "Atlas Bus UI" (PARCELS)', async ({ page, apiRequest, cleanupRegister }) => {
    const input: SignupInput = {
      logKey: 'atlas-ui',
      slug: uniqueSlug('mui-atlas'),
      adminEmail: `admin-mui-atlas-${Date.now()}@mega.local`,
      adminName: 'M. Dubois (UI France)',
      companyName: 'Atlas Bus UI',
      city: 'Paris',
      activity: 'PARCELS',
    };
    cleanupRegister(() => deleteTenantBySlug(input.slug).then(() => undefined));
    await runFullSignupFlow(page, apiRequest, input);
  });
});

// ─── Parcours complet par persona ─────────────────────────────────────────────

async function runFullSignupFlow(
  page: Page,
  apiRequest: APIRequestContext,
  input: SignupInput,
): Promise<void> {
  logEvent({
    tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-START`,
    step: `Ouverture du navigateur sur ${APEX_URL} (persona ${input.adminName})`,
    actor: 'Nouveau prospect', level: 'info',
    entity: { kind: 'Persona', id: input.adminEmail, label: input.adminName },
  });

  // 1. Landing → signup
  await page.goto(`${APEX_URL}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-LANDING`,
    step: 'Landing apex chargée, hero visible', actor: input.adminName, level: 'success' });

  const ctaLinks = page.locator('a[href="/signup"]');
  await ctaLinks.first().click();
  await page.waitForURL(/\/signup/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-CTA`,
    step: 'Clic CTA "Essai gratuit" → redirect /signup', actor: input.adminName, level: 'success' });

  // 2. Signup wizard — step 1 (admin)
  await page.locator('#admin-name').fill(input.adminName);
  await page.locator('#admin-email').fill(input.adminEmail);
  await page.locator('#admin-password').fill(PW_PASSWORD);
  await page.getByRole('button', { name: /Continuer|Continue/ }).click();
  await expect(page.locator('#company-name')).toBeVisible({ timeout: 5_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-SIGNUP-1`,
    step: 'Wizard step 1 : identité admin saisie',
    actor: input.adminName, level: 'success',
    output: { name: input.adminName, email: input.adminEmail, passwordLen: PW_PASSWORD.length },
  });

  // 3. Signup wizard — step 2 (company + activity)
  await page.locator('#company-name').fill(input.companyName);
  const slugInput = page.locator('#company-slug');
  await slugInput.click();
  await slugInput.fill('');
  await slugInput.fill(input.slug);

  if (input.activity !== 'TICKETING') {
    await page.locator(`input[type="radio"][name="activity"][value="${input.activity}"]`).click({ force: true });
  }

  const planReq = page.waitForResponse(r => r.url().includes('/api/public/plans'), { timeout: 15_000 });
  await page.getByRole('button', { name: /Continuer|Continue/ }).click();
  await planReq;
  await expect(page.locator('button[aria-pressed]').first()).toBeVisible({ timeout: 15_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-SIGNUP-2`,
    step: `Wizard step 2 : société + activité ${input.activity}`,
    actor: input.adminName, level: 'success',
    output: { companyName: input.companyName, slug: input.slug, activity: input.activity },
  });

  // 4. Signup wizard — step 3 (plan + submit)
  await page.locator('button[aria-pressed]').first().click();
  await expect(page.locator('button[aria-pressed="true"]').first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /Créer mon compte|Create my account/ }).click();
  await expect(
    page.getByRole('heading', { name: /Bienvenue dans TransLog Pro|Welcome to TransLog Pro/ }),
  ).toBeVisible({ timeout: 15_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-SIGNUP-3`,
    step: 'Wizard step 3 : plan sélectionné + POST /signup → tenant créé',
    actor: input.adminName, level: 'success',
    notes: 'Essai 14 j activé, redirect vers écran Bienvenue',
  });

  // 5. Sign-in API + pose cookie tenant (identique au spec de ref)
  const signin = await apiRequest.post('/api/auth/sign-in', {
    headers: { Host: `${input.slug}.${BASE_DOMAIN}` },
    data:    { email: input.adminEmail, password: PW_PASSWORD },
  });
  expect(signin.ok(), `sign-in HTTP ${signin.status()}`).toBeTruthy();

  const state   = await apiRequest.storageState();
  const session = state.cookies.find(c => c.name === 'translog_session');
  expect(session).toBeTruthy();

  await page.context().addCookies([{
    name:     'translog_session',
    value:    session!.value,
    domain:   `${input.slug}.${BASE_DOMAIN}`,
    path:     '/',
    httpOnly: true,
    secure:   false,
    sameSite: 'Lax',
  }]);
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-AUTH`,
    step: 'Sign-in API + injection cookie cross-subdomain', actor: input.adminName, level: 'success' });

  // 6. Accès tenant → redirect /onboarding
  const tenantUrl = `http://${input.slug}.${BASE_DOMAIN}:5173`;
  await page.goto(tenantUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Configurons votre espace|Let's configure/i })).toBeVisible({ timeout: 10_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-REACH`,
    step: 'Redirection automatique vers /onboarding (tenant neuf)', actor: input.adminName, level: 'success' });

  // 7. Onboarding — step 1 : brand
  await page.locator('#brand-name').fill(`${input.companyName} — Identité`);
  await clickSaveAndContinue(page);
  await expect(page.locator('#agency-name')).toBeVisible({ timeout: 10_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-1`,
    step: 'Onboarding step 1 : marque renseignée', actor: input.adminName, level: 'success' });

  // Step 2 : agency
  await page.locator('#agency-name').fill(`${input.city} Siège`);
  await clickSaveAndContinue(page);
  await expect(page.locator('#station-name')).toBeVisible({ timeout: 10_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-2`,
    step: `Onboarding step 2 : agence "${input.city} Siège"`, actor: input.adminName, level: 'success' });

  // Step 3 : station
  await page.locator('#station-name').fill(`Gare ${input.city} Centrale`);
  await page.locator('#station-city').fill(input.city);
  await clickSaveAndContinue(page);
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-3`,
    step: `Onboarding step 3 : station "Gare ${input.city} Centrale"`, actor: input.adminName, level: 'success' });

  // Step 4 : route ou parcel-info selon activité
  if (input.activity === 'TICKETING') {
    await page.locator('#route-dest-name').fill('Destination UI Mega');
    await page.locator('#route-dest-city').fill(input.city === 'Brazzaville' ? 'Pointe-Noire' : input.city === 'Dakar' ? 'Saint-Louis' : 'Lyon');
    await page.locator('#route-price').fill('15000');
    await page.locator('#route-distance').fill('500');
    await clickSaveAndContinue(page);
    logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-4-ROUTE`,
      step: 'Onboarding step 4 (TICKETING) : 1re route créée',
      actor: input.adminName, level: 'success' });
  } else {
    await expect(page.getByText(/💡/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Continuer|Continue/i }).last().click();
    logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-4-PARCEL`,
      step: 'Onboarding step 4 (PARCELS) : écran info validé', actor: input.adminName, level: 'success' });
  }
  await expect(page.locator('#inv-email-0')).toBeVisible({ timeout: 10_000 });

  // Step 5 : team (skip → finish)
  await page.getByRole('button', { name: /Plus tard|Later|Passer/i }).first().click();
  await page.waitForURL(/\/welcome/, { timeout: 15_000 });
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ONBOARD-WELCOME`,
    step: 'Onboarding complet → /welcome affiché', actor: input.adminName, level: 'success' });

  // 8. Reload → doit atterrir sur /admin directement
  await page.goto(tenantUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/admin/, { timeout: 10_000 });
  expect(page.url()).not.toContain('/onboarding');
  logEvent({ tenant: input.logKey, scenario: `UI-${input.logKey.toUpperCase()}-ADMIN-REACH`,
    step: 'Reload → atterrissage direct sur /admin (dashboard tenant ready)',
    actor: input.adminName, level: 'success',
    output: { url: page.url(), tenantLiveAt: tenantUrl, adminEmail: input.adminEmail },
  });
}

async function clickSaveAndContinue(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Enregistrer et continuer|Save and continue|Continuer|Continue/ }).first().click();
}
