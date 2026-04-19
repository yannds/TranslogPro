/**
 * i18n mobile — réutilise les dictionnaires du frontend web (8 locales).
 *
 * Stratégie : les fichiers de locale sont référencés via un chemin relatif
 * (`../../../frontend/lib/i18n/locales/…`) au build. Pour une app packagée
 * indépendamment du monorepo, copier les locales dans `assets/i18n/` et
 * adapter `LOCALES` ci-dessous.
 */

import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Localization from 'expo-localization';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — l'import dépasse la racine du package, c'est voulu pour partager
// les traductions entre web et mobile. Si nécessaire, copier localement.
import fr from '../../../../frontend/lib/i18n/locales/fr';
import en from '../../../../frontend/lib/i18n/locales/en';
// Les autres locales peuvent être ajoutées de la même façon (ln, ktu, es, pt, ar, wo).

export type Language = 'fr' | 'en';

const LOCALES: Record<Language, Record<string, Record<string, string>>> = {
  fr: fr as unknown as Record<string, Record<string, string>>,
  en: en as unknown as Record<string, Record<string, string>>,
};

const STORAGE_KEY = 'translog_lang';

// Storage adapter : MMKV sur natif (rapide, chiffré), localStorage sur web.
// Évite l'erreur "NativeMmkvModule not found" quand on bundle pour web.
interface KvStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}
function createStorage(): KvStorage {
  if (Platform.OS === 'web') {
    return {
      getString: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) ?? undefined : undefined),
      set:       (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
    };
  }
  // Import synchrone sur natif — dispo partout car Metro inclut la lib.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MMKV } = require('react-native-mmkv');
  const mmkv = new MMKV();
  return {
    getString: (k) => mmkv.getString(k),
    set:       (k, v) => mmkv.set(k, v),
  };
}
const storage = createStorage();

function detectInitialLang(): Language {
  const stored = storage.getString(STORAGE_KEY) as Language | undefined;
  if (stored && stored in LOCALES) return stored;
  const deviceLangs = Localization.getLocales();
  for (const loc of deviceLangs) {
    const code = loc.languageCode?.toLowerCase() as Language | undefined;
    if (code && code in LOCALES) return code;
  }
  return 'fr';
}

type I18nParams = Record<string, string | number | undefined | null>;

function resolve(key: string, lang: Language): string {
  const [ns, ...rest] = key.split('.');
  const k = rest.join('.');
  const dict = LOCALES[lang];
  const primary = dict?.[ns]?.[k];
  if (primary) return primary;
  return LOCALES.fr[ns]?.[k] ?? key;
}

function interpolate(str: string, params?: I18nParams): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = params[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

interface I18nCtx {
  lang:    Language;
  setLang: (l: Language) => void;
  t:       (key: string, params?: I18nParams) => string;
}

const Context = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectInitialLang);
  const setLang = useCallback((l: Language) => {
    storage.set(STORAGE_KEY, l);
    setLangState(l);
  }, []);
  const t = useCallback(
    (key: string, params?: I18nParams) => interpolate(resolve(key, lang), params),
    [lang],
  );
  useEffect(() => {
    // hook de réactualisation si device change
  }, []);
  return (
    <Context.Provider value={{ lang, setLang, t }}>{children}</Context.Provider>
  );
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}
