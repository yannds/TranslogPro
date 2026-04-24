/**
 * PageAiRoutes — Recommandations IA sur la rentabilité des lignes.
 * Source : GET /api/tenants/:id/analytics/ai-routes (TripAnalytics 90j)
 *
 * UI : tokens sémantiques (.t-*), compat light/dark, conforme WCAG 2.1 AA.
 * A11y : chaque carte est un <article> étiqueté, score encodé en progressbar.
 */
import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Sparkles, Filter as FilterIcon } from 'lucide-react';
import { cn }          from '../../lib/utils';
import { useI18n }     from '../../lib/i18n/useI18n';
import { useFetch }    from '../../lib/hooks/useFetch';
import { useAuth }     from '../../lib/auth/auth.context';
import type { AiRoute } from './types';

type FilterKey = 'all' | 'good' | 'warn' | 'bad';

function scoreTier(score: number): FilterKey {
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

const SCORE_CLASS: Record<FilterKey, string> = {
  all:  '',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-500',
  bad:  'text-red-600 dark:text-red-400',
};

export function PageAiRoutes() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.effectiveTenantId;

  const { data, loading, error } = useFetch<AiRoute[]>(
    tenantId ? `/api/tenants/${tenantId}/analytics/ai-routes` : null,
    [tenantId],
  );

  const routes = data ?? [];
  const [filter, setFilter] = useState<FilterKey>('all');

  const visible = useMemo(
    () => filter === 'all' ? routes : routes.filter(r => scoreTier(r.score) === filter),
    [filter, routes],
  );

  const FILTER_LABEL: Record<FilterKey, string> = {
    all:  t('aiRoutes.filterAll'),
    good: t('aiRoutes.filterGood'),
    warn: t('aiRoutes.filterWarn'),
    bad:  t('aiRoutes.filterBad'),
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <h1 className="text-2xl font-bold t-text">{t('aiRoutes.title')}</h1>
          </div>
          <p className="text-sm t-text-2 mt-1">{t('aiRoutes.subtitle')}</p>
        </div>

        <div
          role="tablist"
          aria-label={t('aiRoutes.filter')}
          className="inline-flex items-center gap-1 rounded-lg p-1 t-card-bordered overflow-x-auto max-w-full"
        >
          <FilterIcon className="w-4 h-4 t-text-3 ml-2 shrink-0" aria-hidden="true" />
          {(['all', 'good', 'warn', 'bad'] as FilterKey[]).map(f => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={cn(
                  'shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  active
                    ? 'bg-teal-600 text-white'
                    : 't-text-body hover:bg-gray-100 dark:hover:bg-slate-800',
                )}
              >
                {FILTER_LABEL[f]}
              </button>
            );
          })}
        </div>
      </header>

      {loading && (
        <div className="grid gap-4" aria-busy="true">
          {[1, 2, 3].map(i => (
            <div key={i} className="t-card-bordered rounded-2xl p-5 h-24 animate-pulse bg-gray-100 dark:bg-slate-800" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 text-center py-8" role="alert">{error}</p>
      )}

      {!loading && !error && (
        <div className="grid gap-4" role="list">
          {visible.map((r, i) => {
            const tier       = scoreTier(r.score);
            const isPositive = r.marge.startsWith('+');
            return (
              <article
                key={r.route + i}
                role="listitem"
                aria-labelledby={`ai-route-title-${i}`}
                className="t-card-bordered rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span id={`ai-route-title-${i}`} className="font-bold t-text text-lg">{r.route}</span>
                      <span className={cn(
                        'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full',
                        isPositive ? 't-delta-up' : 't-delta-down',
                      )}>
                        {isPositive
                          ? <TrendingUp className="w-3 h-3" aria-hidden="true" />
                          : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                        {r.marge} {t('aiRoutes.margin')}
                      </span>
                      <span className="text-xs t-text-3">{r.fillRate}% {t('aiRoutes.fillRate')}</span>
                    </div>
                    <p className="t-text-body text-sm">{r.conseil}</p>
                  </div>
                  <div
                    className="shrink-0 text-right"
                    role="progressbar"
                    aria-valuenow={r.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${t('aiRoutes.score')} ${r.route}`}
                  >
                    <div className={cn('text-3xl font-black tabular-nums', SCORE_CLASS[tier])}>
                      {r.score}
                    </div>
                    <div className="text-xs t-text-3">{t('aiRoutes.score')}</div>
                  </div>
                </div>
              </article>
            );
          })}
          {visible.length === 0 && !loading && (
            <p className="text-sm t-text-2 text-center py-8">{t('aiRoutes.emptyFilter')}</p>
          )}
        </div>
      )}
    </div>
  );
}
