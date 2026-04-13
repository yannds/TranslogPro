/**
 * Card — Conteneur visuel avec zones Header / Content / Footer
 *
 * Composition :
 *   <Card>
 *     <CardHeader heading="Mon titre" description="Sous-titre optionnel" action={<Button>…</Button>} />
 *     <CardContent>…</CardContent>
 *     <CardFooter>…</CardFooter>
 *   </Card>
 *
 * Variants : default | flat | bordered
 * Dark mode : automatique
 */
import { type HTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const cardVariants = cva('rounded-xl transition-shadow', {
  variants: {
    variant: {
      default:  'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800',
      flat:     'bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800',
      bordered: 'bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

// ── Sub-composants ────────────────────────────────────────────────────────────

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  heading?:     ReactNode;
  description?: ReactNode;
  action?:      ReactNode;   // Slot bouton haut-droit
}

export function CardHeader({ className, heading, description, action, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100 dark:border-slate-800',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {heading && (
          <h3 className="font-semibold leading-snug text-slate-900 dark:text-slate-50 truncate">
            {heading}
          </h3>
        )}
        {description && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-6 py-3 border-t border-slate-100 dark:border-slate-800',
        className,
      )}
      {...props}
    />
  );
}
