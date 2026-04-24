/**
 * PageAiDemand — Prévisions de demande par ligne et créneau.
 *
 * Source : GET /api/tenants/:id/analytics/ai-demand?horizon=7d|14d|30d
 *
 * Méthodologie back :
 *   - forecast    : moyenne mobile par DOW sur 90j d'historique Ticket
 *   - lineForecasts : top 5 routes (30j) + trend vs 30j précédents + peak DOW/h
 *   - events      : jours fériés selon Tenant.country sur l'horizon
 *
 * UI : tokens sémantiques, compat light/dark, WCAG 2.1 AA, ARIA.
 */
import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Calendar, Sparkles, Loader2 } from 'lucide-react';
import { cn }           from '../../lib/utils';
import { useI18n }      from '../../lib/i18n/useI18n';
import { useAuth }      from '../../lib/auth/auth.context';
import { useFetch }     from '../../lib/hooks/useFetch';
import { MiniBarChart } from '../dashboard/MiniBarChart';
import type { ChartPoint } from '../dashboard/types';

type Horizon = '7d' | '14d' | '30d';

interface LineForecast {
  route: string;
  next7: number;
  trend: number;
  peak:  string;
  note:  string;
}

interface EventBlock {
  date:  string;
  label: string;
  level: 'high' | 'med' | 'low';
}

interface AiDemandDto {
  forecast:       ChartPoint[];
  lineForecasts:  LineForecast[];
  events:         EventBlock[];
}

const LEVEL_CLASS: Record<EventBlock['level'], string> = {
  high: 't-delta-up',
  med:  'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  low:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export function PageAiDemand() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [horizon, setHorizon] = useState<Horizon>('7d');

  const url = tenantId
    ? `/api/tenants/${tenantId}/analytics/ai-demand?horizon=${horizon}`
    : null;
  const { data, loading, error } = useFetch<AiDemandDto>(url, [tenantId, horizon]);

  const HORIZON_LABEL: Record<Horizon, string> = useMemo(() => ({
    '7d':  t('aiDemand.horizon7'),
    '14d': t('aiDemand.horizon14'),
    '30d': t('aiDemand.horizon30'),
  }), [t]);

  const forecast       = data?.forecast       ?? [];
  const lineForecasts  = data?.lineForecasts  ?? [];
  const events         = data?.events         ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <h1 className="text-2xl font-bold t-text">{t('aiDemand.title')}</h1>
          </div>
          <p className="text-sm t-text-2 mt-1">{t('aiDemand.subtitle')}</p>
        </div>
        <div
          role="tablist"
          aria-label={t('aiDemand.horizonLabel')}
          className="inline-flex items-center gap-1 rounded-lg p-1 t-card-bordered overflow-x-auto max-w-full"
        >
          <Calendar className="w-4 h-4 t-text-3 ml-2 shrink-0" aria-hidden="true" />
          {(['7d', '14d', '30d'] as Horizon[]).map(h => {
            const active = horizon === h;
            return (
              <button
                key={h}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setHorizon(h)}
                className={cn(
                  'shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  active ? 'bg-teal-600 text-white' : 't-text-body hover:bg-gray-100 dark:hover:bg-slate-800',
                )}
              >
                {HORIZON_LABEL[h]}
              </button>
            );
          })}
        </div>
      </header>

      {loading && (
        <div role="status" className="flex items-center gap-2 t-text-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span className="text-xs">{t('aiDemand.loading')}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 py-2">{error}</p>
      )}

      {/* Forecast chart */}
      {!loading && (
        <section
          aria-labelledby="ai-demand-chart-title"
          className="t-card-bordered rounded-2xl p-5"
        >
          <h2 id="ai-demand-chart-title" className="sr-only">{t('aiDemand.chartTitle')}</h2>
          {forecast.length === 0 ? (
            <p className="text-sm t-text-2 text-center py-8">{t('aiDemand.empty')}</p>
          ) : (
            <MiniBarChart
              label={`${t('aiDemand.chartTitle')} — ${HORIZON_LABEL[horizon]}`}
              data={forecast}
              unit={t('aiDemand.unitPax')}
            />
          )}
        </section>
      )}

      {/* Par ligne */}
      {!loading && lineForecasts.length > 0 && (
        <section aria-labelledby="ai-demand-lines-title">
          <h2 id="ai-demand-lines-title" className="text-sm font-semibold t-text mb-3">{t('aiDemand.byLineTitle')}</h2>
          <div className="grid gap-3" role="list">
            {lineForecasts.map(l => {
              const up = l.trend >= 0;
              return (
                <article
                  key={l.route}
                  role="listitem"
                  aria-labelledby={`ai-demand-${l.route}`}
                  className="t-card-bordered rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span id={`ai-demand-${l.route}`} className="font-bold t-text break-words">{l.route}</span>
                      <span className="text-xs t-text-3">{t('aiDemand.peak')}: {l.peak}</span>
                    </div>
                    <p className="t-text-body text-sm break-words">{l.note}</p>
                  </div>
                  <div className="flex gap-4 sm:gap-6 items-center shrink-0">
                    <div className="text-right">
                      <p className="text-xl font-bold t-text tabular-nums">{l.next7.toLocaleString('fr-FR')}</p>
                      <p className="text-[10px] t-text-3 uppercase">{t('aiDemand.next7')}</p>
                    </div>
                    <span className={cn(
                      'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full',
                      up ? 't-delta-up' : 't-delta-down',
                    )}>
                      {up ? <TrendingUp className="w-3 h-3" aria-hidden="true" />
                          : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                      {up ? '+' : ''}{l.trend.toFixed(1)}%
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Événements */}
      {!loading && events.length > 0 && (
        <section aria-labelledby="ai-demand-events-title">
          <h2 id="ai-demand-events-title" className="text-sm font-semibold t-text mb-3">{t('aiDemand.eventsTitle')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {events.map((e, i) => (
              <li key={`${e.date}-${i}`} className="t-card-bordered rounded-xl p-3 flex items-center gap-3 min-w-0">
                <Calendar className="w-4 h-4 t-text-3 shrink-0" aria-hidden="true" />
                <span className="text-xs font-mono t-text-2 shrink-0">{e.date}</span>
                <span className="t-text-body text-sm flex-1 break-words min-w-0">{e.label}</span>
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase', LEVEL_CLASS[e.level])}>
                  {t(`aiDemand.level_${e.level}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
