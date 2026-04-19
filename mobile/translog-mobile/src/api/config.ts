/**
 * Configuration API — unique point de vérité pour la base URL + tenant host dev.
 *
 * Résolution de l'URL :
 *   1. build env `EXPO_PUBLIC_API_BASE_URL`
 *   2. `expo.extra.apiBaseUrl` (app.json)
 *   3. fallback `http://localhost:3000`
 *
 * Résolution du tenant dev :
 *   - `expo.extra.devTenantHost` (app.json) — défaut 'trans-express.translog.test'
 *     pour que le backend résolve le tenant via X-Tenant-Host sans exiger que
 *     l'app mobile hit un sous-domaine réel (ce qui casse avec HSTS).
 *   - En prod (apiBaseUrl = https://<slug>.translogpro.com) le Host réel suffit
 *     et X-Tenant-Host est strippé côté edge proxy.
 */

import Constants from 'expo-constants';

const DEFAULT_DEV_URL         = 'http://localhost:3000';
const DEFAULT_DEV_TENANT_HOST = 'trans-express.translog.test';

export function getApiBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  const fromEnv   = process.env.EXPO_PUBLIC_API_BASE_URL;
  const fromExtra = extra.apiBaseUrl;
  return fromEnv ?? fromExtra ?? DEFAULT_DEV_URL;
}

/**
 * Retourne le hostname à envoyer en `X-Tenant-Host` en dev, ou null en prod.
 * Le backend NestJS n'honore ce header qu'en NODE_ENV=development.
 */
export function getDevTenantHost(): string | null {
  const base = getApiBaseUrl();
  // Si l'API est déjà un sous-domaine tenant (prod ou dev avec DNS local),
  // le Host natif suffit — on n'ajoute pas le header.
  if (!/localhost|127\.0\.0\.1/.test(base)) return null;
  const extra = (Constants.expoConfig?.extra ?? {}) as { devTenantHost?: string };
  return extra.devTenantHost ?? DEFAULT_DEV_TENANT_HOST;
}
