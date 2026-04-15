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
  error: string | null | undefined;
  /** Affiche l'icône AlertTriangle + padding étendu (variante page). */
  icon?: boolean;
  className?: string;
}

export function ErrorAlert({ error, icon = false, className }: ErrorAlertProps) {
  if (!error) return null;

  const base =
    'rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 ' +
    'text-sm text-red-700 dark:text-red-300';
  const size = icon ? 'px-4 py-3 flex items-center gap-2' : 'px-3 py-2';

  return (
    <div role="alert" className={`${base} ${size}${className ? ` ${className}` : ''}`}>
      {icon && <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />}
      {error}
    </div>
  );
}
