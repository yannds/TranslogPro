/**
 * Dialog — Modale accessible (Radix Dialog)
 *
 * Props :
 *   open / onOpenChange : contrôle externe
 *   trigger             : déclencheur (bouton)
 *   title, description  : textes accessibles (aria)
 *   size                : sm | md | lg | xl | full
 *   footer              : slot bas de modale (boutons confirm/cancel)
 *
 * WCAG : focus trap, aria-modal, role="dialog", Escape pour fermer
 */
import { type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const dialogContentVariants = cva(
  `fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2
   rounded-xl bg-white dark:bg-slate-900
   shadow-2xl border border-slate-200 dark:border-slate-800
   focus:outline-none
   data-[state=open]:animate-in data-[state=closed]:animate-out
   data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0
   data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95
   data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]
   data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]
   max-h-[90vh] overflow-y-auto`,
  {
    variants: {
      size: {
        sm:    'w-full max-w-sm',
        md:    'w-full max-w-md',
        lg:    'w-full max-w-lg',
        xl:    'w-full max-w-2xl',
        '2xl': 'w-[95vw] max-w-5xl',
        '3xl': 'w-[95vw] max-w-6xl',
        full:  'w-[95vw] max-w-none',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface DialogProps extends VariantProps<typeof dialogContentVariants> {
  open?:          boolean;
  onOpenChange?:  (open: boolean) => void;
  trigger?:       ReactNode;
  title:          string;
  description?:   string;
  children:       ReactNode;
  footer?:        ReactNode;
  hideCloseButton?: boolean;
}

export function Dialog({
  open, onOpenChange, trigger, title, description, children, footer,
  size, hideCloseButton,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogPrimitive.Trigger asChild>
          {trigger}
        </DialogPrimitive.Trigger>
      )}

      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay
          className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
            data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0`}
        />

        {/* Content — Radix gère aria-labelledby/aria-describedby automatiquement
            à partir des composants Title/Description présents en descendance. */}
        <DialogPrimitive.Content className={cn(dialogContentVariants({ size }))}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-slate-900 dark:text-slate-50">
                {title}
              </DialogPrimitive.Title>
              {description
                ? (
                  <DialogPrimitive.Description className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {description}
                  </DialogPrimitive.Description>
                )
                : (
                  // Description obligatoire selon Radix : on la masque visuellement si non fournie.
                  <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                )}
            </div>
            {!hideCloseButton && (
              <DialogPrimitive.Close
                className={`shrink-0 rounded-md p-1 text-slate-400 hover:text-slate-600
                  dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2
                  focus-visible:ring-slate-900 dark:focus-visible:ring-slate-300
                  transition-colors`}
                aria-label="Fermer"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M12 4 4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </DialogPrimitive.Close>
            )}
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
