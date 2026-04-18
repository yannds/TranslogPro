/**
 * OAuthButtonsStrip — boutons de connexion sociale, rendus dynamiquement
 * depuis `GET /api/auth/oauth/providers`. Le composant ne connaît AUCUN
 * provider en dur : ajouter/retirer Google/Microsoft/Facebook/Apple… côté
 * backend se répercute automatiquement ici.
 *
 * Si la réponse est vide (module non monté, aucun provider activé), le
 * composant ne rend rien — silent no-op, compatible avec un déploiement
 * sans OAuth.
 *
 * Accessibilité : chaque bouton a aria-label, rôle natif, focus ring.
 * i18n : les labels viennent du backend (displayName), pas du catalogue
 * i18n — volontairement, car ce sont des noms de marque.
 */

import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';

interface OAuthProviderMeta {
  key:         string;
  displayName: string;
  icon?:       string;
  scopes:      string[];
}

interface Props {
  /**
   * Slug tenant à transmettre au backend via ?tenant=… (multi-tenant).
   * Si omis, le backend tentera une résolution via le domaine.
   */
  tenantSlug?: string;
  /**
   * URL de retour après connexion réussie. Encodée et validée côté serveur.
   */
  returnTo?: string;
  /**
   * Classe additionnelle optionnelle (pour intégration dans LoginPage sombre
   * ou autres contextes).
   */
  className?: string;
}

/**
 * Rendu minimaliste d'icônes — on garde les logos de marque en SVG inline
 * pour éviter une lib d'icônes externe (lucide n'a pas tous les logos).
 * Ajouter une icône ici quand un nouveau provider l'exige, mais le
 * composant reste fonctionnel sans (fallback : initiale).
 */
function ProviderIcon({ icon, name }: { icon?: string; name: string }) {
  if (icon === 'google') {
    return (
      <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44c11 0 20-9 20-20 0-1.2-.2-2.4-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3A11.9 11.9 0 0 1 24 36c-5.2 0-9.7-3.3-11.3-8l-6.6 5.1A20 20 0 0 0 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12.2 12.2 0 0 1-4.1 5.5l6.3 5.3C41.4 35.9 44 30.4 44 24c0-1.2-.2-2.4-.4-3.5z"/>
      </svg>
    );
  }
  if (icon === 'microsoft') {
    return (
      <svg viewBox="0 0 23 23" className="w-4 h-4" aria-hidden>
        <path fill="#f25022" d="M1 1h10v10H1z"/>
        <path fill="#7fba00" d="M12 1h10v10H12z"/>
        <path fill="#00a4ef" d="M1 12h10v10H1z"/>
        <path fill="#ffb900" d="M12 12h10v10H12z"/>
      </svg>
    );
  }
  if (icon === 'facebook') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
        <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.019 4.388 11.011 10.125 11.927v-8.437H7.078v-3.49h3.047V9.34c0-3.023 1.795-4.693 4.533-4.693 1.312 0 2.686.235 2.686.235v2.975h-1.514c-1.491 0-1.956.93-1.956 1.886v2.266h3.328l-.532 3.49h-2.796v8.437C19.612 23.084 24 18.091 24 12.073z"/>
      </svg>
    );
  }
  // Fallback : initiale
  return (
    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function OAuthButtonsStrip({ tenantSlug, returnTo, className }: Props) {
  const [providers, setProviders] = useState<OAuthProviderMeta[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<OAuthProviderMeta[]>('/api/auth/oauth/providers')
      .then(list => { if (!cancelled) setProviders(Array.isArray(list) ? list : []); })
      .catch((err: unknown) => {
        // 404 = module OAuth non monté → silent no-op
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) setProviders([]);
          return;
        }
        if (!cancelled) setProviders([]);
      });
    return () => { cancelled = true; };
  }, []);

  if (!providers || providers.length === 0) return null;

  const buildStartUrl = (key: string) => {
    const qs = new URLSearchParams();
    if (tenantSlug) qs.set('tenant', tenantSlug);
    if (returnTo)   qs.set('returnTo', returnTo);
    const q = qs.toString();
    return `/api/auth/oauth/${encodeURIComponent(key)}/start${q ? `?${q}` : ''}`;
  };

  return (
    <div className={cn('space-y-2', className)} role="group" aria-label="Connexion sociale">
      {providers.map(p => (
        <a
          key={p.key}
          href={buildStartUrl(p.key)}
          aria-label={`Se connecter avec ${p.displayName}`}
          className={cn(
            'flex items-center justify-center gap-2 w-full rounded-lg border py-2 px-3 text-sm font-medium transition-colors',
            // Light + dark
            'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
            'dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
            'focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
          )}
        >
          <ProviderIcon icon={p.icon} name={p.displayName} />
          <span>{p.displayName}</span>
        </a>
      ))}
    </div>
  );
}
