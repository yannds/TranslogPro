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
import { useId, type ChangeEvent, type ReactNode } from 'react';
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
  /** Alias React-natif. Si fourni, on synthétise un ChangeEvent avec
   * `target.checked` correctement positionné, en plus d'appeler
   * `onCheckedChange` si présent. */
  onChange?:     (e: ChangeEvent<HTMLInputElement>) => void;
  disabled?:     boolean;
  name?:         string;
  required?:     boolean;
  wrapperClass?: string;
  'aria-describedby'?: string;
}

export function Checkbox({
  id: idProp, label, hint, error, wrapperClass,
  onCheckedChange, onChange,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const id          = idProp ?? generatedId;

  const handleCheckedChange = (next: boolean) => {
    if (onCheckedChange) onCheckedChange(next);
    if (onChange) {
      // Synthétise un ChangeEvent minimal avec target.checked.
      // Suffisant pour tous les usages observés (lecture de e.target.checked).
      const synthetic = {
        target: { checked: next, name: props.name, type: 'checkbox' },
        currentTarget: { checked: next, name: props.name, type: 'checkbox' },
      } as unknown as ChangeEvent<HTMLInputElement>;
      onChange(synthetic);
    }
  };

  // Le `aria-describedby` interne (lié à hint/error) doit primer sur celui
  // passé par le caller, mais on le concatène pour ne pas perdre l'info
  // additionnelle que le caller voulait référencer.
  const internalDescribedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const externalDescribedBy = props['aria-describedby'];
  const mergedDescribedBy = [internalDescribedBy, externalDescribedBy]
    .filter(Boolean)
    .join(' ') || undefined;

  // Retire `aria-describedby` du spread pour éviter qu'il écrase le merge.
  const { 'aria-describedby': _ignored, ...restProps } = props;
  void _ignored;

  return (
    <div className={cn('flex flex-col gap-1', wrapperClass)}>
      <div className="flex items-start gap-2">
        <CheckboxPrimitive.Root
          id={id}
          aria-describedby={mergedDescribedBy}
          aria-invalid={error ? 'true' : undefined}
          onCheckedChange={(v) => handleCheckedChange(v === true)}
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
          {...restProps}
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
