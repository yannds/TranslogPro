/**
 * useI18n — Hook d'internationalisation
 *
 * Accède à la langue active via le contexte I18nProvider.
 * Fournit t() pour traduire une TranslationMap en string.
 */

import { useContext, createContext } from 'react';
import type { Language } from './types';
import { TRANSLATIONS } from './translations';
import { LANGUAGE_META } from './types';

export interface I18nCtx {
  lang:       Language;
  setLang:    (l: Language) => void;
  /** Traduit une TranslationMap en string selon la langue active. Fallback → fr */
  t:          (map: Record<Language, string>) => string;
  dir:        'ltr' | 'rtl';
  dateLocale: string;
  /** Accès direct au dictionnaire complet */
  dict:       typeof TRANSLATIONS;
  /** Liste des langues disponibles avec métadonnées */
  languages:  typeof LANGUAGE_META;
}

export const I18nContext = createContext<I18nCtx | null>(null);

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}

/** Helper standalone : traduit sans le hook (pour SSR / config) */
export function translate(map: Record<Language, string>, lang: Language): string {
  return map[lang] ?? map['fr'] ?? Object.values(map)[0] ?? '';
}
