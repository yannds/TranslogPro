/**
 * SectionStrategic — KPI stratégiques pour comité / investisseur.
 *
 * Permission : data.platform.kpi.adoption.read.global (SA + L1 + L2).
 *
 * Affiche :
 *   - Dépendance SaaS (proxy = North Star moyen)
 *   - Nombre moyen d'actions par user / semaine (via AuditLog)
 *   - Sessions moyennes par user / semaine (via DailyActiveUser.sessionsCount)
 *   - Top 10 tenants actifs (nb actions AuditLog dans la période)
 */
import React from 'react';
import { Target, Activity, Building2 } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, SectionHeader, pctDisplay } from './kpi-shared';

interface StrategicPayload {
  periodDays:             number;
  avgActionsPerUserWeek:  number;
  avgSessionsPerUserWeek: number;
  saasDependencyPct:      number | null;
  topActiveTenants: Array<{
    tenantId:    string;
    tenantName:  string;
    actionsCount: number;
  }>;
}

export function SectionStrategic() {
  const { t } = useI18n();
  const [days, setDays] = React.useState(7);
  const { data, loading } = useFetch<StrategicPayload>(`/api/platform/kpi/strategic?days=${days}`);

  return (
    <section aria-labelledby="pk-strategic">
      <SectionHeader
        id="pk-strategic"
        icon={<Target className="w-4 h-4" />}
        title={t('platformKpi.strategic.title') ?? 'KPI stratégiques'}
        extra={
          <select
            aria-label={t('platformKpi.filters.periodDays') ?? 'Période'}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent t-text px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <option value={7}>7j</option>
            <option value={14}>14j</option>
            <option value={30}>30j</option>
          </select>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiTile
          label={t('platformKpi.strategic.saasDependency') ?? 'Dépendance SaaS'}
          value={pctDisplay(data?.saasDependencyPct)}
          hint={t('platformKpi.strategic.saasDependencyHint') ?? '% opérations critiques via SaaS'}
          icon={<Target className="w-5 h-5" aria-hidden />}
          tone="purple"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.strategic.actionsWeek') ?? 'Actions / user / sem.'}
          value={data?.avgActionsPerUserWeek ?? 0}
          hint={t('platformKpi.strategic.actionsWeekHint') ?? 'Signal engagement'}
          icon={<Activity className="w-5 h-5" aria-hidden />}
          tone="teal"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.strategic.sessionsWeek') ?? 'Sessions / user / sem.'}
          value={data?.avgSessionsPerUserWeek ?? 0}
          hint={t('platformKpi.strategic.sessionsWeekHint') ?? 'Fréquence retour'}
          icon={<Activity className="w-5 h-5" aria-hidden />}
          tone="blue"
          loading={loading}
        />
      </div>

      <div className="mt-4 t-card-bordered rounded-2xl p-5 overflow-x-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
          {t('platformKpi.strategic.topActive') ?? 'Top tenants actifs'}
        </h3>
        <table className="w-full text-sm min-w-[400px]">
          <thead className="text-xs uppercase tracking-wider t-text-2 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th scope="col" className="text-left py-2 px-1">{t('platformKpi.strategic.rank') ?? 'Rang'}</th>
              <th scope="col" className="text-left py-2 px-1">{t('platformKpi.strategic.tenant') ?? 'Tenant'}</th>
              <th scope="col" className="text-right py-2 px-1">{t('platformKpi.strategic.actions') ?? 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.topActiveTenants ?? []).map((r, i) => (
              <tr key={r.tenantId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 text-xs font-mono t-text-3">#{i + 1}</td>
                <td className="py-2 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 shrink-0 t-text-3" aria-hidden />
                    <span className="font-medium t-text truncate">{r.tenantName}</span>
                  </div>
                </td>
                <td className="py-2 px-1 text-right tabular-nums font-semibold t-text">{r.actionsCount.toLocaleString()}</td>
              </tr>
            ))}
            {(data?.topActiveTenants ?? []).length === 0 && !loading && (
              <tr><td colSpan={3} className="py-3 text-center text-xs t-text-3">{t('platformKpi.common.noData') ?? 'Aucune donnée'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
