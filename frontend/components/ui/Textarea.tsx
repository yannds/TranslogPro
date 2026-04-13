/**
 * Textarea — Zone de texte multi-ligne accessible
 *
 * Auto-resize optionnel (resize CSS: vertical | both | none)
 * Compteur de caractères (showCount + maxLength)
 */
import React, { forwardRef, type TextareaHTMLAttributes, useId, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?:       string;
  hint?:        string;
  error?:       string;
  showCount?:   boolean;
  autoResize?:  boolean;
  wrapperClass?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({
    className, label, hint, error, showCount, autoResize, wrapperClass,
    id: idProp, maxLength, onChange, ...props
  }, forwardedRef) => {
    const generatedId = useId();
    const id          = idProp ?? generatedId;
    const innerRef    = useRef<HTMLTextAreaElement>(null);

    // Merge refs
    const ref = (node: HTMLTextAreaElement | null) => {
      (innerRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    };

    // Auto-resize handler
    const resize = () => {
      const el = innerRef.current;
      if (!el || !autoResize) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };

    useEffect(() => { resize(); });

    const currentLen = String(props.value ?? '').length;

    return (
      <div className={cn('flex flex-col gap-1', wrapperClass)}>
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
            {props.required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
          </label>
        )}

        <textarea
          ref={ref}
          id={id}
          maxLength={maxLength}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={error ? 'true' : undefined}
          onChange={e => { resize(); onChange?.(e); }}
          className={cn(
            `flex min-h-[80px] w-full rounded-md border bg-white px-3 py-2 text-sm
             shadow-sm placeholder:text-slate-400 transition-colors
             focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1
             disabled:cursor-not-allowed disabled:opacity-50
             dark:bg-slate-900 dark:text-slate-50 dark:placeholder:text-slate-600
             dark:focus:ring-slate-300`,
            error
              ? 'border-red-400 dark:border-red-600'
              : 'border-slate-200 dark:border-slate-700',
            autoResize && 'resize-none overflow-hidden',
            className,
          )}
          {...props}
        />

        <div className="flex items-start justify-between gap-2">
          <div>
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
          {showCount && maxLength && (
            <span className={cn(
              'shrink-0 text-xs tabular-nums',
              currentLen >= maxLength ? 'text-red-500' : 'text-slate-400',
            )}>
              {currentLen}/{maxLength}
            </span>
          )}
        </div>
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
