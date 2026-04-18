/**
 * TenantConfigBridge — pont entre Auth, TenantConfigProvider et I18nProvider.
 *
 * Responsabilité unique : après login, fetcher `/api/tenants/:id/config`,
 * puis propager :
 *   - company.language → I18nProvider.setLang()
 *   - brand + operational → TenantConfigProvider.applyPatch()
 *
 * Monte-le comme enfant direct de AuthProvider ET de TenantConfigProvider.
 * Ne rend rien (null) — effets de bord uniquement.
 */

import { useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth/auth.context';
import { useTenantConfigApply } from './TenantConfigProvider';
import { useI18n } from '../lib/i18n/useI18n';
import { resolveHost, buildTenantUrl, buildAdminUrl } from '../lib/tenancy/host';
import type { Language } from '../lib/i18n/types';

interface CompanyInfoResponse {
  id:           string;
  name:         string;
  slug:         string;
  language:     string;
  timezone:     string;
  currency:     string;
  rccm:         string | null;
  phoneNumber:  string | null;
}

interface BrandResponse {
  brandName?:      string | null;
  logoUrl?:        string | null;
  primaryColor?:   string | null;
  secondaryColor?: string | null;
  accentColor?:    string | null;
  textColor?:      string | null;
  bgColor?:        string | null;
  fontFamily?:     string | null;
}

interface TenantConfigResponse {
  company: CompanyInfoResponse;
  brand:   BrandResponse | null;
}

const SUPPORTED_LANGS: Language[] = ['fr', 'en', 'ln', 'ktu', 'es', 'pt', 'ar', 'wo'];

function isSupportedLanguage(s: string): s is Language {
  return (SUPPORTED_LANGS as string[]).includes(s);
}

export function TenantConfigBridge() {
  const { user }     = useAuth();
  const applyConfig  = useTenantConfigApply();
  const { setLang }  = useI18n();

  // Tenant effectif de la session courante : pendant une impersonation, c'est
  // le tenant CIBLE (pas le tenant natif de l'utilisateur plateforme). C'est
  // ce tenantId qui détermine la config/langue/branding à charger et qui doit
  // matcher le sous-domaine courant.
  const effectiveTenantId = user?.effectiveTenantId ?? user?.tenantId;

  useEffect(() => {
    if (!effectiveTenantId) return;
    let cancelled = false;

    apiFetch<TenantConfigResponse>(`/api/tenants/${effectiveTenantId}/config`, {
      skipRedirectOn401: true,
    })
      .then(res => {
        if (cancelled) return;

        // Defense in depth frontend : si le slug du tenant effectif de la
        // session ne correspond pas au sous-domaine courant, on ne charge PAS
        // la config (évite d'afficher les branding/couleurs du tenantA sur le
        // sous-domaine tenantB — scénario impossible en Phase 1+2 puisque
        // le cookie est scopé au sous-domaine, mais belt-and-suspenders).
        //
        // GUARD `__platform__` : le tenant plateforme n'a pas de sous-domaine
        // public (__platform__.translog.test n'est PAS dans /etc/hosts ni en
        // prod). Si on arrive ici avec ce slug, c'est qu'un vieux code /
        // session orpheline pointe sur le tenant plateforme — on refuse de
        // rediriger vers un host injoignable et on force le retour portail
        // admin. Prévient le bug "404 ERR_NAME_NOT_RESOLVED en boucle".
        const PLATFORM_SLUG = '__platform__';
        const host = resolveHost();
        if (res.company.slug === PLATFORM_SLUG && host.slug) {
          if (import.meta.env.DEV) {
            console.warn(
              `[TenantConfigBridge] Session pointe sur le tenant plateforme ` +
              `depuis un sous-domaine tenant (${host.slug}). ` +
              `Redirect vers /admin du portail plateforme.`,
            );
          }
          window.location.replace(buildAdminUrl('/admin/platform/dashboard'));
          return;
        }
        if (host.slug && res.company.slug && host.slug !== res.company.slug && !host.isAdmin) {
          if (import.meta.env.DEV) {
            console.warn(
              `[TenantConfigBridge] Host/session tenant mismatch: ` +
              `host.slug=${host.slug} session.slug=${res.company.slug}. ` +
              `Redirect vers le sous-domaine correct.`,
            );
          }
          // Redirect vers le sous-domaine effectif de la session — remplace
          // l'URL actuelle (pas de retour arrière).
          window.location.replace(buildTenantUrl(res.company.slug, window.location.pathname + window.location.search));
          return;
        }

        // 1. Langue : priorité absolue au choix du tenant.
        if (isSupportedLanguage(res.company.language)) {
          setLang(res.company.language);
        }

        // 2. Patch config : currency + timezone + brand si défini.
        applyConfig({
          tenantId:  res.company.id,
          operational: {
            currency:  res.company.currency,
            timezone:  res.company.timezone,
            defaultLang: isSupportedLanguage(res.company.language)
              ? res.company.language
              : 'fr',
          } as any,
          ...(res.brand ? { brand: {
            brandName:      res.brand.brandName      ?? 'TranslogPro',
            primaryColor:   res.brand.primaryColor   ?? '#0d9488',
            secondaryColor: res.brand.secondaryColor ?? '#0f766e',
            accentColor:    res.brand.accentColor    ?? '#f59e0b',
            textColor:      res.brand.textColor      ?? '#f8fafc',
            bgColor:        res.brand.bgColor        ?? '#020617',
            fontFamily:     res.brand.fontFamily     ?? "Inter, 'Segoe UI', system-ui, sans-serif",
            logoUrl:        res.brand.logoUrl        ?? undefined,
          } } : {}),
        });

        // Titre onglet : "{tenantName} - {brandName}" (white-label friendly).
        if (typeof document !== 'undefined' && res.company.name) {
          const brandLabel = res.brand?.brandName ?? 'TranslogPro';
          document.title = `${res.company.name} - ${brandLabel}`;
        }
      })
      .catch(() => {
        // Silencieux : fallback sur DEFAULT_TENANT_CONFIG. Log dev uniquement.
        if (import.meta.env.DEV) {
          console.warn('[TenantConfigBridge] Fetch /config échoué — fallback défauts');
        }
      });

    return () => { cancelled = true; };
  }, [effectiveTenantId, applyConfig, setLang]);

  return null;
}
