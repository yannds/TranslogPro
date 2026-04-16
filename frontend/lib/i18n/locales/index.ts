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

export type LocaleDict = Record<string, Record<string, string>>;

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
 * Résout une clé de traduction ('namespace.key') pour une langue donnée.
 * Fallback : locale demandée → fr → clé brute.
 */
export function resolveKey(key: string, lang: Language): string {
  const [ns, ...rest] = key.split('.');
  const k = rest.join('.');
  if (!ns || !k) return key;

  // Essayer la locale demandée
  const locale = LOCALES[lang];
  const val = (locale?.[ns] as Record<string, string> | undefined)?.[k];
  if (val) return val;

  // Fallback vers français
  const frVal = (frDict?.[ns] as Record<string, string> | undefined)?.[k];
  if (frVal) return frVal;

  // Clé brute si introuvable
  return key;
}
