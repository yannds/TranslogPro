/**
 * useI18n — Hook d'internationalisation
 *
 * API :
 *   const { t, lang, setLang } = useI18n();
 *   t('common.save')        → 'Enregistrer' (fr) ou 'Save' (en)
 *   t('fleet.addVehicle')   → 'Ajouter un véhicule' / 'Add Vehicle'
 *
 * Les clés sont des chemins 'namespace.key' résolus dans les fichiers
 * de locale (locales/fr.ts, locales/en.ts, etc.).
 *
 * Backward compat: t() accepte aussi un Record<string,string> (TranslationMap)
 * pour la transition — sera retiré une fois tous les composants migrés.
 */

import { useContext, createContext } from 'react';
import type { Language, TranslationMap } from './types';
import { TRANSLATIONS } from './translations';
import { LANGUAGE_META } from './types';

export interface I18nCtx {
  lang:       Language;
  setLang:    (l: Language) => void;
  /** Traduit une clé 'namespace.key' ou un TranslationMap (backward compat) */
  t:          (keyOrMap: string | Record<string, string | undefined>) => string;
  dir:        'ltr' | 'rtl';
  dateLocale: string;
  /** Accès direct au dictionnaire legacy (pour transition) */
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
export function translate(map: TranslationMap, lang: Language): string {
  return (map as Record<string, string>)[lang] ?? map.fr ?? '';
}

/**
 * Raccourci pour créer une TranslationMap (backward compat — sera supprimé).
 * Préférer les clés string : t('namespace.key')
 */
export function tm(
  fr: string, en: string,
  extra?: Partial<Record<Language, string>>,
): TranslationMap {
  return { fr, en, ...extra };
}
