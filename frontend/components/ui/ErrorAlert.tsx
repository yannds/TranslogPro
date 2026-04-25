/**
 * ErrorAlert — bandeau d'erreur standardisé (role="alert").
 *
 * Deux variantes :
 *   - inline (défaut) : compact, utilisé dans les formulaires en modale.
 *   - banner (`icon`) : plus aéré + icône d'alerte, utilisé en haut de page.
 *
 * Rendu conditionnel : retourne `null` si `error` est falsy.
 */

import { AlertTriangle } from 'lucide-react';

export interface ErrorAlertProps {
  error?: string | null | undefined;
  /** Alias de `error` — toléré pour rester compatible avec les pages qui
   * passent `message="..."` (sémantique identique : si l'un OU l'autre est
   * non-vide, on affiche le bandeau). */
  message?: string | null | undefined;
  /** Affiche l'icône AlertTriangle + padding étendu (variante page). */
  icon?: boolean;
  className?: string;
}

export function ErrorAlert({ error, message, icon = false, className }: ErrorAlertProps) {
  const text = error ?? message;
  if (!text) return null;

  const base =
    'rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 ' +
    'text-sm text-red-700 dark:text-red-300';
  const size = icon ? 'px-4 py-3 flex items-center gap-2' : 'px-3 py-2';

  return (
    <div role="alert" className={`${base} ${size}${className ? ` ${className}` : ''}`}>
      {icon && <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />}
      {text}
    </div>
  );
}
