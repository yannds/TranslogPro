/**
 * saas-journey.public.pw.spec.ts — parcours E2E complet du portail SaaS.
 *
 * Couvre le chemin critique d'un nouveau prospect jusqu'à l'espace tenant
 * opérationnel, pour les deux activités principales :
 *
 *   • TICKETING (défaut) : brand → agency → station → route      → team
 *   • PARCELS            : brand → agency → station → parcel-info → team
 *
 * Étapes communes :
 *   1. Landing apex (http://translog.test:5173/)
 *   2. Clic CTA → /signup (wizard 3 étapes)
 *   3. POST /api/public/signup → création tenant + admin + plan trial
 *   4. Redirection vers {slug}.translog.test/login
 *   5. Sign-in API + pose du cookie sur le sous-domaine tenant
 *   6. /onboarding (wizard 5 étapes, 4e étape selon activity)
 *   7. POST /onboarding/complete → /welcome
 *
 * Projet 'public' : pas de storageState pré-chargé. Le test gère son auth
 * manuellement (signup UI + sign-in API → cookie → navigation).
 *
 * Nettoyage : cleanupRegister supprime le tenant créé en fin via
 * scripts/cleanup-e2e-tenants.ts (idempotent).
 */
import { test, expect, uniqueSlug } from './fixtures-portal';
import type { APIRequestContext, Page } from '@playwright/test';
import { deleteTenantBySlug } from '../../scripts/cleanup-e2e-tenants';

const BASE_DOMAIN = process.env.PW_BASE_DOMAIN ?? 'translog.test';
const APEX_URL    = `http://${BASE_DOMAIN}:5173`;
const PW_PASSWORD = 'Passw0rd!E2E';

type Activity = 'TICKETING' | 'PARCELS';

interface SignupInput {
  slug:        string;
  adminEmail:  string;
  adminName:   string;
  companyName: string;
  activity:    Activity;
}

test.describe('[pw:public] Parcours SaaS complet (landing → welcome)', () => {

  test('TICKETING — landing → signup → onboarding (brand/agency/station/route/team) → welcome', async ({ page, apiRequest, cleanupRegister }) => {
    const input = buildSignupInput('TICKETING');
    cleanupRegister(() => deleteTenantBySlug(input.slug).then(() => undefined));

    const pageErrors = attachErrorCapture(page);

    await landingToSignup(page);
    await signupWizard(page, input);
    await loginAndReachOnboarding(page, apiRequest, input);

    await onboardingStepBrand(page, input);
    await onboardingStepAgency(page);
    await onboardingStepStation(page);

    // Branche TICKETING : étape 4 = route
    await test.step('Onboarding step 4 — route (TICKETING)', async () => {
      await page.locator('#route-dest-name').fill('Destination E2E');
      await page.locator('#route-dest-city').fill('Pointe-Noire');
      await page.locator('#route-price').fill('15000');
      await page.locator('#route-distance').fill('500');
      await clickSaveAndContinue(page);
      await expect(page.locator('#inv-email-0')).toBeVisible({ timeout: 10_000 });
    });

    await onboardingStepTeamSkipToWelcome(page);
    await verifyOnboardingPersisted(page, input);

    expect(pageErrors, `Erreurs JS non-capturées : ${pageErrors.join(' | ')}`).toEqual([]);
  });

  test('PARCELS — landing → signup → onboarding (brand/agency/station/parcel/team) → welcome', async ({ page, apiRequest, cleanupRegister }) => {
    const input = buildSignupInput('PARCELS');
    cleanupRegister(() => deleteTenantBySlug(input.slug).then(() => undefined));

    const pageErrors = attachErrorCapture(page);

    await landingToSignup(page);
    await signupWizard(page, input);
    await loginAndReachOnboarding(page, apiRequest, input);

    await onboardingStepBrand(page, input);
    await onboardingStepAgency(page);
    await onboardingStepStation(page);

    // Branche PARCELS : étape 4 = parcel-info (écran info-only, pas d'API)
    await test.step('Onboarding step 4 — parcel info (PARCELS)', async () => {
      // Le StepParcelInfo rend un encart d'info + bouton primaire "Continuer"
      // (onPrimary=onSaved) qui est un <button type="button">, pas submit.
      await expect(page.getByText(/💡/)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Continuer|Continue/i }).last().click();
      await expect(page.locator('#inv-email-0')).toBeVisible({ timeout: 10_000 });
    });

    await onboardingStepTeamSkipToWelcome(page);
    await verifyOnboardingPersisted(page, input);

    expect(pageErrors, `Erreurs JS non-capturées : ${pageErrors.join(' | ')}`).toEqual([]);
  });
});

// ─── Helpers : data & setup ──────────────────────────────────────────────────

function buildSignupInput(activity: Activity): SignupInput {
  const slug = uniqueSlug('pw-saas');
  return {
    slug,
    adminEmail:  `admin-${slug}@e2e.local`,
    adminName:   `E2E Journey Admin ${activity}`,
    companyName: `E2E Journey ${slug.toUpperCase()}`,
    activity,
  };
}

function attachErrorCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

// ─── Helpers : parcours signup (UI) ──────────────────────────────────────────

