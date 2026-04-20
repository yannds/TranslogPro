/**
 * SectionMrrBreakdown — MRR + expansion revenue + ventilation par plan.
 *
 * Permission : data.platform.kpi.business.read.global (SUPER_ADMIN only).
 * Les sous-composants sont masqués si l'appelant n'a pas la permission :
 * le backend renvoie 403 → useFetch data=null → la section ne monte pas.
 *
 * Affiche :
 *   - MRR par devise (total)
 *   - ARR par devise
 *   - ARPU par devise (tenants payants uniquement)
 *   - Net New MRR (new + expansion - contraction - churn)
 *   - Croissance MoM
 *   - Tableau ventilation par plan
 */
import React from 'react';
import { Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, SectionHeader, formatCurrencyMap, pctDisplay } from './kpi-shared';

interface MrrPayload {
  periodDays: number;
  currencyReference: string;
  totals: {
    mrr:           Record<string, number>;
    arr:           Record<string, number>;
    arpu:          Record<string, number>;
    activeTenants: number;
    payingTenants: number;
  };
  growth: {
    momPct:              number | null;
    newRevenue:          Record<string, number>;
    expansionRevenue:    Record<string, number>;
    contractionRevenue:  Record<string, number>;
    churnRevenue:        Record<string, number>;
    netNewMrr:           Record<string, number>;
  };
  byChangeType: Array<{ type: string; count: number; amountByCurrency: Record<string, number> }>;
  byPlan:       Array<{ planId: string; planSlug: string; activeTenants: number; mrrByCurrency: Record<string, number> }>;
}

export function SectionMrrBreakdown() {
  const { t } = useI18n();
  const [days, setDays] = React.useState(30);
  const { data, loading } = useFetch<MrrPayload>(`/api/platform/kpi/mrr?days=${days}`);

  const momUp = (data?.growth.momPct ?? 0) >= 0;

  return (
    <section aria-labelledby="pk-mrr">
      <SectionHeader
        id="pk-mrr"
        icon={<Wallet className="w-4 h-4" />}
        title={t('platformKpi.mrr.title') ?? 'Business & Traction'}
        extra={
          <select
            aria-label={t('platformKpi.filters.periodDays') ?? 'Période'}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent t-text px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <option value={30}>30j</option>
            <option value={60}>60j</option>
            <option value={90}>90j</option>
          </select>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label={t('platformKpi.mrr.mrrLabel') ?? 'MRR'}
          value={data ? formatCurrencyMap(data.totals.mrr, 0) : '—'}
          hint={t('platformKpi.mrr.mrrHint') ?? 'Revenu récurrent mensuel normalisé'}
          icon={<Wallet className="w-5 h-5" aria-hidden />}
          tone="teal"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.mrr.arr') ?? 'ARR'}
          value={data ? formatCurrencyMap(data.totals.arr, 0) : '—'}
          hint={t('platformKpi.mrr.arrHint') ?? 'MRR × 12'}
          icon={<Wallet className="w-5 h-5" aria-hidden />}
          tone="blue"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.mrr.arpu') ?? 'ARPU'}
          value={data ? formatCurrencyMap(data.totals.arpu, 0) : '—'}
          hint={`${data?.totals.payingTenants ?? 0} ${t('platformKpi.mrr.payingTenants') ?? 'tenants payants'}`}
          icon={<Wallet className="w-5 h-5" aria-hidden />}
          tone="emerald"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.mrr.mom') ?? 'Croissance MoM'}
          value={pctDisplay(data?.growth.momPct)}
          hint={t('platformKpi.mrr.momHint') ?? 'Vs période précédente'}
          icon={momUp ? <TrendingUp className="w-5 h-5" aria-hidden /> : <TrendingDown className="w-5 h-5" aria-hidden />}
          tone={momUp ? 'emerald' : 'red'}
          loading={loading}
        />
      </div>

      {/* Net New MRR breakdown */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="t-card-bordered rounded-2xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
            {t('platformKpi.mrr.netNew') ?? 'Net New MRR'}
          </h3>
          <dl className="space-y-2 text-sm">
            <Row label={t('platformKpi.mrr.newRevenue') ?? 'New'} value={formatCurrencyMap(data?.growth.newRevenue ?? {}, 0)} tone="emerald" />
            <Row label={t('platformKpi.mrr.expansion') ?? 'Expansion'} value={formatCurrencyMap(data?.growth.expansionRevenue ?? {}, 0)} tone="teal" />
            <Row label={t('platformKpi.mrr.contraction') ?? 'Contraction'} value={`− ${formatCurrencyMap(data?.growth.contractionRevenue ?? {}, 0)}`} tone="amber" />
            <Row label={t('platformKpi.mrr.churn') ?? 'Churn'} value={`− ${formatCurrencyMap(data?.growth.churnRevenue ?? {}, 0)}`} tone="red" />
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <Row label={t('platformKpi.mrr.netTotal') ?? 'Net'} value={formatCurrencyMap(data?.growth.netNewMrr ?? {}, 0)} tone="teal" bold />
            </div>
          </dl>
        </div>
        <div className="t-card-bordered rounded-2xl p-5 overflow-x-auto">
          <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
            {t('platformKpi.mrr.byPlan') ?? 'Par plan'}
          </h3>
          <table className="w-full text-sm min-w-[320px]">
            <thead className="text-xs uppercase tracking-wider t-text-2 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th scope="col" className="text-left py-2 px-1">{t('platformKpi.mrr.plan') ?? 'Plan'}</th>
                <th scope="col" className="text-right py-2 px-1">{t('platformKpi.mrr.tenants') ?? 'Tenants'}</th>
                <th scope="col" className="text-right py-2 px-1">MRR</th>
              </tr>
            </thead>
            <tbody>
              {(data?.byPlan ?? []).map((p) => (
                <tr key={p.planId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="py-2 px-1 font-medium t-text">{p.planSlug}</td>
                  <td className="py-2 px-1 text-right tabular-nums t-text">{p.activeTenants}</td>
                  <td className="py-2 px-1 text-right tabular-nums t-text">{formatCurrencyMap(p.mrrByCurrency, 0)}</td>
                </tr>
              ))}
              {(data?.byPlan ?? []).length === 0 && !loading && (
                <tr><td colSpan={3} className="py-3 text-center text-xs t-text-3">{t('platformKpi.common.noData') ?? 'Aucune donnée'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const ROW_TONE: Record<string, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-400',
  teal:    'text-teal-700 dark:text-teal-400',
  amber:   'text-amber-700 dark:text-amber-400',
  red:     'text-red-700 dark:text-red-400',
};

function Row({ label, value, tone, bold }: { label: string; value: string; tone: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={`text-xs uppercase tracking-wider ${bold ? 'font-semibold t-text' : 't-text-2'}`}>{label}</dt>
      <dd className={`tabular-nums ${bold ? 'font-bold text-base' : 'text-sm'} ${ROW_TONE[tone] ?? 't-text'}`}>{value}</dd>
    </div>
  );
}
