/**
 * Badge — Indicateur de statut coloré
 *
 * Variants : default | success | warning | danger | info | outline
 * Tailles  : sm | md
 *
 * Usage :
 *   <Badge variant="success">CONFIRMÉ</Badge>
 *   <Badge variant="warning" size="sm">EN ATTENTE</Badge>
 *
 * Mapping statuts métier → variant :
 *   statusToVariant('CONFIRMED') → 'success'
 */
import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full font-semibold uppercase tracking-wide border',
  {
    variants: {
      variant: {
        default:     'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
        success:     'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
        warning:     'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
        danger:      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
        info:        'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
        outline:     'bg-transparent text-slate-700 border-slate-300 dark:text-slate-300 dark:border-slate-600',
      },
      size: {
        sm: 'text-[10px] px-2 py-0.5',
        md: 'text-xs px-2.5 py-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

// ── Helper : statut métier → variant badge ────────────────────────────────────

const STATUS_MAP: Record<string, BadgeProps['variant']> = {
  // Success
  CONFIRMED: 'success', DELIVERED: 'success', BOARDED: 'success',
  VERIFIED: 'success', ARRIVED: 'success', ACTIVE: 'success', PAID: 'success',
  // Warning
  PENDING: 'warning', PENDING_PAYMENT: 'warning', PACKED: 'warning',
  LOADED: 'warning', IN_TRANSIT: 'warning', OPEN: 'warning', PROCESSING: 'warning',
  // Danger
  CANCELLED: 'danger', REFUNDED: 'danger', DAMAGED: 'danger', LOST: 'danger',
  REJECTED: 'danger', EXPIRED: 'danger',
  // Info
  DRAFT: 'info', SCHEDULED: 'info', PAUSED: 'info',
};

export function statusToVariant(status: string): BadgeProps['variant'] {
  return STATUS_MAP[status] ?? 'default';
}

/** Badge prêt-à-l'emploi pour les statuts métier */
export function StatusBadge({ status, size }: { status: string; size?: BadgeProps['size'] }) {
  return (
    <Badge variant={statusToVariant(status)} size={size}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
