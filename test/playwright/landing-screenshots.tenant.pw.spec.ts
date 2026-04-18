/**
 * landing-screenshots.tenant.pw.spec.ts — capture les 3 mockups de la landing
 *
 * Génère des captures PNG (haute qualité, converties en WebP par un script
 * post-processing si besoin) en LIGHT et DARK mode pour remplacer les SVG
 * mockups dans `frontend/components/public/PublicLanding.tsx` :
 *
 *   - hero-dashboard            (deep-dive tableau de bord principal)
 *   - deepdive-sell (vente billet)
 *   - deepdive-crm  (fiche client)
 *   - deepdive-analytics (yield)
 *
 * Exécution (skip par défaut — ne tourne pas en CI régulier) :
 *   CAPTURE_SCREENSHOTS=1 npm run test:pw -- landing-screenshots
 *
 * Sortie dans `frontend/public/landing/`.
 *
 * Pré-requis :
 *   - App démarrée : `./scripts/dev.sh` up (Vite + Nest + Postgres seedés)
 *   - Tenant E2E `trans-express` provisionné avec données démo
 *     (vente passée, client avec historique, trajet actif — garantis par
 *     `dev-seed` et `global-setup.ts` Playwright)
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SHOULD_CAPTURE = process.env.CAPTURE_SCREENSHOTS === '1';
const OUTPUT_DIR = path.resolve(__dirname, '../../frontend/public/landing');

// Viewport utilisé pour chaque capture. 1600×1000 = ratio de la landing mockup
// + 2× pour retina (affichage web-ready en 800×500 dans un container glass).
const CAPTURE_VIEWPORT = { width: 1600, height: 1000 };

test.describe('Landing screenshots', () => {
  test.skip(!SHOULD_CAPTURE, 'Set CAPTURE_SCREENSHOTS=1 to run');

  test.beforeAll(async () => {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(CAPTURE_VIEWPORT);
    // Désactive les animations qui flashent pendant la capture.
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  // ─── Hero dashboard (KPIs + chart + table) ────────────────────────────────
  test('hero-dashboard (light + dark)', async ({ page }) => {
    await captureDashboardPage(page, '/admin', 'hero-dashboard');
  });

  // ─── Deep-dive #1 : vente d'un billet ────────────────────────────────────
  test('deepdive-sell (light + dark)', async ({ page }) => {
    await captureDashboardPage(page, '/admin/sell-ticket', 'deepdive-sell');
  });

  // ─── Deep-dive #2 : CRM — fiche client ───────────────────────────────────
  test('deepdive-crm (light + dark)', async ({ page }) => {
    // Ouvre la liste CRM et clique sur le 1er client pour charger sa fiche 360.
    await captureDashboardPage(page, '/admin/crm/customers', 'deepdive-crm', async (p) => {
      // Clique le 1er client si la liste a des résultats
      const firstRow = p.locator('[role="row"]').nth(1);
      if (await firstRow.count()) await firstRow.click();
      await p.waitForLoadState('networkidle');
    });
  });

  // ─── Deep-dive #3 : analytics / yield ────────────────────────────────────
  test('deepdive-analytics (light + dark)', async ({ page }) => {
    await captureDashboardPage(page, '/admin/analytics', 'deepdive-analytics');
  });
});

// ─── Helper : capture light + dark pour une route ────────────────────────────

async function captureDashboardPage(
  page: Page,
  urlPath: string,
  baseName: string,
  postLoad?: (page: Page) => Promise<void>,
) {
  for (const theme of ['light', 'dark'] as const) {
    // Force le thème via localStorage AVANT la navigation pour éviter le FOUC.
    await page.addInitScript((t) => {
      localStorage.setItem('translog-theme', t);
    }, theme);

    await page.goto(urlPath, { waitUntil: 'networkidle' });

    // Close the tour if it opens on sell-ticket (first visit auto-start).
    // On persiste "done" pour qu'il ne s'affiche pas sur les prises suivantes.
    await page.addInitScript(() => {
      try { localStorage.setItem('tour-done:ticketing-v1', String(Date.now())); } catch { /* ignore */ }
    });

    // Masque la sidebar pour avoir un cadre propre centré sur le contenu
    // (les marketing mockups n'incluent généralement pas la nav complète).
    // Si tu préfères la garder, commente cette ligne.
    await page.addStyleTag({ content: `
      aside, [role="complementary"] { display: none !important; }
      main { margin-left: 0 !important; }
    ` });

    if (postLoad) await postLoad(page);

    // Laisse le temps aux animations CSS (Recharts) de se poser.
    await page.waitForTimeout(800);

    const fileName = `${baseName}-${theme}.png`;
    const out = path.join(OUTPUT_DIR, fileName);
    await page.screenshot({ path: out, fullPage: false });
    expect(fs.existsSync(out)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${fileName}`);
  }
}
