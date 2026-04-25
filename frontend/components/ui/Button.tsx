/**
 * Button — Composant bouton polymorphique (Shadcn/ui style)
 *
 * Variants  : default | destructive | outline | ghost | link | secondary
 * Sizes     : sm | md | lg | icon
 * Props     : asChild (Radix Slot) | loading | leftIcon | rightIcon
 *
 * Dark mode : automatique via Tailwind dark: variants
 * WCAG      : aria-disabled si loading, focus-visible ring
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  // Base
  `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md
   text-sm font-medium ring-offset-white transition-colors
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2
   disabled:pointer-events-none disabled:opacity-50
   dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300`,
  {
    variants: {
      variant: {
        default:     'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200',
        primary:     'bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400',
        destructive: 'bg-red-600 text-white hover:bg-red-500 dark:bg-red-900 dark:hover:bg-red-800',
        outline:     'border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800 dark:hover:text-slate-50',
        secondary:   'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700',
        ghost:       'hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-50',
        link:        'text-slate-900 underline-offset-4 hover:underline dark:text-slate-50',
        amber:       'bg-amber-500 text-white hover:bg-amber-400 dark:hover:bg-amber-600',
      },
      size: {
        sm:   'h-8  px-3 text-xs',
        md:   'h-9  px-4 py-2',
        lg:   'h-11 px-8 text-base',
        icon: 'h-9  w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?:   boolean;
  loading?:   boolean;
  leftIcon?:  ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled ?? loading}
        aria-disabled={disabled ?? loading}
        {...props}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
        ) : leftIcon}
        {children}
        {!loading && rightIcon}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
