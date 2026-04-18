/**
 * Playwright — Global Setup
 *
 * Une fois avant TOUS les tests :
 *   1. Seed les comptes E2E (SUPER_ADMIN + TENANT_ADMIN) via scripts/seed-e2e.ts
 *   2. Vérifie que Vite (:5173) et Nest (:3000) répondent
 *   3. Pour chaque rôle, fait un login via `POST /api/auth/sign-in`, récupère
 *      le cookie de session et persiste le storage state dans un fichier JSON
 *      consommé par les projets `super-admin` / `tenant-admin`.
 *
 * Si la DB n'est pas accessible (dev.sh pas lancé), le script échoue
 * immédiatement avec un message clair plutôt que de laisser les tests partir.
 */

import { chromium, request, FullConfig } from '@playwright/test';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { STORAGE_PATHS } from '../../playwright.config';
import { E2E, seedE2E } from '../../scripts/seed-e2e';

/**
 * Flush Redis avant le login E2E pour éviter le rate-limit 5/15min sur
 * `/sign-in`. Best-effort : si Redis n'est pas joignable, on ignore.
 */
function flushRedis(): void {
  try {
    execSync(
      'docker exec translog-redis redis-cli -a redis_password --no-auth-warning FLUSHDB',
      { stdio: 'pipe', timeout: 5_000 },
    );
    console.log('[pw setup] 🧹 Redis FLUSHDB (rate-limit reset)');
  } catch { /* ignore — si rate-limit actif, les tests échoueront clairement */ }
}

const API_URL     = process.env['API_URL']         ?? 'http://localhost:3000';
const BASE_DOMAIN = process.env['PW_BASE_DOMAIN']  ?? 'translog.test';
const BASE_URL    = process.env['PW_BASE_URL']     ?? `http://admin.${BASE_DOMAIN}:5173`;
const TENANT_SLUG = process.env['PW_TENANT_SLUG']  ?? 'trans-express';
const TENANT_URL  = process.env['PW_TENANT_URL']   ?? `http://${TENANT_SLUG}.${BASE_DOMAIN}:5173`;

export default async function globalSetup(_config: FullConfig) {
  console.log('\n[pw setup] 🔧 Seed comptes E2E + récupération storageState…');

  // 0) Flush Redis rate-limit pour permettre les logins E2E successifs
  flushRedis();

  // 1) Seed DB — idempotent
  try {
    await seedE2E();
  } catch (e) {
    console.error('[pw setup] ❌ Seed échoué — la DB est-elle up ? (./scripts/dev.sh)');
    throw e;
  }

  // 2) Créer le dossier .auth
  const authDir = path.dirname(STORAGE_PATHS.superAdmin);
  if (!existsSync(authDir)) await mkdir(authDir, { recursive: true });

  // 3) Login via API pour chaque rôle, persister le cookie.
  // On utilise un APIRequestContext Playwright pour suivre les cookies Set-Cookie.
  const api = await request.newContext({ baseURL: API_URL, ignoreHTTPSErrors: true });

  // Chaque rôle se connecte en forçant un Host header différent pour que le
  // backend résolve le bon tenant via son TenantResolverService. Le cookie
  // est ensuite déposé sur le domaine correspondant pour que le browser
  // l'envoie lors de la navigation.
  const roles: Array<{
    email:     string;
    path:      string;
    label:     string;
    hostHeader: string;
    browserUrl: string; // URL navigateur où le cookie doit être scopé
  }> = [
    {
      email:      E2E.superAdmin.email,
      path:       STORAGE_PATHS.superAdmin,
      label:      'SUPER_ADMIN',
      hostHeader: `admin.${BASE_DOMAIN}`,
      browserUrl: BASE_URL,
    },
    {
      email:      E2E.tenantAdmin.email,
      path:       STORAGE_PATHS.tenantAdmin,
      label:      'TENANT_ADMIN',
      hostHeader: `${TENANT_SLUG}.${BASE_DOMAIN}`,
      browserUrl: TENANT_URL,
    },
  ];

  for (const role of roles) {
    // Contexte API dédié : Host header spécifique au tenant, cookies scopés
    const roleApi = await request.newContext({
      baseURL: API_URL,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Host: role.hostHeader },
    });

    const res = await roleApi.post('/api/auth/sign-in', {
      data: { email: role.email, password: E2E.password },
    });
    if (!res.ok()) {
      const body = await res.text().catch(() => '');
      await roleApi.dispose();
      throw new Error(`[pw setup] Login ${role.label} échoué : HTTP ${res.status()} ${body}`);
    }

    const cookies = await roleApi.storageState();
    const session = cookies.cookies.find(c => c.name === 'translog_session');
    if (!session) {
      await roleApi.dispose();
      throw new Error(`[pw setup] Pas de cookie translog_session après login ${role.label}`);
    }

    const url = new URL(role.browserUrl);
    const state = {
      cookies: [{
        name:     'translog_session',
        value:    session.value,
        domain:   url.hostname,
        path:     '/',
        httpOnly: true,
        secure:   url.protocol === 'https:',
        sameSite: 'Lax' as const,
        expires:  session.expires ?? -1,
      }],
      origins: [],
    };
    await writeFile(role.path, JSON.stringify(state, null, 2), 'utf8');
    console.log(`[pw setup] ✅ ${role.label} → ${path.relative(process.cwd(), role.path)} (host=${role.hostHeader})`);
    await roleApi.dispose();
  }

  await api.dispose();

  // 4) Smoke check : Vite répond via le sous-domaine admin
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP *.${BASE_DOMAIN} 127.0.0.1, MAP ${BASE_DOMAIN} 127.0.0.1`],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();
  try {
    const res = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    if (!res || res.status() >= 500) {
      throw new Error(`[pw setup] Vite KO sur ${BASE_URL} (${res?.status()})`);
    }
    console.log(`[pw setup] ✅ Vite répond sur ${BASE_URL}`);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log('[pw setup] 🚀 Setup terminé.\n');
}
