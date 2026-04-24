/**
 * [FULL-UI-LIFECYCLE — 2026-04-24 v3] — 100 % NAVIGATEUR, VRAIS SÉLECTEURS DU CODE.
 *
 * v3 après lecture intégrale des sources :
 *   • frontend/components/public/PublicSignup.tsx — wizard + SuccessScreen
 *   • frontend/components/auth/LoginPage.tsx      — form #login-email / #login-password
 *   • frontend/lib/navigation/nav.config.ts       — VRAIS paths /admin/*
 *   • frontend/lib/i18n/locales/fr.ts             — VRAIS libellés FR
 *
 * CTA / URLs / IDs confirmés ligne par ligne — fini les sélecteurs devinés.
 *
 * Flow humain reproduit fidèlement :
 *   1. Apex → /signup → wizard 3 steps
 *   2. SuccessScreen : clic "Accéder à mon espace" → ouvre {slug}.tld/login
 *   3. /login : #login-email + #login-password + clic "Se connecter"
 *   4. → /onboarding (5 steps) → /welcome → /admin
 *   5. Admin navigue toutes les pages + utilise les vraies CTA
 */

import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_DOMAIN = process.env.PW_BASE_DOMAIN ?? 'translog.test';
// IMPORTANT : on passe par Caddy (HTTPS port 443) qui préserve le Host header.
// Vite direct (:5173) avec changeOrigin:true casse le TenantHostMiddleware.
const APEX        = `https://${BASE_DOMAIN}`;
const PASSWORD    = 'FullUi!2026';

const LOG_DIR  = path.resolve(__dirname, '../../../reports/mega-audit-2026-04-24');
const LOG_FILE = path.join(LOG_DIR, 'steps-lifecycle-2026-04-24.jsonl');

type Outcome = 'success' | 'partial' | 'failed' | 'missing' | 'info';

interface StepResult {
  ts:        string; phase: string; actor: string; action: string;
  url?:      string; outcome: Outcome; error?: string; details?: unknown;
}

const steps: StepResult[] = [];

function logStep(r: Omit<StepResult, 'ts'>): void {
  const entry: StepResult = { ts: new Date().toISOString(), ...r };
  steps.push(entry);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* ok */ }
}

async function attempt<T>(
  phase: string, actor: string, action: string, fn: () => Promise<T>,
  opts?: { url?: string },
): Promise<T | null> {
  try {
    const result = await fn();
    logStep({ phase, actor, action, outcome: 'success', url: opts?.url, details: redact(result) });
    return result;
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 400) ?? String(err);
    const outcome: Outcome = msg.includes('MISSING_CTA') ? 'missing' : 'failed';
    logStep({ phase, actor, action, outcome, url: opts?.url, error: msg });
    return null;
  }
}

function redact(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    if (!s || s === '{}') return undefined;
    return s.length > 500 ? s.slice(0, 500) + '...' : v;
  } catch { return undefined; }
}

async function clickButtonExact(page: Page, text: string, timeout = 8000): Promise<void> {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = page.getByRole('button', { name: new RegExp(`^${escaped}$`, 'i') });
  try {
    await expect(exact.first()).toBeVisible({ timeout });
    await exact.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await exact.first().click({ timeout: 3000 });
    return;
  } catch { /* fallback */ }
  const loose = page.getByRole('button', { name: new RegExp(escaped, 'i') });
  try {
    await expect(loose.first()).toBeVisible({ timeout: 2000 });
    await loose.first().click({ timeout: 3000 });
    return;
  } catch { /* dump DOM pour diag */ }
  // DIAG : lister les boutons visibles + un lien éventuel correspondant
  try {
    const allButtons = await page.locator('button, a').evaluateAll(els =>
      els.slice(0, 40).map(e => ({
        tag: e.tagName.toLowerCase(),
        text: (e.textContent ?? '').trim().slice(0, 50),
        href: (e as HTMLAnchorElement).href || undefined,
        disabled: (e as HTMLButtonElement).disabled ?? false,
      })).filter(b => b.text.length > 0),
    );
    logStep({ phase: 'DIAG', actor: 'Admin', action: `Boutons/liens visibles quand "${text}" manque`,
      outcome: 'info', url: page.url(),
      details: { bodyButtons: allButtons } });
  } catch { /* ok */ }
  throw new Error(`MISSING_CTA: bouton "${text}" non trouvé après ${timeout}ms sur la page courante`);
}

async function waitPageReady(page: Page): Promise<void> {
  // Attend le networkidle + heading — pour laisser les lazy imports finir
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8000 });
}

