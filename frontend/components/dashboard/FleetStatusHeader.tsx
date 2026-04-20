/**
 * FleetStatusHeader — Synthèse flotte (Sprint 5).
 *
 * Widget placé au-dessus de PageFleetVehicles. Affiche :
 *   - 3 compteurs : actifs / maintenance / hors-service
 *   - Liste top 5 bus sous-utilisés (< anomalyFillRateFloor sur 7j)
 *
 * Données : GET /analytics/fleet-summary (réutilise AnalyticsService).
 * Seuil sous-utilisation : lu depuis TenantBusinessConfig (DRY / zéro magic number).
 */

import { useMemo } from 'react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiCard } from './KpiCard';

interface FleetSummary {
  total: number;
  byStatus: { active: number; maintenance: number; offline: number };
  underutilized: Array<{
    busId:         string;
    plateNumber:   string;
    model:         string;
    tripCount7d:   number;
    utilization7d: number;
  }>;
  underutilizedThreshold: number;
}

export function FleetStatusHeader({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const url = tenantId ? `/api/tenants/${tenantId}/analytics/fleet-summary` : null;
  const deps = useMemo(() => [tenantId], [tenantId]);
  const { data, loading, error } = useFetch<FleetSummary>(url, deps);

  if (loading || error || !data) return null;

  const { total, byStatus, underutilized, underutilizedThreshold } = data;

  return (
    <section aria-labelledby="fleet-status-title" className="space-y-4">
      <h2 id="fleet-status-title" className="sr-only">{t('fleetOverview.title')}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon="Bus"
          accent="emerald"
          label={t('fleetOverview.active')}
          value={byStatus.active.toString()}
          sub={`${total} ${t('fleetOverview.total')}`}
        />
        <KpiCard
          icon="Wrench"
          accent="amber"
          label={t('fleetOverview.maintenance')}
          value={byStatus.maintenance.toString()}
          sub={total > 0 ? `${Math.round((byStatus.maintenance / total) * 100)}%` : '—'}
        />
        <KpiCard
          icon="XCircle"
          accent={byStatus.offline > 0 ? 'red' : 'blue'}
          label={t('fleetOverview.offline')}
          value={byStatus.offline.toString()}
          sub={total > 0 ? `${Math.round((byStatus.offline / total) * 100)}%` : '—'}
        />
      </div>

      {underutilized.length > 0 && (
        <div className="t-card-bordered rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">
              {t('fleetOverview.underutilizedTitle')}
            </p>
            <span className="text-[10px] t-text-3">
              {t('fleetOverview.belowThreshold')} {Math.round(underutilizedThreshold * 100)}%
            </span>
          </div>
          <ul className="space-y-2">
            {underutilized.map(b => {
              const pct = Math.round(b.utilization7d * 100);
              return (
                <li key={b.busId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold t-text truncate">{b.plateNumber}</p>
                    <p className="text-xs t-text-3 truncate">{b.model} · {b.tripCount7d} {t('fleetOverview.trips7d')}</p>
                  </div>
                  <div
                    className="w-24 bg-gray-200 dark:bg-slate-800 rounded-full h-2"
                    role="progressbar"
                    aria-label={`${b.plateNumber} — ${pct}%`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="bg-amber-500 h-2 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold t-text-2 tabular-nums w-10 text-right">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
