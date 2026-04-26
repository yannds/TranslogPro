/**
 * Configuration API — façade rétro-compatible vers `host-store.ts`.
 *
 * Avant : la base URL était hardcodée au build via EXPO_PUBLIC_API_BASE_URL.
 * Maintenant : l'app est multi-tenant SaaS — l'utilisateur saisit son slug
 * au login et l'app route dynamiquement. Voir `host-store.ts`.
 *
 * Cette façade existe pour ne pas casser les imports existants
 * (`getApiBaseUrl`, `getDevTenantHost`).
 */

import { getApiBaseUrl as _getApiBaseUrl } from './host-store';

export { getApiBaseUrl } from './host-store';

/**
 * Header `X-Tenant-Host` pour le dev local (backend lit ce header en
 * NODE_ENV=development pour résoudre le tenant sans dépendre du sous-domaine).
 * En prod, le sous-domaine de l'URL suffit — on retourne null.
 */
export function getDevTenantHost(): string | null {
  const base = _getApiBaseUrl();
  if (!/localhost|127\.0\.0\.1/.test(base)) return null;
  // En dev local pur (pas de slug encore choisi), on cible 'trans-express'
  // par défaut pour que le seed dev fonctionne sans config.
  return 'trans-express.translog.test';
}