async function landingToSignup(page: Page): Promise<void> {
  await test.step('Landing + navigation vers /signup', async () => {
    const res = await page.goto(APEX_URL + '/', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    const ctaLinks = page.locator('a[href="/signup"]');
    await expect(ctaLinks.first()).toBeVisible();
    await ctaLinks.first().click();
    await page.waitForURL(/\/signup/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}

async function signupWizard(page: Page, input: SignupInput): Promise<void> {
  await test.step('Signup step 1 — admin', async () => {
    await page.locator('#admin-name').fill(input.adminName);
    await page.locator('#admin-email').fill(input.adminEmail);
    await page.locator('#admin-password').fill(PW_PASSWORD);
    await page.getByRole('button', { name: /Continuer|Continue/ }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5_000 });
  });

  await test.step(`Signup step 2 — company (activity=${input.activity})`, async () => {
    await page.locator('#company-name').fill(input.companyName);

    // Le slug est auto-dérivé → on le force à notre valeur unique
    const slugInput = page.locator('#company-slug');
    await slugInput.click();
    await slugInput.fill('');
    await slugInput.fill(input.slug);

    // Sélection activité — radio caché, on clique le label du radio correspondant
    if (input.activity !== 'TICKETING') {
      // Le label est un <label>, qui contient un <input type="radio" name="activity">.
      // On clique l'input directement via sa value pour fiabiliser.
      await page.locator(`input[type="radio"][name="activity"][value="${input.activity}"]`).click({ force: true });
    }

    const planReq = page.waitForResponse(r => r.url().includes('/api/public/plans'), { timeout: 15_000 });
    await page.getByRole('button', { name: /Continuer|Continue/ }).click();
    await planReq;
    await expect(page.locator('button[aria-pressed]').first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Signup step 3 — plan + submit', async () => {
    await page.locator('button[aria-pressed]').first().click();
    await expect(page.locator('button[aria-pressed="true"]').first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Créer mon compte|Create my account/ }).click();
    await expect(
      page.getByRole('heading', { name: /Bienvenue dans TransLog Pro|Welcome to TransLog Pro/ })
    ).toBeVisible({ timeout: 15_000 });
  });
}

// ─── Helpers : auth cross-subdomain + accès onboarding ──────────────────────

async function loginAndReachOnboarding(
  page:       Page,
  apiRequest: APIRequestContext,
  input:      SignupInput,
): Promise<void> {
  await test.step('Sign-in API + pose cookie tenant', async () => {
    const signin = await apiRequest.post('/api/auth/sign-in', {
      headers: { Host: `${input.slug}.${BASE_DOMAIN}` },
      data:    { email: input.adminEmail, password: PW_PASSWORD },
    });
    expect(signin.ok(), `sign-in HTTP ${signin.status()}`).toBeTruthy();

    const state   = await apiRequest.storageState();
    const session = state.cookies.find(c => c.name === 'translog_session');
    expect(session, 'cookie translog_session manquant').toBeTruthy();

    await page.context().addCookies([{
      name:     'translog_session',
      value:    session!.value,
      domain:   `${input.slug}.${BASE_DOMAIN}`,
      path:     '/',
      httpOnly: true,
      secure:   false,
      sameSite: 'Lax',
    }]);
  });

  await test.step('Accès tenant → redirect /onboarding', async () => {
    const tenantUrl = `http://${input.slug}.${BASE_DOMAIN}:5173`;
    await page.goto(tenantUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Configurons votre espace|Let's configure/i })).toBeVisible({ timeout: 10_000 });
  });
}

// ─── Helpers : étapes onboarding communes ────────────────────────────────────

async function onboardingStepBrand(page: Page, input: SignupInput): Promise<void> {
  await test.step('Onboarding step 1 — brand', async () => {
    await page.locator('#brand-name').fill(`${input.companyName} — Brand`);
    await clickSaveAndContinue(page);
    await expect(page.locator('#agency-name')).toBeVisible({ timeout: 10_000 });
  });
}

async function onboardingStepAgency(page: Page): Promise<void> {
  await test.step('Onboarding step 2 — agency', async () => {
    await page.locator('#agency-name').fill('Siège E2E');
    await clickSaveAndContinue(page);
    await expect(page.locator('#station-name')).toBeVisible({ timeout: 10_000 });
  });
}

async function onboardingStepStation(page: Page): Promise<void> {
  await test.step('Onboarding step 3 — station', async () => {
    await page.locator('#station-name').fill('Gare E2E Test');
    await page.locator('#station-city').fill('Brazzaville');
    await clickSaveAndContinue(page);
  });
}

async function onboardingStepTeamSkipToWelcome(page: Page): Promise<void> {
  await test.step('Onboarding step 5 — team skip → /welcome', async () => {
    // "Plus tard" = skip team + finish (onSkip=finish sur StepTeam)
    await page.getByRole('button', { name: /Plus tard|Later|Passer/i }).first().click();
    await page.waitForURL(/\/welcome/, { timeout: 15_000 });
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
  });
}

async function verifyOnboardingPersisted(page: Page, input: SignupInput): Promise<void> {
  await test.step('Reload ne re-déclenche pas le wizard', async () => {
    const tenantUrl = `http://${input.slug}.${BASE_DOMAIN}:5173`;
    await page.goto(tenantUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/admin/, { timeout: 10_000 });
    expect(page.url()).not.toContain('/onboarding');
  });
}

async function clickSaveAndContinue(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Enregistrer et continuer|Save and continue|Continuer|Continue/ }).first().click();
}
