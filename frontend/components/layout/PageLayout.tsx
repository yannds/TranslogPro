/**
 * PageLayout — Template de page standardisé (DRY)
 *
 * Structure :
 *   <header>  — Titre + breadcrumb + actions header
 *   <main>    — Contenu principal
 *   <aside>   — Panneau latéral optionnel (filtres, résumé)
 *
 * Props :
 *   title       : H1 de la page (WCAG landmark)
 *   subtitle    : texte sous le titre
 *   breadcrumbs : fil d'Ariane [{ label, href? }]
 *   actions     : slot boutons haut-droit
 *   aside       : contenu panneau latéral
 *   loading     : affiche SkeletonTable + SkeletonText
 *
 * Responsive : aside → dessous sur mobile, droite sur ≥lg
 */
import { type ReactNode } from 'react';
import { cn }                from '../../lib/utils';
import { SkeletonTable, SkeletonText } from '../ui/Skeleton';
import { ThemeToggle }       from '../theme/ThemeProvider';

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageLayoutProps {
  title:        string;
  subtitle?:    string;
  breadcrumbs?: Breadcrumb[];
  actions?:     ReactNode;
  children:     ReactNode;
  aside?:       ReactNode;
  loading?:     boolean;
  className?:   string;
}

export function PageLayout({
  title, subtitle, breadcrumbs, actions, children, aside, loading, className,
}: PageLayoutProps) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950', className)}>

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div className="mx-auto max-w-screen-xl px-4 sm:px-6">

          {/* Breadcrumb */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Fil d'Ariane" className="pt-3">
              <ol className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {breadcrumbs.map((b, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden>/</span>}
                    {b.href
                      ? <a href={b.href} className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors">{b.label}</a>
                      : <span className={i === breadcrumbs.length - 1 ? 'font-medium text-slate-700 dark:text-slate-200' : ''}>{b.label}</span>
                    }
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {/* Titre + actions */}
          <div className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions}
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      {/* ── Contenu ───────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-screen-xl flex-1 px-4 sm:px-6 py-6">
        {loading ? (
          <div className="space-y-4">
            <SkeletonText lines={2} className="max-w-sm" />
            <SkeletonTable rows={8} cols={5} />
          </div>
        ) : aside ? (
          <div className="flex flex-col gap-6 lg:flex-row">
            <main className="min-w-0 flex-1" role="main">
              {children}
            </main>
            <aside className="w-full lg:w-72 xl:w-80 shrink-0" aria-label="Panneau latéral">
              {aside}
            </aside>
          </div>
        ) : (
          <main role="main">
            {children}
          </main>
        )}
      </div>
    </div>
  );
}

// ── Variante minimale sans nav (modales, forms simples) ────────────────────────

interface PlainPageProps {
  children:   ReactNode;
  className?: string;
  maxWidth?:  'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

const MAX_W: Record<NonNullable<PlainPageProps['maxWidth']>, string> = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-xl',
  '2xl': 'max-w-2xl',
  full: 'max-w-full',
};

export function PlainPage({ children, className, maxWidth = 'full' }: PlainPageProps) {
  return (
    <div className={cn(
      'mx-auto w-full px-4 sm:px-6 py-6',
      MAX_W[maxWidth],
      className,
    )}>
      {children}
    </div>
  );
}
