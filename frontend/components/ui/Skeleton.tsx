/**
 * Skeleton — Placeholders de chargement systématiques (Pulse CSS)
 *
 * Trois niveaux :
 *   <Skeleton />            → bloc générique (width/height via className)
 *   <SkeletonText lines={3} /> → lignes de texte simulées
 *   <SkeletonTable rows={5} cols={4} /> → tableau entier
 *
 * Dark mode : fond slate-200/dark:slate-700
 * WCAG : aria-hidden="true" + role="presentation"
 */
import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={cn(
        'animate-pulse rounded-md bg-slate-200 dark:bg-slate-700',
        className,
      )}
      {...props}
    />
  );
}

// ── SkeletonText ──────────────────────────────────────────────────────────────

interface SkeletonTextProps {
  lines?:     number;
  className?: string;
  /** Largeur de la dernière ligne (ex: "60%") pour effet naturel */
  lastLineWidth?: string;
}

export function SkeletonText({ lines = 3, className, lastLineWidth = '60%' }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true" role="presentation">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? lastLineWidth : '100%' }}
        />
      ))}
    </div>
  );
}

// ── SkeletonTable ─────────────────────────────────────────────────────────────

interface SkeletonTableProps {
  rows?:      number;
  cols?:      number;
  className?: string;
}

export function SkeletonTable({ rows = 5, cols = 4, className }: SkeletonTableProps) {
  return (
    <div className={cn('w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800', className)}
         aria-hidden="true" role="presentation">
      {/* Header */}
      <div className="flex gap-3 bg-slate-100 dark:bg-slate-800 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className={cn(
            'flex gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800',
            r % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50',
          )}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" style={{ opacity: 1 - c * 0.08 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
