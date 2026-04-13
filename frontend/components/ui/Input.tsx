/**
 * Input — Champ de saisie universel
 *
 * Props supplémentaires vs <input> natif :
 *   - leftAddon  : icône/texte à gauche (ex: icône recherche)
 *   - rightAddon : icône/texte à droite (ex: bouton clear)
 *   - error      : message d'erreur (intégration react-hook-form)
 *   - label      : label accessible (aria-labelledby)
 *   - hint       : texte d'aide sous le champ
 *
 * Utilisé directement ou via <FormField> avec react-hook-form.
 */
import React, { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:      string;
  hint?:       string;
  error?:      string;
  leftAddon?:  ReactNode;
  rightAddon?: ReactNode;
  wrapperClass?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, leftAddon, rightAddon, wrapperClass, id: idProp, ...props }, ref) => {
    const generatedId = useId();
    const id          = idProp ?? generatedId;

    return (
      <div className={cn('flex flex-col gap-1', wrapperClass)}>
        {label && (
          <label
            htmlFor={id}
            className="text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            {label}
            {props.required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
          </label>
        )}

        <div className="relative flex items-center">
          {leftAddon && (
            <div className="pointer-events-none absolute left-3 text-slate-400 dark:text-slate-500">
              {leftAddon}
            </div>
          )}
          <input
            ref={ref}
            id={id}
            aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
            aria-invalid={error ? 'true' : undefined}
            className={cn(
              `flex h-9 w-full rounded-md border bg-white px-3 py-1 text-sm shadow-sm
               transition-colors placeholder:text-slate-400
               focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1
               disabled:cursor-not-allowed disabled:opacity-50
               dark:bg-slate-900 dark:placeholder:text-slate-600
               dark:focus:ring-slate-300 dark:focus:ring-offset-slate-950`,
              error
                ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                : 'border-slate-200 dark:border-slate-700',
              leftAddon  && 'pl-9',
              rightAddon && 'pr-9',
              className,
            )}
            {...props}
          />
          {rightAddon && (
            <div className="absolute right-3 text-slate-400 dark:text-slate-500">
              {rightAddon}
            </div>
          )}
        </div>

        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-red-500 dark:text-red-400">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
