/**
 * PageAiPricing — Tarifs dynamiques recommandés (yield management).
 * Source : GET /api/tenants/:id/analytics/ai-pricing (TripAnalytics 30j)
 *
 * UI : tokens sémantiques, compat light/dark, WCAG 2.1 AA, ARIA.
 * Devise lue depuis le TenantConfig (jamais hardcodée).
 */
import { useMemo, useState } from 'react';
import { Zap, TrendingUp, TrendingDown, Sparkles, PlayCircle } from 'lucide-react';
import { cn }              from '../../lib/utils';
import { useI18n }         from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { useFetch }        from '../../lib/hooks/useFetch';
import { useAuth }         from '../../lib/auth/auth.context';
import type { PricingSuggestion } from '../dashboard/types';

export function PageAiPricing() {
  const { t } = useI18n();
  const { operational } = useTenantConfig();
  const { user } = useAuth();
  const tenantId = user?.effectiveTenantId;

  const { data, loading, error } = useFetch<PricingSuggestion[]>(
    tenantId ? `/api/tenants/${tenantId}/analytics/ai-pricing` : null,
    [tenantId],
  );

  const suggestions = data ?? [];
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const fmt = useMemo(
    () => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
    [],
  );

  const toggle = (id: string) => {
    setApplied(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalImpact = useMemo(
    () => suggestions
      .filter(s => applied.has(s.id))
      .reduce((acc, s) => acc + s.revenueImpact, 0),
    [applied, suggestions],
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <h1 className="text-2xl font-bold t-text">{t('aiPricing.title')}</h1>
        </div>
        <p className="text-sm t-text-2 mt-1">{t('aiPricing.subtitle')}</p>
      </header>

      {/* Résumé simulation */}
      <section
        aria-labelledby="ai-pricing-sim-title"
        className="t-card-bordered rounded-2xl p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="ai-pricing-sim-title" className="text-sm font-semibold t-text flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              {t('aiPricing.simTitle')}
            </h2>
            <p className="text-xs t-text-2 mt-1">{t('aiPricing.simDesc')}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] uppercase t-text-3 tracking-wider">{t('aiPricing.simAppliedCount')}</p>
              <p className="text-xl font-bold t-text tabular-nums">{applied.size} / {suggestions.length}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase t-text-3 tracking-wider">{t('aiPricing.simImpact')}</p>
              <p className={cn(
                'text-xl font-bold tabular-nums',
                totalImpact >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
              )}>
                {totalImpact >= 0 ? '+' : ''}{totalImpact.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Liste des suggestions */}
      <section aria-labelledby="ai-pricing-list-title">
        <h2 id="ai-pricing-list-title" className="text-sm font-semibold t-text mb-3">{t('aiPricing.suggestionsTitle')}</h2>

        {loading && (
          <div className="grid gap-3" aria-busy="true">
            {[1, 2, 3].map(i => (
              <div key={i} className="t-card-bordered rounded-2xl p-5 h-24 animate-pulse bg-gray-100 dark:bg-slate-800" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 text-center py-8" role="alert">{error}</p>
        )}

        {!loading && !error && suggestions.length === 0 && (
          <p className="text-sm t-text-2 text-center py-8">{t('aiPricing.empty')}</p>
        )}

        {!loading && !error && suggestions.length > 0 && (
          <div className="grid gap-3" role="list">
            {suggestions.map(s => {
              const up   = s.suggested > s.currentFare;
              const isOn = applied.has(s.id);
              return (
                <article
                  key={s.id}
                  role="listitem"
                  aria-labelledby={`ai-pricing-${s.id}`}
                  className={cn(
                    'rounded-2xl p-4 sm:p-5 border transition-colors',
                    isOn
                      ? 'border-teal-400 bg-teal-50/50 dark:border-teal-700 dark:bg-teal-900/20'
                      : 't-card-bordered',
                  )}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span id={`ai-pricing-${s.id}`} className="font-bold t-text break-words">{s.route}</span>
                        <span className="text-xs t-text-3">{s.slot}</span>
                        <span className={cn(
                          'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full',
                          up ? 't-delta-up' : 't-delta-down',
                        )}>
                          {up
                            ? <TrendingUp className="w-3 h-3" aria-hidden="true" />
                            : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                          {up ? '+' : ''}{(((s.suggested - s.currentFare) / s.currentFare) * 100).toFixed(1)}%
                        </span>
                        <span className="text-xs t-text-3">{t('aiPricing.fillRate')}: {s.fillRate}%</span>
                      </div>
                      <p className="t-text-body text-sm break-words">{s.rationale}</p>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4 shrink-0 flex-wrap">
                      <div className="text-right">
                        <p className="text-[10px] uppercase t-text-3 tracking-wider">{t('aiPricing.current')}</p>
                        <p className="text-sm t-text-body tabular-nums">
                          {fmt.format(s.currentFare)} {operational.currencySymbol}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase t-text-3 tracking-wider">{t('aiPricing.suggested')}</p>
                        <p className="text-base font-bold t-text tabular-nums">
                          {fmt.format(s.suggested)} {operational.currencySymbol}
                        </p>
                      </div>
                      <div
                        className="text-right"
                        role="progressbar"
                        aria-valuenow={s.confidence}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${t('aiPricing.confidence')} ${s.route}`}
                      >
                        <p className="text-[10px] uppercase t-text-3 tracking-wider">{t('aiPricing.confidence')}</p>
                        <p className={cn(
                          'text-base font-bold tabular-nums',
                          s.confidence >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                            : s.confidence >= 60 ? 'text-amber-600 dark:text-amber-500'
                            : 'text-red-600 dark:text-red-400',
                        )}>
                          {s.confidence}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggle(s.id)}
                        aria-pressed={isOn}
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                          isOn
                            ? 'bg-teal-600 text-white hover:bg-teal-700'
                            : 'border t-border t-text-body hover:bg-gray-100 dark:hover:bg-slate-800',
                        )}
                      >
                        <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                        {isOn ? t('aiPricing.applied') : t('aiPricing.apply')}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