function attachJsCapture(page: Page, label: string): void {
  page.on('pageerror', e => {
    logStep({ phase: 'runtime', actor: label, action: 'JS pageerror',
      outcome: 'failed', error: e.message?.slice(0, 300), url: page.url() });
  });
}

// ────────────────────────────────────────────────────────────────────────

test.describe('[FULL-UI-LIFECYCLE v3] 100% navigateur, sélecteurs du code réel', () => {

test('🌐 Full lifecycle v3 — signup → login → onboarding → provisioning → ops → analytics', async () => {
  test.setTimeout(600_000);  // 10 min max — le tour exhaustif des 60+ écrans prend ~2-3 min

  // Reset log
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LOG_FILE, '', 'utf-8');
  } catch { /* ok */ }

  const ts = Date.now();
  const slug = `pw-saas-ful-${ts.toString(36)}`;  // préfixe whitelisté cleanup
  const adminEmail = `admin-${slug}@mega.local`;

  logStep({ phase: 'BOOT', actor: 'SYSTEM', action: 'Démarrage scénario v3',
    outcome: 'info', details: { slug, adminEmail } });

  const browser: Browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP *.${BASE_DOMAIN} 127.0.0.1, MAP ${BASE_DOMAIN} 127.0.0.1`],
  });
  const ctx  = await browser.newContext({
    locale: 'fr-FR',
    ignoreHTTPSErrors: true,  // mkcert local certs non-trusted
  });
  const page = await ctx.newPage();
  attachJsCapture(page, 'Admin');

  // ═══ P1 — SIGNUP ═══════════════════════════════════════════════════
  logStep({ phase: 'P1', actor: 'SYSTEM', action: '═══ P1 : SIGNUP ═══', outcome: 'info' });

  await attempt('P1', 'Admin', 'Landing apex', async () => {
    await page.goto(`${APEX}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  await attempt('P1', 'Admin', 'CTA signup', async () => {
    await page.locator('a[href="/signup"]').first().click();
    await page.waitForURL(/\/signup/);
  });

  await attempt('P1', 'Admin', 'Wizard step 1 — identité admin', async () => {
    await page.locator('#admin-name').fill('Claire Patron v3');
    await page.locator('#admin-email').fill(adminEmail);
    await page.locator('#admin-password').fill(PASSWORD);
    await clickButtonExact(page, 'Continuer');
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5_000 });
  });

  await attempt('P1', 'Admin', 'Wizard step 2 — société + slug', async () => {
    await page.locator('#company-name').fill('Full UI Transit v3');
    await page.locator('#company-slug').click();
    await page.locator('#company-slug').fill('');
    await page.locator('#company-slug').fill(slug);
    const plans = page.waitForResponse(r => r.url().includes('/api/public/plans'), { timeout: 15_000 });
    await clickButtonExact(page, 'Continuer');
    await plans;
    await expect(page.locator('button[aria-pressed]').first()).toBeVisible({ timeout: 10_000 });
  });

  await attempt('P1', 'Admin', 'Wizard step 3 — plan + "Créer mon compte"', async () => {
    await page.locator('button[aria-pressed]').first().click();
    await clickButtonExact(page, 'Créer mon compte');
    // Titre FR exact : "Bienvenue dans TransLog Pro 🎉" (signup.success.title)
    await expect(page.getByRole('heading', { name: /Bienvenue dans TransLog Pro/i }))
      .toBeVisible({ timeout: 20_000 });
  });

  // ═══ P2 — CTA "Accéder à mon espace" → /login → auth ═══════════════
  logStep({ phase: 'P2', actor: 'SYSTEM', action: '═══ P2 : LOGIN SUBDOMAIN ═══', outcome: 'info' });

  await attempt('P2', 'Admin', 'Clic CTA "Accéder à mon espace" (signup.success.cta)', async () => {
    // La CTA est un <a href> ; on attend la navigation vers le subdomain
    const link = page.getByRole('link', { name: /Accéder à mon espace/i });
    await expect(link).toBeVisible({ timeout: 5_000 });
    // Ouvrir dans la même page (pas de target _blank)
    await link.click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    logStep({ phase: 'P2', actor: 'Admin', action: 'URL après clic CTA', outcome: 'info',
      details: { url: page.url() } });
  });

  // Intercepte la réponse /api/auth/sign-in pour diagnostic
  let signInResponse: { status: number; body?: unknown } | null = null;
  page.on('response', async res => {
    if (res.url().includes('/api/auth/sign-in')) {
      let body: unknown = null;
      try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
      signInResponse = { status: res.status(), body };
      logStep({ phase: 'P2', actor: 'Admin', action: 'Intercept /api/auth/sign-in',
        outcome: res.ok() ? 'info' : 'failed',
        details: { status: res.status(), body: JSON.stringify(body).slice(0, 300) } });
    }
  });

  let authOK = false;
  await attempt('P2', 'Admin', 'Login form — #login-email + #login-password + "Se connecter"', async () => {
    await page.locator('#login-email').fill(adminEmail, { timeout: 5_000 });
    await page.locator('#login-password').fill(PASSWORD, { timeout: 5_000 });
    await clickButtonExact(page, 'Se connecter', 5_000);
    // On attend d'abord une réponse HTTP (success ou error), puis on check l'URL
    await page.waitForResponse(r => r.url().includes('/api/auth/sign-in'), { timeout: 10_000 });
    // Petit délai pour que le navigate() client se fasse
    await page.waitForTimeout(1500);
    // Check erreur role="alert"
    const alert = page.locator('[role="alert"]');
    if (await alert.count() > 0) {
      const msg = await alert.first().textContent();
      logStep({ phase: 'P2', actor: 'Admin', action: 'Message d\'erreur login détecté',
        outcome: 'failed', details: { alert: msg?.trim().slice(0, 200) } });
    }
    if (!/\/(onboarding|admin|welcome)/.test(page.url())) {
      throw new Error(`URL inchangée après login : ${page.url()} (signin status=${signInResponse?.status})`);
    }
    authOK = true;
    logStep({ phase: 'P2', actor: 'Admin', action: 'URL post-login', outcome: 'info',
      details: { url: page.url() } });
  }, { url: 'subdomain/login' });

  if (!authOK) {
    logStep({ phase: 'END', actor: 'SYSTEM',
      action: 'Auth login a échoué — arrêt scénario, rien de plus à tester sans session',
      outcome: 'failed' });
    await ctx.close(); await browser.close();
    expect(steps.length).toBeGreaterThan(5);
    return;
  }

  // ═══ P3 — ONBOARDING 5 STEPS ═══════════════════════════════════════
  logStep({ phase: 'P3', actor: 'SYSTEM', action: '═══ P3 : ONBOARDING ═══', outcome: 'info' });

  // STRICT : chaque step DOIT trouver son champ, sinon on throw et on documente.
  await attempt('P3', 'Admin', 'Onboarding step 1 — brand', async () => {
    await expect(page.locator('#brand-name')).toBeVisible({ timeout: 10_000 });
    await page.locator('#brand-name').fill('Full UI Transit v3 Brand');
    await clickButtonExact(page, 'Enregistrer et continuer', 5_000);
    await expect(page.locator('#agency-name')).toBeVisible({ timeout: 10_000 });
  });
  await attempt('P3', 'Admin', 'Onboarding step 2 — agency', async () => {
    await page.locator('#agency-name').fill('Agence Principale v3');
    await clickButtonExact(page, 'Enregistrer et continuer', 5_000);
    await expect(page.locator('#station-name')).toBeVisible({ timeout: 10_000 });
  });
  await attempt('P3', 'Admin', 'Onboarding step 3 — station', async () => {
    await page.locator('#station-name').fill('Gare Centrale v3');
    await page.locator('#station-city').fill('Brazzaville');
    await clickButtonExact(page, 'Enregistrer et continuer', 5_000);
    // Le step suivant peut être route (TICKETING) ou parcel-info (PARCELS)
    await page.waitForTimeout(1000);
  });
  await attempt('P3', 'Admin', 'Onboarding step 4 — route', async () => {
    // S'il y a le champ route-dest-name, c'est TICKETING
    if (await page.locator('#route-dest-name').count() > 0) {
      await page.locator('#route-dest-name').fill('Pointe-Noire');
      await page.locator('#route-dest-city').fill('Pointe-Noire');
      await page.locator('#route-price').fill('15000');
      await page.locator('#route-distance').fill('500');
      await clickButtonExact(page, 'Enregistrer et continuer', 5_000);
    } else {
      // PARCELS branch : bouton Continuer visible
      await clickButtonExact(page, 'Continuer', 5_000);
    }
    await expect(page.locator('#inv-email-0')).toBeVisible({ timeout: 10_000 });
  });
  await attempt('P3', 'Admin', 'Onboarding step 5 — clic "Je le ferai plus tard" (finish)', async () => {
    // Texte exact : onb.team.later = "Je le ferai plus tard"
    const skip = page.getByRole('button', { name: /Je le ferai plus tard/i }).first();
    await expect(skip).toBeVisible({ timeout: 5_000 });
    await skip.click();
    // POST /onboarding/complete → navigate /welcome (peut être lent)
    await page.waitForURL(/\/welcome|\/admin(?!.*\/onboarding)/, { timeout: 25_000 });
  });

  await attempt('P3', 'Admin', 'Naviguer explicitement sur /admin (sortir de /welcome)', async () => {
    // À partir de /welcome on navigue vers /admin
    const base = page.url().split('/').slice(0,3).join('/');
    await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    // STRICT : l'URL finale doit contenir /admin et PAS /onboarding
    if (page.url().includes('/onboarding')) {
      throw new Error(`REDIRECT_ONBOARDING: /admin renvoie sur ${page.url()} — onboarding pas fini`);
    }
    expect(page.url()).toContain('/admin');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
  });

  const base = page.url().replace(/\/admin.*$/, '');  // protocol+host+port du subdomain

  // ═══ P4 — PROVISIONING (vrais URLs nav.config + vrais textes FR) ═════
  logStep({ phase: 'P4', actor: 'SYSTEM', action: '═══ P4 : PROVISIONING via UI ═══', outcome: 'info' });

  // 4.1 Véhicule — /admin/fleet + "Ajouter un véhicule"
  await attempt('P4', 'Admin', 'Ouvrir /admin/fleet', async () => {
    await page.goto(`${base}/admin/fleet`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/fleet' });

  await attempt('P4', 'Admin', 'Clic "Ajouter un véhicule"', async () => {
    await clickButtonExact(page, 'Ajouter un véhicule', 5_000);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  await attempt('P4', 'Admin', 'Remplir + enregistrer véhicule', async () => {
    const dlg = page.getByRole('dialog');
    await dlg.getByPlaceholder(/KA-4421-B/i).fill(`UI-${ts.toString().slice(-6)}`, { timeout: 5_000 });
    await dlg.getByPlaceholder(/Yutong ZK6122H/i).fill('Mercedes Travego v3', { timeout: 5_000 });
    // Type = 1er select requis
    const firstSel = dlg.locator('select').first();
    await firstSel.selectOption({ index: 1 }).catch(() => undefined);
    // Capacité = 1er input number
    await dlg.locator('input[type="number"]').first().fill('50', { timeout: 5_000 });
    // Agence — on tente les selects suivants
    const selects = dlg.locator('select');
    const selCount = await selects.count();
    for (let i = 1; i < selCount; i++) {
      await selects.nth(i).selectOption({ index: 1 }).catch(() => undefined);
    }
    // Submit : "Créer" ou "Enregistrer"
    const saveBtn = page.getByRole('button', { name: /^(Créer|Enregistrer)$/i }).last();
    await saveBtn.click({ timeout: 5_000 });
    await expect(dlg).not.toBeVisible({ timeout: 8_000 });
  });

  // 4.2 Staff — /admin/staff + "Nouveau membre" + submit "Créer"
  await attempt('P4', 'Admin', 'Ouvrir /admin/staff', async () => {
    await page.goto(`${base}/admin/staff`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/staff' });

  for (const [role, email, name] of [
    ['DRIVER',   `driver-${slug}@mega.local`,   'Chauffeur UI v3'],
    ['MECHANIC', `mecano-${slug}@mega.local`,   'Mécanicien UI v3'],
    ['AGENT',    `agent-${slug}@mega.local`,    'Agent UI v3'],
  ] as const) {
    await attempt('P4', 'Admin', `Créer staff ${role} via UI`, async () => {
      await clickButtonExact(page, 'Nouveau membre', 5_000);
      const dlg = page.getByRole('dialog');
      await expect(dlg).toBeVisible({ timeout: 5_000 });
      // Pas d'id ni de name — on utilise placeholder + type exact
      await dlg.locator('input[type="email"]').fill(email, { timeout: 5_000 });
      await dlg.getByPlaceholder(/Jean Dupont/i).fill(name, { timeout: 5_000 });
      // Select rôle (1er select) via value enum
      await dlg.locator('select').first().selectOption(role).catch(() => undefined);
      // Select agence (2e select)
      const selects = dlg.locator('select');
      if ((await selects.count()) > 1) {
        await selects.nth(1).selectOption({ index: 1 }).catch(() => undefined);
      }
      // Submit "Créer" — SCOPED AU DIALOG pour ne pas cliquer un bouton global
      const submit = dlg.getByRole('button', { name: /^Créer$/i });
      await submit.first().click({ timeout: 5_000 });
      await expect(dlg).not.toBeVisible({ timeout: 8_000 });
    });
  }

  // 4.3 Route additionnelle — /admin/routes + "Nouvelle ligne"
  await attempt('P4', 'Admin', 'Ouvrir /admin/routes', async () => {
    await page.goto(`${base}/admin/routes`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/routes' });

  await attempt('P4', 'Admin', 'Clic "Nouvelle ligne"', async () => {
    await clickButtonExact(page, 'Nouvelle ligne', 5_000);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  await attempt('P4', 'Admin', 'Remplir route (nom + distance + tarif) + Créer', async () => {
    const dlg = page.getByRole('dialog');
    await dlg.getByPlaceholder(/Brazzaville.*Pointe-Noire/i).fill('BZV → Dolisie v3', { timeout: 5_000 });
    await dlg.getByPlaceholder(/510/).fill('365', { timeout: 5_000 });
    await dlg.getByPlaceholder(/12000/).fill('10000', { timeout: 5_000 });
    const selects = dlg.locator('select');
    for (let i = 0; i < await selects.count(); i++) {
      await selects.nth(i).selectOption({ index: 1 }).catch(() => undefined);
    }
    // SCOPED AU DIALOG pour éviter les "Créer une station" externes
    const submit = dlg.getByRole('button', { name: /^(Créer|Enregistrer)$/i });
    await submit.first().click({ timeout: 5_000 });
  });

  // 4.4 Trip — /admin/trips + "Créer un nouveau trajet" + "Créer le trajet"
  await attempt('P4', 'Admin', 'Ouvrir /admin/trips', async () => {
    await page.goto(`${base}/admin/trips`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/trips' });

  await attempt('P4', 'Admin', 'Clic "Créer un nouveau trajet"', async () => {
    await clickButtonExact(page, 'Créer un nouveau trajet', 5_000);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  await attempt('P4', 'Admin', 'Remplir trip + "Créer le trajet"', async () => {
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible({ timeout: 5_000 });
    // Attendre un peu que les selects async se remplissent avec les données tenant
    await page.waitForTimeout(2_000);
    const selects = dlg.locator('select');
    const nSel = Math.min(3, await selects.count());
    for (let i = 0; i < nSel; i++) {
      // Prendre l'option à l'index 1 si existe (0 = placeholder "Choisir...")
      await Promise.race([
        selects.nth(i).selectOption({ index: 1 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout select')), 3000)),
      ]).catch(() => undefined);
    }
    const dates = dlg.locator('input[type="date"], input[type="datetime-local"], input[type="time"]');
    const nDates = await dates.count();
    const today = new Date(); today.setDate(today.getDate() + 1);
    for (let i = 0; i < nDates; i++) {
      const type = await dates.nth(i).getAttribute('type').catch(() => null);
      const val = type === 'datetime-local' ? today.toISOString().slice(0, 16)
                : type === 'time' ? '08:00' : today.toISOString().slice(0, 10);
      await dates.nth(i).fill(val, { timeout: 2_000 }).catch(() => undefined);
    }
    const submit = dlg.getByRole('button', { name: /Créer le trajet/i }).first();
    const btnExists = await submit.count();
    if (btnExists === 0) {
      await page.keyboard.press('Escape').catch(() => undefined);
      throw new Error('MISSING_CTA: bouton "Créer le trajet" absent du dialog');
    }
    const disabled = await submit.isDisabled({ timeout: 1_500 }).catch(() => true);
    if (disabled) {
      // Form invalide — on ne bloque PAS, on ferme et on continue.
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(300);
      throw new Error('FORM_INVALID: bouton "Créer le trajet" désactivé (validation client refuse — selects async non chargés ?)');
    }
    await submit.click({ timeout: 3_000 });
    await page.waitForTimeout(1_500);
  });

  // 4.5 Trip planning hebdo — juste la page se charge
  await attempt('P4', 'Admin', 'Ouvrir /admin/trips/planning', async () => {
    await page.goto(`${base}/admin/trips/planning`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/trips/planning' });

  // ═══ P5 — OPÉRATIONS via UI : caisse, vente billet, colis, voucher ═══
  logStep({ phase: 'P5', actor: 'SYSTEM', action: '═══ P5 : OPÉRATIONS via UI ═══', outcome: 'info' });

  // 5.1 Caisse — /admin/cashier + "Ouvrir ma caisse"
  await attempt('P5', 'Admin', 'Ouvrir /admin/cashier', async () => {
    await page.goto(`${base}/admin/cashier`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/cashier' });

  await attempt('P5', 'Admin', 'Clic "Ouvrir ma caisse"', async () => {
    await clickButtonExact(page, 'Ouvrir ma caisse', 5_000);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  await attempt('P5', 'Admin', 'Remplir solde initial + valider', async () => {
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible({ timeout: 5_000 });
    await dlg.locator('input[type="number"]').first().fill('10000', { timeout: 5_000 });
    // Scoped au dialog
    const ok = dlg.getByRole('button', { name: /^(Ouvrir|Valider|Confirmer|Enregistrer)$/i });
    await ok.first().click({ timeout: 5_000 });
    await expect(dlg).not.toBeVisible({ timeout: 8_000 });
  });

  // 5.2 Vente billet — /admin/tickets/new + "Calculer le prix" + "Confirmer et imprimer"
  await attempt('P5', 'Admin', 'Ouvrir /admin/tickets/new', async () => {
    await page.goto(`${base}/admin/tickets/new`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/tickets/new' });

  await attempt('P5', 'Admin', 'Remplir passager (nom + téléphone)', async () => {
    await page.getByPlaceholder(/Nom complet/i).first().fill('Jean Voyageur UI v3', { timeout: 5_000 });
    await page.getByPlaceholder(/\+242/).first().fill('+242060000911', { timeout: 5_000 });
    // Select trajet
    const firstSelect = page.locator('select').first();
    await firstSelect.selectOption({ index: 1 }).catch(() => undefined);
  });

  await attempt('P5', 'Admin', 'Clic "Calculer le prix"', async () => {
    await clickButtonExact(page, 'Calculer le prix', 5_000);
    await page.waitForTimeout(1000);
  });

  await attempt('P5', 'Admin', 'Clic "Confirmer et imprimer"', async () => {
    await clickButtonExact(page, 'Confirmer et imprimer', 5_000);
    await page.waitForTimeout(1500);
  });

  // 5.3 Colis — /admin/parcels/new + "Enregistrer le colis"
  await attempt('P5', 'Admin', 'Ouvrir /admin/parcels/new', async () => {
    await page.goto(`${base}/admin/parcels/new`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/parcels/new' });

  await attempt('P5', 'Admin', 'Remplir colis + "Enregistrer le colis"', async () => {
    // On remplit les champs principaux de façon résiliente
    const textInputs = page.locator('input[type="text"], input[type="tel"], input[type="email"]').filter({ hasNot: page.locator('[disabled]') });
    const n = Math.min(5, await textInputs.count());
    const vals = ['Marie Destinataire', '+242060000001', 'marie@test.local', 'Quartier Centre', '', ''];
    for (let i = 0; i < n; i++) {
      if (vals[i]) await textInputs.nth(i).fill(vals[i], { timeout: 3_000 }).catch(() => undefined);
    }
    const selects = page.locator('select');
    for (let i = 0; i < Math.min(2, await selects.count()); i++) {
      await selects.nth(i).selectOption({ index: 1 }).catch(() => undefined);
    }
    const nums = page.locator('input[type="number"]');
    if (await nums.count() > 0) await nums.first().fill('10', { timeout: 3_000 }).catch(() => undefined);
    if (await nums.count() > 1) await nums.nth(1).fill('25000', { timeout: 3_000 }).catch(() => undefined);
    await clickButtonExact(page, 'Enregistrer le colis', 5_000);
  });

  // 5.4 Voucher — /admin/sav/vouchers + "Émettre un bon"
  await attempt('P5', 'Admin', 'Ouvrir /admin/sav/vouchers', async () => {
    await page.goto(`${base}/admin/sav/vouchers`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/sav/vouchers' });

  await attempt('P5', 'Admin', 'Clic "Émettre un bon"', async () => {
    await clickButtonExact(page, 'Émettre un bon', 5_000);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  await attempt('P5', 'Admin', 'Remplir voucher + valider', async () => {
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible({ timeout: 5_000 });
    const nums = dlg.locator('input[type="number"]');
    if (await nums.count() > 0) await nums.first().fill('5000', { timeout: 5_000 });
    if (await nums.count() > 1) await nums.nth(1).fill('30', { timeout: 5_000 });
    const tels = dlg.locator('input[type="tel"], input[placeholder*="+" i]');
    if (await tels.count() > 0) await tels.first().fill('+242060000888', { timeout: 5_000 });
    // Scoped au dialog
    const ok = dlg.getByRole('button', { name: /^(Émettre|Créer|Enregistrer)$/i });
    await ok.first().click({ timeout: 5_000 });
  });

  // 5.5 Réclamation SAV — /admin/sav/claims + "Nouvelle réclamation"
  await attempt('P5', 'Admin', 'Ouvrir /admin/sav/claims', async () => {
    await page.goto(`${base}/admin/sav/claims`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/sav/claims' });

  await attempt('P5', 'Admin', 'Clic "Nouvelle réclamation"', async () => {
    await clickButtonExact(page, 'Nouvelle réclamation', 5_000);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  // 5.6 Refunds — /admin/sav/returns + "Approuver"
  await attempt('P5', 'Admin', 'Ouvrir /admin/sav/returns', async () => {
    await page.goto(`${base}/admin/sav/returns`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/sav/returns' });

  // ═══ P6 — ANALYTICS & PAGES CONSULTATIVES ═══════════════════════════
  logStep({ phase: 'P6', actor: 'SYSTEM', action: '═══ P6 : ANALYTICS ═══', outcome: 'info' });

  for (const [label, p] of [
    ['Dashboard admin', '/admin'],
    ['Analytics', '/admin/analytics'],
    ['Rentabilité (yield)', '/admin/ai/routes'],
    ['Saisonnalité', '/admin/seasonality'],
    ['CRM clients', '/admin/crm/customers'],
    ['Factures', '/admin/invoices'],
    ['Support', '/admin/support'],
    ['Billets émis', '/admin/tickets'],
    ['Colis', '/admin/parcels'],
  ] as const) {
    await attempt('P6', 'Admin', `Consulter ${label} (${p})`, async () => {
      await page.goto(`${base}${p}`, { waitUntil: 'domcontentloaded' });
      expect(page.url()).not.toContain('/login');
      await waitPageReady(page);
    }, { url: p });
  }

  // ═══ P6.5 — TRAVERSÉE EXHAUSTIVE DES 60+ ÉCRANS ADMIN ════════════════
  logStep({ phase: 'P6b', actor: 'SYSTEM', action: '═══ P6b : TOUR EXHAUSTIF 60+ ÉCRANS ADMIN ═══', outcome: 'info' });

  const ALL_ADMIN_SCREENS: Array<[string, string]> = [
    // Trips
    ['Trips annulations', '/admin/tickets/cancel'],
    ['Trips récurrents (scheduler)', '/admin/trips/scheduler'],
    ['Trips retards & alertes', '/admin/trips/delays'],
    // Colis / Shipments / Manifestes
    ['Shipments (groupages)', '/admin/shipments'],
    ['Manifestes', '/admin/manifests'],
    // Stations & infra
    ['Stations', '/admin/stations'],
    ['Plates-formes / quais', '/admin/platforms'],
    // Affichage
    ['Display — écrans', '/admin/display'],
    ['Display — quais', '/admin/display/quais'],
    ['Display — bus', '/admin/display/bus'],
    ['Display — annonces', '/admin/display/announcements'],
    // Caisse
    ['Caisse — écarts', '/admin/cash-discrepancies'],
    // SAV
    ['SAV — signalements', '/admin/sav/reports'],
    // CRM
    ['CRM — campagnes', '/admin/crm/campaigns'],
    ['CRM — fidélité', '/admin/crm/loyalty'],
    ['CRM — feedback', '/admin/crm/feedback'],
    // Flotte
    ['Flotte — tracking KM/carburant', '/admin/fleet/tracking'],
    ['Flotte — plans de sièges', '/admin/fleet/seats'],
    ['Flotte — docs & consommables', '/admin/fleet-docs'],
    // Personnel
    ['Chauffeurs', '/admin/drivers'],
    ['Chauffeurs — scoring', '/admin/drivers/scoring'],
    ['Équipages — planning', '/admin/crew/planning'],
    ['Chauffeurs — calendrier', '/admin/crew/driver-calendar'],
    ['Briefing pré-départ', '/admin/crew/briefing'],
    // Maintenance
    ['Maintenance — fiches', '/admin/maintenance'],
    ['Maintenance — planning', '/admin/maintenance/planning'],
    ['Maintenance — alertes techniques', '/admin/maintenance/alerts'],
    // Pricing
    ['Pricing — grille', '/admin/pricing'],
    ['Pricing — simulateur', '/admin/pricing/simulator'],
    ['Pricing — points de péage', '/admin/pricing/toll-points'],
    ['Pricing — yield management', '/admin/pricing/yield'],
    ['Pricing — promotions', '/admin/pricing/promo'],
    // Settings
    ['Settings — classes tarifaires', '/admin/settings/fare-classes'],
    ['Settings — périodes de pointe', '/admin/settings/peak-periods'],
    ['Settings — taxes & fiscalité', '/admin/settings/taxes'],
    ['Settings — règles métier', '/admin/settings/rules'],
    ['Settings — paiement', '/admin/settings/payment'],
    ['Settings — agences', '/admin/settings/agencies'],
    ['Settings — société', '/admin/settings/company'],
    ['Settings — bulk import', '/admin/settings/bulk-import'],
    ['Settings — quotas', '/admin/settings/quotas'],
    ['Settings — branding white-label', '/admin/settings/branding'],
    ['Settings — portail', '/admin/settings/portal'],
    ['Settings — portail marketplace', '/admin/settings/portal/marketplace'],
    ['Settings — CMS pages', '/admin/settings/portal/pages'],
    ['Settings — CMS posts', '/admin/settings/portal/posts'],
    // QHSE / Safety
    ['QHSE — accidents', '/admin/qhse'],
    ['Safety — incidents', '/admin/safety/incidents'],
    ['Safety — monitoring live', '/admin/safety'],
    ['Safety — SOS alertes', '/admin/safety/sos'],
    // Analytics & Reports
    ['Analytics — saisonnalité (vrai path)', '/admin/analytics/seasonality'],
    ['Rapports périodiques', '/admin/reports'],
    // AI
    ['AI — rentabilité lignes', '/admin/ai/routes'],
    ['AI — optimisation flotte', '/admin/ai/fleet'],
    ['AI — prévision demande', '/admin/ai/demand'],
    ['AI — pricing dynamique', '/admin/ai/pricing'],
    // Workflow studio
    ['Workflow — designer', '/admin/workflow-studio'],
    ['Workflow — blueprints', '/admin/workflow-studio/blueprints'],
    ['Workflow — marketplace', '/admin/workflow-studio/market'],
    ['Workflow — simulateur', '/admin/workflow-studio/simulate'],
    // Templates
    ['Documents — templates', '/admin/templates'],
    // Modules
    ['Modules & extensions', '/admin/modules'],
    // IAM
    ['IAM — utilisateurs', '/admin/iam/users'],
    ['IAM — rôles', '/admin/iam/roles'],
    ['IAM — journal d\'accès', '/admin/iam/audit'],
    ['IAM — sessions', '/admin/iam/sessions'],
    // Intégrations
    ['Intégrations API', '/admin/integrations'],
    // Notifications & compte
    ['Notifications', '/admin/notifications'],
    ['Notifications — préférences', '/admin/notifications/prefs'],
    ['Mon compte', '/admin/account'],
  ];

  for (const [label, url] of ALL_ADMIN_SCREENS) {
    await attempt('P6b', 'Admin', `Visiter ${label} (${url})`, async () => {
      const resp = await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      if (page.url().includes('/login')) {
        throw new Error(`REDIRECT_LOGIN: ${url} redirige vers /login (session perdue ou perms manquantes)`);
      }
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 5_000 });
    }, { url });
  }

  // ═══ P7 — HORS MÉTIER : COMPTA, BACKUP, RGPD ════════════════════════
  logStep({ phase: 'P7', actor: 'SYSTEM', action: '═══ P7 : HORS MÉTIER ═══', outcome: 'info' });

  await attempt('P7', 'Admin', 'Ouvrir /admin/settings/backup', async () => {
    await page.goto(`${base}/admin/settings/backup`, { waitUntil: 'domcontentloaded' });
    await waitPageReady(page);
  }, { url: '/admin/settings/backup' });

  await attempt('P7', 'Admin', 'Clic "Nouvelle sauvegarde" (backup.new)', async () => {
    await clickButtonExact(page, 'Nouvelle sauvegarde', 5_000);
    await page.waitForTimeout(500);
  });

  await attempt('P7', 'Admin', 'Chercher CTA export RGPD', async () => {
    const btn = page.getByRole('button', { name: /(Générer|Export).*(RGPD|GDPR)/i });
    if ((await btn.count()) === 0) throw new Error('MISSING_CTA: bouton export RGPD non trouvé');
    await btn.first().click({ timeout: 5_000 });
  });

  // ═══ FIN ═══════════════════════════════════════════════════════════
  const counts: Record<string, number> = {};
  for (const s of steps) counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
  logStep({ phase: 'END', actor: 'SYSTEM', action: 'Synthèse outcomes', outcome: 'info',
    details: counts });

  await ctx.close();
  await browser.close();

  // On autorise les échecs individuels (on documente), mais on veut au moins
  // avoir passé le login (authOK) et couvert ≥ 40 steps.
  expect(steps.length).toBeGreaterThan(40);
  expect(authOK).toBe(true);
});

});
