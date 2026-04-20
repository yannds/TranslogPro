/**
 * ExecutiveSummaryBanner — Bandeau "Aujourd'hui" pour le gérant/tenant-admin.
 *
 * Appelle /api/tenants/:tenantId/analytics/today-summary et affiche :
 *   - 4 KPI réels (CA jour, Billets, Colis, Incidents)
 *   - Graphique CA 7j (MiniBarChart réutilisé)
 *   - Bandeau "Alertes anomalies" (badge rouge si seuils tenant dépassés)
 *   - Actions rapides (liens vers rapports / prix / alertes)
 *
 * Seuils lus depuis TenantBusinessConfig (anomaly*Threshold, anomalyFillRateFloor) —
 * affichés dans les alertes pour transparence. Zéro magic number côté front.
 *
 * Se monte au-dessus des KPIs gated-by-perm de PageDashboard pour enrichir,
 * pas remplacer (DRY strict — KpiCard et MiniBarChart inchangés).
 *
 * Visible seulement si user.permissions.includes('control.stats.read.tenant').
 * Le parent filtre déjà par permission — pas de check redondant ici.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { KpiCard } from './KpiCard';
import { MiniBarChart } from './MiniBarChart';
import { useFetch } from '../../lib/hooks/useFetch';
import { useRealtimeEvents } from '../../lib/hooks/useRealtimeEvents';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';

// Types d'événements qui doivent déclencher un refresh du bandeau exécutif.
// DRY : défini ici, référencé par le hook useRealtimeEvents.
const EXEC_DASH_EVENT_TYPES = [
  'ticket.issued',
  'ticket.cancelled',
  'incident.created',
  'incident.resolved',
  'cashregister.closed',
  'trip.completed',
];

interface TodaySummary {
  today: {
    revenue:            number;
    ticketsSold:        number;
    parcelsRegistered:  number;
    openIncidents:      number;
    openRegisters:      number;
    discrepancyCount:   number;
    activeTrips:        number;
    fillRate:           number;
    fillRateTripsCount: number;
  };
  revenue7d: Array<{ label: string; value: number }>;
  thresholds: { incident: number; discrepancy: number; fillRate: number };
  alerts: { incidentAlert: boolean; discrepancyAlert: boolean; fillRateAlert: boolean };
}

export interface ExecutiveSummaryBannerProps {
  tenantId: string;
  /** Refresh interval en ms. Défaut 60 000 (1 min). 0 désactive. */
  refreshMs?: number;
}

export function ExecutiveSummaryBanner({ tenantId, refreshMs = 60_000 }: ExecutiveSummaryBannerProps) {
  const { t } = useI18n();
  const fmt = useCurrencyFormatter();
  const [refreshTick, setRefreshTick] = useState(0);
  const url = tenantId ? `/api/tenants/${tenantId}/analytics/today-summary` : null;
  const deps = useMemo(() => [tenantId, refreshMs, refreshTick], [tenantId, refreshMs, refreshTick]);
  const { data, error, loading } = useFetch<TodaySummary>(url, deps);

  // Realtime : refresh débouncé sur événements cross-rôles (Sprint 6).
  // Tous les événements qui changent la vue du gérant déclenchent un re-fetch
  // après 800ms (évite le spam de requêtes sur burst d'events).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEvent = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setRefreshTick(n => n + 1), 800);
  }, []);
  useRealtimeEvents(tenantId, onEvent, { types: EXEC_DASH_EVENT_TYPES });

  if (loading || error || !data) return null; // Le reste du dashboard reste visible

  const { today, revenue7d, thresholds, alerts } = data;
  const hasAnyAlert = alerts.incidentAlert || alerts.discrepancyAlert || alerts.fillRateAlert;
  void refreshMs; // TODO re-fetch hook: useFetch currently doesn't accept interval — handled at app level

  // Graphique : mini barres sur CA 7 derniers jours (labels YYYY-MM-DD → DD/MM)
  const chartData = revenue7d.map(d => ({
    label: d.label.slice(5).replace('-', '/'),
    value: d.value,
  }));

  const fillRatePct = Math.round(today.fillRate * 100);

  return (
    <section aria-labelledby="exec-summary-title" className="space-y-4">
      <h2 id="exec-summary-title" className="sr-only">{t('execDash.title')}</h2>

      {/* Bandeau alertes anomalies */}
      {hasAnyAlert && (
        <div
          className="t-card-bordered rounded-2xl p-4 border-red-300/60 dark:border-red-800/40 bg-red-50/60 dark:bg-red-900/10"
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-bold text-red-700 dark:text-red-300">{t('execDash.anomalyTitle')}</p>
              <ul className="text-xs t-text-2 space-y-0.5">
                {alerts.incidentAlert && (
                  <li>
                    • <strong>{today.openIncidents}</strong> {t('execDash.incidentsOpen')}
                    {' '}({t('execDash.threshold')}: {thresholds.incident})
                  </li>
                )}
                {alerts.discrepancyAlert && (
                  <li>
                    • <strong>{today.discrepancyCount}</strong> {t('execDash.cashDiscrepancies')}
                    {' '}({t('execDash.threshold')}: {thresholds.discrepancy})
                  </li>
                )}
                {alerts.fillRateAlert && (
                  <li>
                    • {t('execDash.fillRateLow')}: <strong>{fillRatePct}%</strong>
                    {' '}({t('execDash.threshold')}: {Math.round(thresholds.fillRate * 100)}%)
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 4 KPI réels "Aujourd'hui" */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon="Landmark"
          accent="amber"
          label={t('execDash.kpiRevenue')}
          value={fmt(today.revenue)}
          sub={t('execDash.kpiRevenueSub')}
        />
        <KpiCard
          icon="Ticket"
          accent="emerald"
          label={t('execDash.kpiTickets')}
          value={today.ticketsSold.toLocaleString()}
          sub={today.activeTrips + ' ' + t('execDash.activeTrips')}
        />
        <KpiCard
          icon="BarChart3"
          accent="teal"
          label={t('execDash.kpiFillRate')}
          value={`${fillRatePct}%`}
          sub={`${today.fillRateTripsCount} ${t('execDash.tripsCounted')}`}
          delta={{ value: `${fillRatePct}%`, up: today.fillRate >= thresholds.fillRate }}
        />
        <KpiCard
          icon="AlertTriangle"
          accent={today.openIncidents > 0 ? 'red' : 'blue'}
          label={t('execDash.kpiIncidents')}
          value={today.openIncidents.toString()}
          sub={`${today.discrepancyCount} ${t('execDash.cashIssues')}`}
        />
      </div>

      {/* Graphique CA 7j + actions rapides */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 t-card-bordered rounded-2xl p-5">
          <MiniBarChart label={t('execDash.revenue7d')} data={chartData} />
        </div>
        <div className={cn('t-card-bordered rounded-2xl p-5 space-y-3')}>
          <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('execDash.quickActions')}</p>
          <div className="grid grid-cols-1 gap-2">
            <Link to="/admin/reports" className="t-link-card px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between">
              {t('execDash.actionReports')}
              <span aria-hidden="true">→</span>
            </Link>
            <Link to="/admin/settings/rules" className="t-link-card px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between">
              {t('execDash.actionRules')}
              <span aria-hidden="true">→</span>
            </Link>
            <Link to="/admin/cash-discrepancies" className="t-link-card px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between">
              {t('execDash.actionCashDiscrepancies')}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
