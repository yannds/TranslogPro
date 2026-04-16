/**
 * I18nProvider — Contexte d'internationalisation
 *
 * Fournit :
 *   - lang     : langue active
 *   - setLang  : changement manuel
 *   - t()      : traduction d'une TranslationMap
 *   - rotate() : rotation automatique (pour écrans publics)
 *   - dir      : ltr | rtl (arabe)
 *
 * La langue initiale est résolue dans cet ordre :
 *   1. Prop `initialLang` (forcé par le tenant)
 *   2. localStorage 'translog-lang'
 *   3. navigator.language
 *   4. 'fr' (fallback)
 */

import {
  useState, useEffect, useCallback, useRef,
  type ReactNode,
} from 'react';
import { I18nContext }    from '../lib/i18n/useI18n';
import type { Language }  from '../lib/i18n/types';
import { LANGUAGE_META }  from '../lib/i18n/types';
import { TRANSLATIONS }   from '../lib/i18n/translations';
import { resolveKey }     from '../lib/i18n/locales';

const STORAGE_KEY = 'translog-lang';

function detectBrowserLang(): Language {
  if (typeof navigator === 'undefined') return 'fr';
  const code = navigator.language.slice(0, 2).toLowerCase();
  const map: Record<string, Language> = {
    fr: 'fr', en: 'en', es: 'es', pt: 'pt', ar: 'ar',
  };
  return map[code] ?? 'fr';
}

interface I18nProviderProps {
  children:      ReactNode;
  initialLang?:  Language;
  /** Si > 0 : rotation automatique entre langues (ms). Usage : écrans TV publics */
  rotateIntervalMs?: number;
  /** Sous-ensemble de langues à faire tourner (défaut : toutes) */
  rotateLanguages?:  Language[];
}

export function I18nProvider({
  children,
  initialLang,
  rotateIntervalMs = 0,
  rotateLanguages,
}: I18nProviderProps) {
  const [lang, setLangState] = useState<Language>(() => {
    if (initialLang) return initialLang;
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
      if (stored && stored in LANGUAGE_META) return stored;
    }
    return detectBrowserLang();
  });

  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, l);
    }
    // Applique dir sur <html> pour RTL
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('dir', LANGUAGE_META[l].dir);
      document.documentElement.setAttribute('lang', l);
    }
  }, []);

  // Rotation automatique (pour écrans publics sans interaction)
  useEffect(() => {
    if (rotateIntervalMs <= 0) return;
    const langs: Language[] = rotateLanguages ?? (Object.keys(LANGUAGE_META) as Language[]);
    let idx = langs.indexOf(lang);
    rotateRef.current = setInterval(() => {
      idx = (idx + 1) % langs.length;
      setLang(langs[idx]);
    }, rotateIntervalMs);
    return () => {
      if (rotateRef.current) clearInterval(rotateRef.current);
    };
  }, [rotateIntervalMs, rotateLanguages, lang, setLang]);

  // Sync dir au montage
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('dir', LANGUAGE_META[lang].dir);
      document.documentElement.setAttribute('lang', lang);
    }
  }, [lang]);

  const t = useCallback(
    (keyOrMap: string | Record<string, string | undefined>): string => {
      // String key: 'namespace.key' → lookup in locale files
      if (typeof keyOrMap === 'string') {
        return resolveKey(keyOrMap, lang);
      }
      // TranslationMap object (backward compat — sera supprimé)
      return keyOrMap[lang] ?? keyOrMap['fr'] ?? Object.values(keyOrMap).find(v => v != null) ?? '';
    },
    [lang],
  );

  const value = {
    lang,
    setLang,
    t,
    dir:        LANGUAGE_META[lang].dir,
    dateLocale: LANGUAGE_META[lang].dateLocale,
    dict:       TRANSLATIONS,
    languages:  LANGUAGE_META,
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
