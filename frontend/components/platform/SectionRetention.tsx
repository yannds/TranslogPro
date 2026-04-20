/**
 * SectionRetention — cohortes D7/D30/D90 par mois de signup.
 *
 * Permission : data.platform.kpi.retention.read.global (SA + SUPPORT_L2).
 *
 * Affiche :
 *   - KPI moyens D7/D30/D90 (tous mois confondus)
 *   - Table cohorte par mois (YYYY-MM) avec heatmap colorée
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, SectionHeader, pctDisplay } from './kpi-shared';

interface CohortBucket {
  cohortMonth:        string;
  tenantsSignedUp:    number;
  activeD7:           number;
  activeD30:          number;
  activeD90:          number;
  retentionD7Pct:     number;
  retentionD30Pct:    number;
  retentionD90Pct:    number;
}

interface RetentionPayload {
  periodDays: number;
  cohorts:    CohortBucket[];
  overall:    { avgD7: number; avgD30: number; avgD90: number };
}

function heatClass(pct: number): string {
  if (pct >= 0.75) return 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200';
  if (pct >= 0.50) return 'bg-teal-500/20    text-teal-800    dark:text-teal-200';
  if (pct >= 0.25) return 'bg-amber-500/20   text-amber-800   dark:text-amber-200';
  return 'bg-red-500/20 text-red-800 dark:text-red-200';
}

export function SectionRetention() {
  const { t } = useI18n();
  const [days, setDays] = React.useState(90);
  const { data, loading } = useFetch<RetentionPayload>(`/api/platform/kpi/retention?days=${days}`);

  return (
    <section aria-labelledby="pk-retention">
      <SectionHeader
        id="pk-retention"
        icon={<RefreshCw className="w-4 h-4" />}
        title={t('platformKpi.retention.title') ?? 'Rétention cohortes'}
        extra={
          <select
            aria-label={t('platformKpi.filters.periodDays') ?? 'Période'}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent t-text px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <option value={90}>90j</option>
            <option value={180}>180j</option>
            <option value={365}>365j</option>
          </select>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiTile
          label={t('platformKpi.retention.avgD7') ?? 'Rétention J+7'}
          value={pctDisplay(data?.overall.avgD7)}
          hint={t('platformKpi.retention.avgD7Hint') ?? 'Moyenne sur toutes cohortes'}
          icon={<RefreshCw className="w-5 h-5" aria-hidden />}
          tone="teal"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.retention.avgD30') ?? 'Rétention J+30'}
          value={pctDisplay(data?.overall.avgD30)}
          hint={t('platformKpi.retention.avgD30Hint') ?? 'Moyenne sur toutes cohortes'}
          icon={<RefreshCw className="w-5 h-5" aria-hidden />}
          tone="emerald"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.retention.avgD90') ?? 'Rétention J+90'}
          value={pctDisplay(data?.overall.avgD90)}
          hint={t('platformKpi.retention.avgD90Hint') ?? 'Moyenne sur toutes cohortes'}
          icon={<RefreshCw className="w-5 h-5" aria-hidden />}
          tone="blue"
          loading={loading}
        />
      </div>

      {/* Table cohortes */}
      <div className="mt-4 t-card-bordered rounded-2xl p-5 overflow-x-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
          {t('platformKpi.retention.perCohort') ?? 'Par cohorte mensuelle'}
        </h3>
        <table className="w-full text-sm min-w-[600px]">
          <thead className="text-xs uppercase tracking-wider t-text-2 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th scope="col" className="text-left py-2 px-1">{t('platformKpi.retention.cohortMonth') ?? 'Cohorte'}</th>
              <th scope="col" className="text-right py-2 px-1">{t('platformKpi.retention.signups') ?? 'Signups'}</th>
              <th scope="col" className="text-right py-2 px-1">J+7</th>
              <th scope="col" className="text-right py-2 px-1">J+30</th>
              <th scope="col" className="text-right py-2 px-1">J+90</th>
            </tr>
          </thead>
          <tbody>
            {(data?.cohorts ?? []).map((c) => (
              <tr key={c.cohortMonth} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs t-text">{c.cohortMonth}</td>
                <td className="py-2 px-1 text-right tabular-nums t-text">{c.tenantsSignedUp}</td>
                <td className="py-2 px-1 text-right">
                  <span className={`tabular-nums text-xs font-semibold rounded px-1.5 py-0.5 ${heatClass(c.retentionD7Pct)}`}>
                    {pctDisplay(c.retentionD7Pct)}
                  </span>
                </td>
                <td className="py-2 px-1 text-right">
                  <span className={`tabular-nums text-xs font-semibold rounded px-1.5 py-0.5 ${heatClass(c.retentionD30Pct)}`}>
                    {pctDisplay(c.retentionD30Pct)}
                  </span>
                </td>
                <td className="py-2 px-1 text-right">
                  <span className={`tabular-nums text-xs font-semibold rounded px-1.5 py-0.5 ${heatClass(c.retentionD90Pct)}`}>
                    {pctDisplay(c.retentionD90Pct)}
                  </span>
                </td>
              </tr>
            ))}
            {(data?.cohorts ?? []).length === 0 && !loading && (
              <tr><td colSpan={5} className="py-3 text-center text-xs t-text-3">{t('platformKpi.common.noData') ?? 'Aucune donnée'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
