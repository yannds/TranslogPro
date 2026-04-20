/**
 * AccountingTodayHeader — Résumé comptable du jour (Sprint 5).
 *
 * Placé au-dessus de PageCashier pour que le comptable voit en un coup d'œil :
 *   - Ventes du jour (CA)
 *   - Écart caisse global / seuil
 *   - Nb caisses ouvertes
 *   - Bandeau rouge si discrepancyAlert true
 *
 * Data source : GET /analytics/today-summary (DRY — même endpoint que le
 * dashboard gérant, filtré scope si AGENCY_MANAGER).
 */

import { useMemo } from 'react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiCard } from './KpiCard';

interface TodaySummary {
  today: {
    revenue:          number;
    ticketsSold:      number;
    openRegisters:    number;
    discrepancyCount: number;
  };
  thresholds: { discrepancy: number };
  alerts: { discrepancyAlert: boolean };
}

export function AccountingTodayHeader({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const fmt = useCurrencyFormatter();
  const url = tenantId ? `/api/tenants/${tenantId}/analytics/today-summary` : null;
  const deps = useMemo(() => [tenantId], [tenantId]);
  const { data, loading, error } = useFetch<TodaySummary>(url, deps);

  if (loading || error || !data) return null;

  const { today, thresholds, alerts } = data;

  return (
    <section aria-labelledby="accounting-today-title" className="space-y-4">
      <h2 id="accounting-today-title" className="sr-only">{t('accountingToday.title')}</h2>

      {alerts.discrepancyAlert && (
        <div
          className="t-card-bordered rounded-2xl p-4 border-red-300/60 dark:border-red-800/40 bg-red-50/60 dark:bg-red-900/10"
          role="alert"
        >
          <p className="text-sm font-bold text-red-700 dark:text-red-300">
            {t('accountingToday.alertTitle')}
          </p>
          <p className="text-xs t-text-2 mt-1">
            <strong>{today.discrepancyCount}</strong> {t('accountingToday.discrepancyDescribe')}
            {' '}({t('accountingToday.threshold')}: {thresholds.discrepancy})
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon="Landmark"
          accent="amber"
          label={t('accountingToday.revenue')}
          value={fmt(today.revenue)}
          sub={`${today.ticketsSold} ${t('accountingToday.tickets')}`}
        />
        <KpiCard
          icon="CreditCard"
          accent="teal"
          label={t('accountingToday.openRegisters')}
          value={today.openRegisters.toString()}
          sub={t('accountingToday.currentlyOpen')}
        />
        <KpiCard
          icon="AlertTriangle"
          accent={today.discrepancyCount > 0 ? 'red' : 'emerald'}
          label={t('accountingToday.discrepanciesLabel')}
          value={today.discrepancyCount.toString()}
          sub={`${t('accountingToday.last30Days')} · ${t('accountingToday.threshold')} ${thresholds.discrepancy}`}
        />
      </div>
    </section>
  );
}
