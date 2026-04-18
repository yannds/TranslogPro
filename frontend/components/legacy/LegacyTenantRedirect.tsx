/**
 * LegacyTenantRedirect — composant transitoire Phase 1.
 *
 * Captures les URLs legacy `/p/:tenantSlug/*` (ancien portail public par path)
 * et redirige vers `https://{slug}.translogpro.com/*` (nouveau format subdomain).
 *
 * Pourquoi client-side et pas un 301 nginx/Caddy ?
 *   - Le frontend SPA est déjà chargé sur `{slug}.translog.test` : le routing
 *     React intercepte `/p/:slug/*`. Un 301 réseau n'est pas atteint.
 *   - Ce composant pousse un `window.location.replace()` (pas un <Navigate />)
 *     pour forcer un vrai changement d'origine → réactivation correcte des
 *     cookies scopés au nouveau sous-domaine.
 *
 * À SUPPRIMER après migration complète (ex: 90 jours post-cutover + 404 côté
 * Caddy sur les anciennes URLs pour détecter les clients qui n'ont pas migré).
 */

import { useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { buildTenantUrl, resolveHost } from '../../lib/tenancy/host';

export function LegacyTenantRedirect() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();

  useEffect(() => {
    if (!tenantSlug) return;

    const host = resolveHost();

    // Déjà sur le bon sous-domaine ? On ne redirect pas — le nouveau routing
    // prendra le relais via les routes `{slug}.{baseDomain}/...`.
    if (host.slug === tenantSlug) {
      return;
    }

    // Calculer la nouvelle URL : strip `/p/:slug` du path, garder le reste
    const legacyPrefix = `/p/${tenantSlug}`;
    const newPath = location.pathname.startsWith(legacyPrefix)
      ? location.pathname.slice(legacyPrefix.length) || '/'
      : '/';

    const target = buildTenantUrl(tenantSlug, newPath + location.search);

    // replace() au lieu de assign() → pas d'entrée history supplémentaire.
    // L'utilisateur qui revient en arrière se retrouve à l'étape précédant
    // le lien obsolète, pas piégé dans une boucle redirect.
    window.location.replace(target);
  }, [tenantSlug, location.pathname, location.search]);

  // Placeholder minimal — l'utilisateur ne voit ça qu'un instant.
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      minHeight:      '100vh',
      fontFamily:     'system-ui, sans-serif',
      color:          '#64748b',
    }}>
      <p>Redirection vers le sous-domaine du tenant…</p>
    </div>
  );
}
