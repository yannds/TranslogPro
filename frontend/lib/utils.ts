/**
 * utils.ts — Utilitaires fondamentaux de la Core Library
 *
 * cn()     : Fusion intelligente de classes Tailwind (clsx + tailwind-merge)
 * fmt*()   : Formatters localisés (dates, montants)
 * debounce : Hook debounce réutilisable
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge }               from 'tailwind-merge';

/** Fusionne des classes Tailwind sans conflits. Remplace classnames + twMerge inline. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formate un montant avec symbole de devise (fr-FR locale) */
export function fmtCfa(amount: number | null | undefined, symbol = 'FCFA'): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString('fr-FR')} ${symbol}`;
}

/** Formate une date en français (dd/mm/yyyy HH:MM) */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Tronque une chaîne avec ellipsis */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Génère un ID unique côté client (non cryptographique) */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Retourne une valeur sûre depuis un Record */
export function getOr<T>(obj: Record<string, T>, key: string, fallback: T): T {
  return key in obj ? obj[key] : fallback;
}
