/**
 * PageAnalytics — Tableaux analytiques multi-périodes.
 *
 * Source : GET /api/tenants/:id/analytics/board?period=7d|30d|90d
 * Tenant-scopé, devise lue depuis Tenant.currency (jamais hardcodée).
 *
 * UI : tokens sémantiques (.t-*), conforme WCAG 2.1 (AA), ARIA.
 */
import { useMemo, useState } from 'react';
import { Users, Ticket, Package, Loader2, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { MiniBarChart } from './MiniBarChart';
import type { ChartPoint } from './types';
import { useFetch } from '../../lib/hooks/useFetch';
import { useAuth }  from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { cn } from '../../lib/utils';

interface SegmentationData {
  total:         number;
  active:        number;
  inactive:      number;
  travelersOnly: number;
  shippersOnly:  number;
  both:          number;
}

interface MiniKpisDto {
  caTotal:        number;
  travelers:      number;
  parcels:        number;
  fillRate:       number;
  caDelta:        number;
  travelersDelta: number;
  parcelsDelta:   number;
  fillRateDelta:  number;
}

interface AnalyticsBoardDto {
  currency:         string;
  revenue:          ChartPoint[];
  passengersByLine: ChartPoint[];
  ticketsByChannel: ChartPoint[];
  parcelsByWeight:  ChartPoint[];
  miniKpis:         MiniKpisDto;
}

type PeriodKey = '7d' | '30d' | '90d';

// Formatage compact pour les mini-KPIs (ex: 48 200 000 → "48.2M").
// Pas de magic number éparpillé : seuils nommés.
const UNIT_MILLION = 1_000_000;
const UNIT_THOUSAND = 1_000;
function formatCompact(n: number): string {
  if (Math.abs(n) >= UNIT_MILLION)  return `${(n / UNIT_MILLION).toFixed(1)}M`;
  if (Math.abs(n) >= UNIT_THOUSAND) return `${(n / UNIT_THOUSAND).toFixed(1)}k`;
  return Math.round(n).toString();
}

// ─── Segmentation clients ────────────────────────────────────────────────────

function CustomerSegmentationWidget() {
  const { user } = useAuth();
  const { t } = useI18n();
  const url = user?.tenantId ? `/api/tenants/${user.tenantId}/analytics/customer-segmentation` : null;
  const { data, loading, error } = useFetch<SegmentationData>(url, [user?.tenantId]);

  return (
    <section
      aria-labelledby="analytics-seg-title"
      className="t-card-bordered rounded-2xl p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h3 id="analytics-seg-title" className="text-sm font-semibold t-text">{t('analytics.segTitle')}</h3>
      </div>
      {loading && (
        <div role="status" className="flex items-center gap-2 t-text-2 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span className="text-xs">{t('analytics.loading')}</span>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 py-2">{error}</p>}
      {data && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg t-surface px-3 py-2">
            <dt className="t-text-2">{t('analytics.totalCustomers')}</dt>
            <dd className="text-lg font-bold t-text tabular-nums">{data.total.toLocaleString('fr-FR')}</dd>
          </div>
          <div className="rounded-lg t-surface px-3 py-2">
            <dt className="t-text-2">{t('analytics.active')}</dt>
            <dd className="text-lg font-bold t-text tabular-nums">{data.active.toLocaleString('fr-FR')}</dd>
            <p className="text-[10px] t-text-3">{data.inactive.toLocaleString('fr-FR')} {t('analytics.inactive')}</p>
          </div>
          <div className="rounded-lg bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800/40 px-3 py-2">
            <dt>
              <Ticket className="w-3 h-3 text-teal-600 dark:text-teal-400 inline mb-0.5" aria-hidden="true" />
              <span className="text-teal-700 dark:text-teal-300 ml-1">{t('analytics.travelersOnly')}</span>
            </dt>
            <dd className="text-lg font-bold t-text tabular-nums">{data.travelersOnly.toLocaleString('fr-FR')}</dd>
          </div>
          <div className="rounded-lg bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800/40 px-3 py-2">
            <dt>
              <Package className="w-3 h-3 text-orange-600 dark:text-orange-400 inline mb-0.5" aria-hidden="true" />
              <span className="text-orange-700 dark:text-orange-300 ml-1">{t('analytics.shippersOnly')}</span>
            </dt>
            <dd className="text-lg font-bold t-text tabular-nums">{data.shippersOnly.toLocaleString('fr-FR')}</dd>
          </div>
          <div className="sm:col-span-2 rounded-lg bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800/40 px-3 py-2">
            <dt className="text-violet-700 dark:text-violet-300">{t('analytics.travelersAndShip')}</dt>
            <dd className="text-lg font-bold t-text tabular-nums">{data.both.toLocaleString('fr-FR')}</dd>
            <p className="text-[10px] t-text-2">
              {t('analytics.crossSellHint')}
            </p>
          </div>
        </dl>
      )}
    </section>
  );
}

// ─── Mini-KPI card ────────────────────────────────────────────────────────────

function MiniKpiCard({ label, value, delta }: { label: string; value: string; delta: number }) {
  const up = delta >= 0;
  return (
    <div className="t-card-bordered rounded-xl p-4">
      <p className="text-xs t-text-2 font-medium">{label}</p>
      <div className="flex items-end justify-between mt-1">
        <p className="text-2xl font-bold t-text tabular-nums">{value}</p>
        <span className={cn(
          'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded',
          up ? 't-delta-up' : 't-delta-down',
        )}>
          {up ? <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
              : <ArrowDownRight className="w-3 h-3" aria-hidden="true" />}
          {up ? '+' : ''}{delta.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageAnalytics() {
  const { operational } = useTenantConfig();
  const { t } = useI18n();
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>('7d');

  const url = user?.tenantId
    ? `/api/tenants/${user.tenantId}/analytics/board?period=${period}`
    : null;
  const { data, loading, error } = useFetch<AnalyticsBoardDto>(url, [user?.tenantId, period]);

  const periodLabel = useMemo<Record<PeriodKey, string>>(() => ({
    '7d': t('analytics.period7d'),
    '30d': t('analytics.period30d'),
    '90d': t('analytics.period90d'),
  }), [t]);

  const revenueLabelByPeriod: Record<PeriodKey, string> = {
    '7d': t('analytics.revenueLast7'),
    '30d': t('analytics.revenueLast30'),
    '90d': t('analytics.revenueLast90'),
  };

  const currencySymbol = operational.currencySymbol;

  const miniKpis = useMemo(() => {
    if (!data) return [];
    return [
      { label: t('analytics.totalRevenue'), value: formatCompact(data.miniKpis.caTotal),       delta: data.miniKpis.caDelta },
      { label: t('analytics.travelers'),    value: data.miniKpis.travelers.toLocaleString('fr-FR'), delta: data.miniKpis.travelersDelta },
      { label: t('analytics.parcels'),      value: data.miniKpis.parcels.toLocaleString('fr-FR'),   delta: data.miniKpis.parcelsDelta },
      { label: t('analytics.fillRate'),     value: `${data.miniKpis.fillRate}%`,                    delta: data.miniKpis.fillRateDelta },
    ];
  }, [data, t]);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold t-text">{t('analytics.title')}</h1>
          <p className="text-sm t-text-2 mt-1">{t('analytics.subtitle')}</p>
        </div>

        {/* Period selector */}
        <div
          role="tablist"
          aria-label={t('analytics.periodSelector')}
          className="inline-flex items-center gap-1 rounded-lg p-1 t-card-bordered overflow-x-auto max-w-full"
        >
          <Calendar className="w-4 h-4 t-text-3 ml-2 shrink-0" aria-hidden="true" />
          {(['7d', '30d', '90d'] as PeriodKey[]).map(p => {
            const active = period === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriod(p)}
                className={cn(
                  'shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  active
                    ? 'bg-teal-600 text-white'
                    : 't-text-body hover:bg-gray-100 dark:hover:bg-slate-800',
                )}
              >
                {periodLabel[p]}
              </button>
            );
          })}
        </div>
      </header>

      {/* Loader / error */}
      {loading && (
        <div role="status" className="flex items-center gap-2 t-text-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span className="text-xs">{t('analytics.loading')}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 py-2">{error}</p>
      )}

      {/* Mini KPIs */}
      {data && (
        <section aria-labelledby="analytics-kpis-title">
          <h2 id="analytics-kpis-title" className="sr-only">{t('analytics.kpisTitle')}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {miniKpis.map(k => <MiniKpiCard key={k.label} {...k} />)}
          </div>
        </section>
      )}

      {/* Charts */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section
            aria-labelledby="analytics-rev-title"
            className="t-card-bordered rounded-2xl p-5"
          >
            <h2 id="analytics-rev-title" className="sr-only">{revenueLabelByPeriod[period]}</h2>
            <MiniBarChart
              label={`${revenueLabelByPeriod[period]} (${currencySymbol} ×1M)`}
              data={data.revenue}
              unit={`M ${currencySymbol}`}
            />
          </section>

          <section
            aria-labelledby="analytics-pax-title"
            className="t-card-bordered rounded-2xl p-5"
          >
            <h2 id="analytics-pax-title" className="sr-only">{t('analytics.paxByLine')}</h2>
            <MiniBarChart
              label={t('analytics.paxByLine')}
              data={data.passengersByLine}
              unit=""
            />
          </section>

          <section
            aria-labelledby="analytics-channels-title"
            className="t-card-bordered rounded-2xl p-5"
          >
            <h2 id="analytics-channels-title" className="sr-only">{t('analytics.ticketsByChannel')}</h2>
            <MiniBarChart
              label={t('analytics.ticketsByChannel')}
              data={data.ticketsByChannel}
              unit="%"
            />
          </section>

          <section
            aria-labelledby="analytics-parcels-title"
            className="t-card-bordered rounded-2xl p-5"
          >
            <h2 id="analytics-parcels-title" className="sr-only">{t('analytics.parcelsByWeight')}</h2>
            <MiniBarChart
              label={t('analytics.parcelsByWeight')}
              data={data.parcelsByWeight}
              unit="%"
            />
          </section>

          <div className="lg:col-span-2">
            <CustomerSegmentationWidget />
          </div>
        </div>
      )}
    </div>
  );
}
