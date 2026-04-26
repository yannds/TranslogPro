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
import AsyncStorage from '@react-native-async-storage/async-storage';
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

// Storage adapter — AsyncStorage sur natif (compatible Expo Go), localStorage
// sur web. AsyncStorage est asynchrone : on initialise la langue avec une
// détection device synchrone, puis on override via useEffect dès que le
// stockage est lu.
interface KvStorage {
  getString(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
function createStorage(): KvStorage {
  if (Platform.OS === 'web') {
    return {
      getString: async (k) =>
        typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null,
      set:       async (k, v) => {
        if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
      },
    };
  }
  return {
    getString: (k) => AsyncStorage.getItem(k),
    set:       (k, v) => AsyncStorage.setItem(k, v),
  };
}
const storage = createStorage();

function detectDeviceLang(): Language {
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
  // 1er render : on prend la langue device. Le stockage est lu en effet,
  // si une pref existe on l'applique (override silencieux d'1 frame).
  const [lang, setLangState] = useState<Language>(detectDeviceLang);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await storage.getString(STORAGE_KEY);
        if (cancelled) return;
        if (stored && stored in LOCALES) {
          setLangState(stored as Language);
        }
      } catch { /* storage indispo : on garde la langue device */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    void storage.set(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, params?: I18nParams) => interpolate(resolve(key, lang), params),
    [lang],
  );

  return (
    <Context.Provider value={{ lang, setLang, t }}>{children}</Context.Provider>
  );
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}
