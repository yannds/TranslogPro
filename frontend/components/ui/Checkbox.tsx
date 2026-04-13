/**
 * Checkbox — Case à cocher accessible (Radix CheckboxRoot + label)
 *
 * Props :
 *   label   : texte visible à droite
 *   hint    : description sous le label
 *   error   : message d'erreur react-hook-form
 *   checked : controllé ou non
 *
 * WCAG : role="checkbox", aria-checked, focus-visible ring
 */
import React, { useId, type ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cn } from '../../lib/utils';

export interface CheckboxProps {
  id?:           string;
  label?:        ReactNode;
  hint?:         string;
  error?:        string;
  checked?:      boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?:     boolean;
  name?:         string;
  required?:     boolean;
  wrapperClass?: string;
}

export function Checkbox({
  id: idProp, label, hint, error, wrapperClass, ...props
}: CheckboxProps) {
  const generatedId = useId();
  const id          = idProp ?? generatedId;

  return (
    <div className={cn('flex flex-col gap-1', wrapperClass)}>
      <div className="flex items-start gap-2">
        <CheckboxPrimitive.Root
          id={id}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            `peer h-4 w-4 shrink-0 rounded border
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2
             disabled:cursor-not-allowed disabled:opacity-50
             data-[state=checked]:bg-slate-900 data-[state=checked]:border-slate-900
             data-[state=checked]:text-white
             dark:border-slate-600 dark:data-[state=checked]:bg-slate-50
             dark:data-[state=checked]:border-slate-50 dark:data-[state=checked]:text-slate-900
             dark:focus-visible:ring-slate-300`,
            error ? 'border-red-400 dark:border-red-600' : 'border-slate-300',
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
              <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>

        {label && (
          <label
            htmlFor={id}
            className="cursor-pointer text-sm leading-none text-slate-700 dark:text-slate-300 peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          >
            {label}
            {props.required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
          </label>
        )}
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-500 dark:text-red-400 ml-6">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400 ml-6">
          {hint}
        </p>
      )}
    </div>
  );
}
