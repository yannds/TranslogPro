/**
 * TenantConfigProvider — Configuration multi-tenant
 *
 * Charge depuis l'API (ou fallback statique) :
 *   - Identité visuelle (nom, couleurs → injectées en CSS variables)
 *   - Pays et liste de villes
 *   - Registre de statuts (labels + visuels)
 *   - Config opérationnelle (fuseau horaire, devise, formats)
 *
 * Toutes les couleurs sont injectées en CSS custom properties
 * sur :root → 100% dark-mode natif via les classes Tailwind.
 */

import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from 'react';
import type { Language }      from '../lib/i18n/types';
import type { StatusRegistry } from '../lib/config/status.config';
import type { City }           from '../lib/config/city.config';
import { DEFAULT_TRIP_STATUS_REGISTRY } from '../lib/config/status.config';
import { getCitiesForTenant }           from '../lib/config/city.config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantBrand {
  brandName:      string;
  primaryColor:   string;   // CSS hex
  secondaryColor: string;
  accentColor:    string;
  textColor:      string;
  bgColor:        string;
  fontFamily:     string;
  logoUrl?:       string;
}

export interface TenantOperational {
  country:        string;   // ISO alpha-2
  timezone:       string;   // ex. 'Africa/Brazzaville'
  currency:       string;   // ISO 4217 ex. 'XAF'
  currencySymbol: string;
  dateFormat:     string;   // ex. 'DD/MM/YYYY'
  defaultLang:    Language;
  rotateLanguages: Language[];
  /** Intervalle de rotation des langues sur écrans publics (ms, 0 = désactivé) */
  displayLangRotateMs: number;
}

export interface TenantConfig {
  tenantId:    string;
  brand:       TenantBrand;
  operational: TenantOperational;
  statuses:    StatusRegistry;
  cities:      City[];
}

// ─── Defaults (République du Congo) ──────────────────────────────────────────

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  tenantId: 'demo',
  brand: {
    brandName:      'TranslogPro',
    primaryColor:   '#0d9488',   // teal-600
    secondaryColor: '#0f766e',   // teal-700
    accentColor:    '#f59e0b',   // amber-500
    textColor:      '#f8fafc',   // slate-50
    bgColor:        '#020617',   // slate-950
    fontFamily:     "Inter, 'Segoe UI', system-ui, sans-serif",
  },
  operational: {
    country:        'CG',
    timezone:       'Africa/Brazzaville',
    currency:       'XAF',
    currencySymbol: 'FCFA',
    dateFormat:     'DD/MM/YYYY',
    defaultLang:    'fr',
    rotateLanguages: ['fr', 'en', 'ln', 'ktu'],
    displayLangRotateMs: 8_000,  // 8s par langue sur écrans TV
  },
  statuses:  DEFAULT_TRIP_STATUS_REGISTRY,
  cities:    getCitiesForTenant('CG', true),
};

// ─── Contexte ─────────────────────────────────────────────────────────────────

interface TenantConfigContextValue {
  config: TenantConfig;
  /** Applique partiellement la config (ex: après fetch /tenants/:id/config) */
  applyPatch: (patch: Partial<TenantConfig>) => void;
}

export const TenantConfigContext = createContext<TenantConfigContextValue>({
  config:     DEFAULT_TENANT_CONFIG,
  applyPatch: () => { /* no-op default */ },
});

export function useTenantConfig(): TenantConfig {
  return useContext(TenantConfigContext).config;
}

export function useTenantConfigApply(): (patch: Partial<TenantConfig>) => void {
  return useContext(TenantConfigContext).applyPatch;
}

/** Formate un montant selon la devise du tenant */
export function useCurrencyFormatter() {
  const { operational } = useTenantConfig();
  return (amount: number) =>
    new Intl.NumberFormat('fr-FR', {
      style:    'currency',
      currency: operational.currency,
      maximumFractionDigits: 0,
    }).format(amount);
}

/**
 * Merge profond d'un patch sur la config courante.
 * Préserve les sous-objets non fournis (brand, operational, statuses, cities).
 */
function mergeConfig(cur: TenantConfig, patch: Partial<TenantConfig>): TenantConfig {
  return {
    ...cur,
    ...patch,
    brand:       { ...cur.brand,       ...(patch.brand       ?? {}) },
    operational: { ...cur.operational, ...(patch.operational ?? {}) },
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface TenantConfigProviderProps {
  children: ReactNode;
  /** Override statique (tests / storybook) — si fourni, désactive le fetch dynamique */
  config?:  TenantConfig;
}

export function TenantConfigProvider({
  children,
  config: staticConfig,
}: TenantConfigProviderProps) {
  const [config, setConfig] = useState<TenantConfig>(
    staticConfig ?? DEFAULT_TENANT_CONFIG,
  );

  // Synchronise la config si le staticConfig change (tests / storybook)
  useEffect(() => {
    if (staticConfig) setConfig(staticConfig);
  }, [staticConfig]);

  // Injection des couleurs tenant en CSS custom properties (dark-mode agnostique)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const { brand } = config;
    root.style.setProperty('--color-primary',   brand.primaryColor);
    root.style.setProperty('--color-secondary', brand.secondaryColor);
    root.style.setProperty('--color-accent',    brand.accentColor);
    root.style.setProperty('--color-text',      brand.textColor);
    root.style.setProperty('--color-bg',        brand.bgColor);
    root.style.setProperty('--font-family',     brand.fontFamily);
  }, [config]);

  const applyPatch = useCallback((patch: Partial<TenantConfig>) => {
    setConfig(prev => mergeConfig(prev, patch));
  }, []);

  return (
    <TenantConfigContext.Provider value={{ config, applyPatch }}>
      {children}
    </TenantConfigContext.Provider>
  );
}
