/**
 * Select — Composant de sélection natif + Radix accessible
 *
 * Deux modes :
 *   native=true  : <select> HTML natif (mobile-friendly, performances max)
 *   native=false : Radix SelectRoot (accessible, custom styling, portail)
 *
 * Props :
 *   options  : { value, label, disabled? }[]
 *   error    : message d'erreur react-hook-form
 *   label    : label accessible
 *   placeholder : texte vide (disabled option)
 */
import { forwardRef, type SelectHTMLAttributes, useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value:     string;
  label:     string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options:     SelectOption[];
  label?:      string;
  hint?:       string;
  error?:      string;
  placeholder?: string;
  wrapperClass?: string;
  leftAddon?:  ReactNode;
}

/** Select natif — Première option de la librairie (DRY, performant, accessible) */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, label, hint, error, placeholder, wrapperClass, leftAddon, id: idProp, ...props }, ref) => {
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

        <div className="relative">
          {leftAddon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
              {leftAddon}
            </div>
          )}
          <select
            ref={ref}
            id={id}
            aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
            aria-invalid={error ? 'true' : undefined}
            className={cn(
              `flex h-9 w-full appearance-none rounded-md border bg-white
               px-3 py-1 pr-8 text-sm shadow-sm
               transition-colors cursor-pointer
               focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1
               disabled:cursor-not-allowed disabled:opacity-50
               dark:bg-slate-900 dark:text-slate-50
               dark:focus:ring-slate-300 dark:focus:ring-offset-slate-950`,
              error
                ? 'border-red-400 dark:border-red-600'
                : 'border-slate-200 dark:border-slate-700',
              leftAddon && 'pl-9',
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map(o => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Chevron */}
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
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
Select.displayName = 'Select';
