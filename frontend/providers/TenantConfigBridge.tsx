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

  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;

    apiFetch<TenantConfigResponse>(`/api/tenants/${user.tenantId}/config`, {
      skipRedirectOn401: true,
    })
      .then(res => {
        if (cancelled) return;

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
  }, [user?.tenantId, applyConfig, setLang]);

  return null;
}
