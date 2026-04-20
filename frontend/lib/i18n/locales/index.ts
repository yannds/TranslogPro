/**
 * Locale index — charge le fichier de langue courant.
 *
 * Architecture :
 *   - fr.ts est le fichier maître (toutes les clés)
 *   - Les autres fichiers ne contiennent que les clés traduites
 *   - Les clés absentes d'une locale fallback vers fr.ts
 *
 * Pour ajouter une langue : créer xx.ts, ajouter l'import ici, zéro changement de code.
 */

import type { Language } from '../types';
import fr from './fr';
import en from './en';
import ln from './ln';
import ktu from './ktu';
import es from './es';
import pt from './pt';
import ar from './ar';
import wo from './wo';

export type LocaleDict = Record<string, unknown>;

const LOCALES: Record<Language, LocaleDict> = {
  fr:  fr as unknown as LocaleDict,
  en:  en as unknown as LocaleDict,
  ln:  ln as unknown as LocaleDict,
  ktu: ktu as unknown as LocaleDict,
  es:  es as unknown as LocaleDict,
  pt:  pt as unknown as LocaleDict,
  ar:  ar as unknown as LocaleDict,
  wo:  wo as unknown as LocaleDict,
};

const frDict = fr as unknown as LocaleDict;

/**
 * Résout une clé pointée dans un dict qui peut mélanger :
 *   - Clés plates dottées : { billing: { "trial.daysLeft": "..." } }
 *   - Objets imbriqués    : { platformKpi: { strategic: { title: "..." } } }
 *
 * Stratégie : essaie d'abord le walk récursif, puis tente chaque point comme
 * frontière ns/k (pour les clés plates dottées).
 */
function lookup(dict: LocaleDict, key: string): string | undefined {
  const parts = key.split('.');

  // 1) Walk récursif sur les sous-objets
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      cur = undefined;
      break;
    }
  }
  if (typeof cur === 'string') return cur;

  // 2) Clés plates dottées : essaie chaque frontière possible
  for (let i = 1; i < parts.length; i++) {
    const ns = parts.slice(0, i).join('.');
    const rest = parts.slice(i).join('.');
    const node = dict[ns];
    if (node && typeof node === 'object') {
      const v = (node as Record<string, unknown>)[rest];
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

/**
 * Résout une clé de traduction ('namespace.key' ou 'a.b.c') pour une langue.
 * Fallback : locale demandée → fr → clé brute.
 */
export function resolveKey(key: string, lang: Language): string {
  if (!key) return key;
  const locale = LOCALES[lang];
  if (locale) {
    const v = lookup(locale, key);
    if (v !== undefined) return v;
  }
  const frVal = lookup(frDict, key);
  if (frVal !== undefined) return frVal;
  return key;
}
