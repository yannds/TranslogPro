/**
 * PageSeasonality — KPI saisonniers (Sprint 4).
 *
 * Affiche les agrégats `SeasonalAggregate` avec règle YoY progressive :
 *   - Historique < 30j       → banner "Données insuffisantes"
 *   - Historique 1-3 mois    → mensuel seul, badge "Période courte"
 *   - Historique 3-12 mois   → comparaisons M-1 / M-3
 *   - Historique ≥ 12 mois   → YoY débloqué
 *   - Historique ≥ 24 mois   → tendance pluriannuelle
 *
 * Endpoint : GET /api/tenants/:tid/analytics/seasonality?periodType=...
 * Permission : data.stats.read.tenant (TENANT_ADMIN, ACCOUNTANT).
 */
import { useMemo, useState } from 'react';
import { CalendarRange, TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { MiniBarChart } from '../dashboard/MiniBarChart';

type HistoryWindow = 'INSUFFICIENT' | 'SHORT' | 'MEDIUM' | 'YOY' | 'MULTI_YEAR';
type PeriodType = 'YEAR' | 'MONTH' | 'WEEKEND' | 'WEEKDAY';

interface SeasonalRow {
  id:              string;
  routeId:         string | null;
  periodType:      PeriodType;
  periodKey:       string;
  periodStartAt:   string;
  ticketsSold:     number;
  revenueTotal:    number;
  tripCount:       number;
  profitableCount: number;
  deficitCount:    number;
  fillRateAvg:     number;
  netMarginAvg:    number;
  vsPreviousPct:   number | null;
  vsLastYearPct:   number | null;
}

interface QueryResponse {
  window: {
    window:        HistoryWindow;
    firstTripDate: string | null;
    daysOfHistory: number;
    yoyAvailable:  boolean;
  };
  rows: SeasonalRow[];
}

function formatMoney(n: number, currency: string): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)} ${currency}`;
}

function formatPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}

function pctColor(p: number | null | undefined): string {
  if (p === null || p === undefined) return 'text-slate-400';
  if (p >= 5)  return 'text-green-700 dark:text-green-400';
  if (p <= -5) return 'text-red-700 dark:text-red-400';
  return 'text-slate-500 dark:text-slate-400';
}

function PctTrend({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  const Icon = value >= 5 ? TrendingUp : value <= -5 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 ${pctColor(value)}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {formatPct(value)}
    </span>
  );
}

export function PageSeasonality() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { operational } = useTenantConfig();
  const currency = operational.currency;

  const [periodType, setPeriodType] = useState<PeriodType>('MONTH');
  const [recomputing, setRecomputing] = useState(false);

  const { data, loading, error, refetch } = useFetch<QueryResponse>(
    tenantId
      ? `/api/tenants/${tenantId}/analytics/seasonality?periodType=${periodType}&routeId=null`
      : null,
  );

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      await apiGet(`/api/tenants/${tenantId}/analytics/seasonality/recompute`);
      refetch();
    } finally {
      setRecomputing(false);
    }
  };

  const window: HistoryWindow = data?.window.window ?? 'INSUFFICIENT';
  const yoyAvailable = data?.window.yoyAvailable ?? false;
  const rows = useMemo(() => (data?.rows ?? []).slice(-24), [data]); // Max 24 périodes affichées

  // Format label période selon type
  const labelFor = (row: SeasonalRow): string => {
    const d = new Date(row.periodStartAt);
    if (periodType === 'YEAR')   return row.periodKey;
    if (periodType === 'MONTH')  {
      return d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { month: 'short', year: '2-digit' });
    }
    return row.periodKey;
  };

  const chartData = rows.map(r => ({ label: labelFor(r), value: Math.round(r.revenueTotal) }));

  // Recommandation dérivée (ex: "Décembre 2026 +32% vs 2025 → ajouter trips")
  const recommendation = useMemo(() => {
    if (!yoyAvailable || rows.length === 0) return null;
    const withYoy = rows.filter(r => r.vsLastYearPct != null);
    if (withYoy.length === 0) return null;
    const peak = withYoy.reduce((a, b) =>
      (b.vsLastYearPct ?? 0) > (a.vsLastYearPct ?? 0) ? b : a,
    );
    const trough = withYoy.reduce((a, b) =>
      (b.vsLastYearPct ?? 0) < (a.vsLastYearPct ?? 0) ? b : a,
    );
    return { peak, trough };
  }, [rows, yoyAvailable]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CalendarRange className="w-6 h-6" aria-hidden />
            {t('seasonality.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('seasonality.subtitle')}
          </p>
        </div>
        <Button variant="outline" onClick={handleRecompute} disabled={recomputing}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${recomputing ? 'animate-spin' : ''}`} aria-hidden />
          {recomputing ? t('seasonality.recomputing') : t('seasonality.recompute')}
        </Button>
      </header>

      {/* Banner historique */}
      {data && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${
            window === 'INSUFFICIENT'
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
          }`}
        >
          {window === 'INSUFFICIENT' && <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />}
          <div>
            <strong>{t(`seasonality.window_${window}`)}</strong>
            {data.window.firstTripDate && (
              <span className="ml-2 text-xs opacity-80">
                ({t('seasonality.historyDays', { days: String(data.window.daysOfHistory) })})
              </span>
            )}
            <p className="text-xs mt-1 opacity-90">{t(`seasonality.windowHint_${window}`)}</p>
          </div>
        </div>
      )}

      {/* Sélecteur periodType */}
      <div role="tablist" className="flex gap-2 flex-wrap">
        {(['MONTH', 'YEAR', 'WEEKEND', 'WEEKDAY'] as PeriodType[]).map(pt => (
          <button
            key={pt}
            role="tab"
            aria-selected={periodType === pt}
            onClick={() => setPeriodType(pt)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
              periodType === pt
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {t(`seasonality.period_${pt}`)}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-700">
          {String(error)}
        </div>
      )}

      {loading && <div className="text-sm text-slate-500">{t('common.loading')}</div>}

      {!loading && window !== 'INSUFFICIENT' && rows.length > 0 && (
        <>
          {/* Graphique */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
            <MiniBarChart
              label={t('seasonality.chartTitle')}
              data={chartData}
              unit={currency}
            />
          </div>

          {/* Table détaillée */}
          <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colPeriod')}</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colTrips')}</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colTickets')}</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colRevenue')}</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colFillRate')}</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colVsPrev')}</th>
                  {yoyAvailable && (
                    <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t('seasonality.colVsYoY')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{labelFor(r)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{r.tripCount}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{r.ticketsSold}</td>
                    <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">{formatMoney(r.revenueTotal, currency)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{(r.fillRateAvg * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right"><PctTrend value={r.vsPreviousPct} /></td>
                    {yoyAvailable && (
                      <td className="px-3 py-2 text-right"><PctTrend value={r.vsLastYearPct} /></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recommandations dérivées YoY */}
          {recommendation && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('seasonality.recommendationsTitle')}
              </h3>
              {recommendation.peak.vsLastYearPct != null && recommendation.peak.vsLastYearPct > 10 && (
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <Badge variant="success">{t('seasonality.tagPeak')}</Badge>{' '}
                  {t('seasonality.recPeak', {
                    period: labelFor(recommendation.peak),
                    pct: formatPct(recommendation.peak.vsLastYearPct),
                  })}
                </p>
              )}
              {recommendation.trough.vsLastYearPct != null && recommendation.trough.vsLastYearPct < -10 && (
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <Badge variant="outline">{t('seasonality.tagTrough')}</Badge>{' '}
                  {t('seasonality.recTrough', {
                    period: labelFor(recommendation.trough),
                    pct: formatPct(recommendation.trough.vsLastYearPct),
                  })}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {!loading && rows.length === 0 && window !== 'INSUFFICIENT' && (
        <div className="text-sm text-slate-500 italic text-center py-8">
          {t('seasonality.empty')}
        </div>
      )}
    </div>
  );
}
