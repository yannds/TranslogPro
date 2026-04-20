/**
 * SectionNorthStar — % opérations gérées via la plateforme.
 *
 * Toggle 3 modes : Déclaratif | Heuristique | Comparé.
 * Si un tenant n'a pas déclaré d'estimation, le mode heuristique prend le
 * relais automatiquement (capacité flotte × taux cible d'occupation).
 *
 * Permission : data.platform.kpi.adoption.read.global (accessible SA + L1 + L2)
 */
import React from 'react';
import { Compass } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, SectionHeader, pctDisplay } from './kpi-shared';

type Mode = 'declarative' | 'heuristic' | 'compared';

interface TenantEntry {
  tenantId:    string;
  tenantName:  string;
  tenantSlug:  string;
  appliedMode: Mode;
  declarative: null | {
    tickets:   { actual: number; estimated: number; pct: number };
    trips:     { actual: number; estimated: number; pct: number };
    incidents: { actual: number; estimated: number; pct: number };
  };
  heuristic: null | {
    tickets: { actual: number; theoretical: number; pct: number };
    trips:   { actual: number; theoretical: number; pct: number };
  };
}

interface NorthStarPayload {
  mode:            Mode;
  periodDays:      number;
  targetOccupancy: number;
  global: {
    pctViaSaasAvg: number | null;
    tenantsCovered: number;
    tenantsMissing: number;
  };
  perTenant: TenantEntry[];
}

export function SectionNorthStar() {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<Mode>('compared');
  const [days, setDays] = React.useState(30);

  const { data, loading } = useFetch<NorthStarPayload>(
    `/api/platform/kpi/north-star?mode=${mode}&days=${days}`,
  );

  return (
    <section aria-labelledby="pk-northstar">
      <SectionHeader
        id="pk-northstar"
        icon={<Compass className="w-4 h-4" />}
        title={t('platformKpi.northStar.title') ?? 'North Star'}
        extra={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs" role="tablist" aria-label={t('platformKpi.northStar.modeAria') ?? 'Mode de calcul'}>
              {(['declarative', 'heuristic', 'compared'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                    mode === m
                      ? 'bg-teal-600 text-white'
                      : 'bg-transparent t-text-2 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {t(`platformKpi.mode.${m}`) ?? m}
                </button>
              ))}
            </div>
            <select
              aria-label={t('platformKpi.filters.periodDays') ?? 'Période'}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent t-text px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <option value={7}>7j</option>
              <option value={30}>30j</option>
              <option value={90}>90j</option>
            </select>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label={t('platformKpi.northStar.globalPct') ?? '% ops via SaaS'}
          value={pctDisplay(data?.global.pctViaSaasAvg)}
          hint={t('platformKpi.northStar.globalPctHint') ?? 'Moyenne pondérée tous tenants couverts'}
          icon={<Compass className="w-5 h-5" aria-hidden />}
          tone="teal"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.northStar.tenantsCovered') ?? 'Tenants couverts'}
          value={data?.global.tenantsCovered ?? 0}
          hint={`${data?.global.tenantsMissing ?? 0} ${t('platformKpi.northStar.missing') ?? 'manquants'}`}
          icon={<Compass className="w-5 h-5" aria-hidden />}
          tone="emerald"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.northStar.targetOccupancy') ?? 'Occupation cible'}
          value={pctDisplay(data?.targetOccupancy ?? 0)}
          hint={t('platformKpi.northStar.targetOccupancyHint') ?? 'Config kpi.targetOccupancyRate'}
          icon={<Compass className="w-5 h-5" aria-hidden />}
          tone="slate"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.northStar.periodDays') ?? 'Période'}
          value={`${days}j`}
          hint={t('platformKpi.northStar.periodDaysHint') ?? 'Fenêtre d\'analyse'}
          icon={<Compass className="w-5 h-5" aria-hidden />}
          tone="blue"
          loading={loading}
        />
      </div>

      {/* Table tenants */}
      <div className="mt-4 t-card-bordered rounded-2xl p-5 overflow-x-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
          {t('platformKpi.northStar.perTenant') ?? 'Par tenant'}
        </h3>
        <table className="w-full text-sm min-w-[600px]" role="table">
          <thead className="text-xs uppercase tracking-wider t-text-2 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th scope="col" className="text-left py-2 px-1">{t('platformKpi.northStar.tenant') ?? 'Tenant'}</th>
              <th scope="col" className="text-right py-2 px-1">{t('platformKpi.northStar.ticketsPct') ?? 'Billets %'}</th>
              <th scope="col" className="text-right py-2 px-1">{t('platformKpi.northStar.tripsPct') ?? 'Trajets %'}</th>
              <th scope="col" className="text-right py-2 px-1">{t('platformKpi.northStar.incidentsPct') ?? 'Incidents %'}</th>
              <th scope="col" className="text-left py-2 px-1">{t('platformKpi.northStar.appliedMode') ?? 'Mode appliqué'}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.perTenant ?? []).map((r) => {
              const ticketsPct   = r.declarative?.tickets.pct   ?? r.heuristic?.tickets.pct ?? null;
              const tripsPct     = r.declarative?.trips.pct     ?? r.heuristic?.trips.pct   ?? null;
              const incidentsPct = r.declarative?.incidents.pct ?? null;
              return (
                <tr key={r.tenantId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="py-2 px-1">
                    <div className="flex flex-col">
                      <span className="font-medium t-text truncate">{r.tenantName}</span>
                      <span className="text-xs t-text-3 font-mono">{r.tenantSlug}</span>
                    </div>
                  </td>
                  <td className="py-2 px-1 text-right tabular-nums t-text">{pctDisplay(ticketsPct)}</td>
                  <td className="py-2 px-1 text-right tabular-nums t-text">{pctDisplay(tripsPct)}</td>
                  <td className="py-2 px-1 text-right tabular-nums t-text">{pctDisplay(incidentsPct)}</td>
                  <td className="py-2 px-1 text-xs">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold
                      ${r.appliedMode === 'declarative' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' : ''}
                      ${r.appliedMode === 'heuristic'   ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : ''}
                      ${r.appliedMode === 'compared'    ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' : ''}`}>
                      {t(`platformKpi.mode.${r.appliedMode}`) ?? r.appliedMode}
                    </span>
                  </td>
                </tr>
              );
            })}
            {(data?.perTenant ?? []).length === 0 && !loading && (
              <tr><td colSpan={5} className="py-3 text-center text-xs t-text-3">{t('platformKpi.common.noData') ?? 'Aucune donnée'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
