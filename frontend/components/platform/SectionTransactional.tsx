/**
 * SectionTransactional — activité transactionnelle cross-tenant.
 *
 * Permission : data.platform.kpi.adoption.read.global (SA + L1 + L2).
 * Note : GMV (montants) est filtré côté service pour rester informatif sans
 * révéler l'exact revenue business. Les KPI "count" (tickets, trajets) sont
 * toujours visibles.
 */
import React from 'react';
import { Ticket, BusFront, Package, Clock } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, SectionHeader, Sparkline, formatCurrencyMap, pctDisplay } from './kpi-shared';

interface TransactionalPayload {
  periodDays: number;
  tickets: {
    total: number;
    gmv:   Record<string, number>;
    avgTicketPrice: Record<string, number>;
    pctDigital: number;
    pctOffline: number;
  };
  trips: {
    totalPlanned:   number;
    totalCompleted: number;
    totalCancelled: number;
    onTimePct:      number | null;
  };
  parcels: {
    total:      number;
    delivered:  number;
  };
  perDay: Array<{ date: string; tickets: number; trips: number }>;
}

export function SectionTransactional() {
  const { t } = useI18n();
  const [days, setDays] = React.useState(30);
  const { data, loading } = useFetch<TransactionalPayload>(`/api/platform/kpi/transactional?days=${days}`);

  return (
    <section aria-labelledby="pk-transactional">
      <SectionHeader
        id="pk-transactional"
        icon={<Ticket className="w-4 h-4" />}
        title={t('platformKpi.transactional.title') ?? 'Activité transactionnelle'}
        extra={
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
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label={t('platformKpi.transactional.ticketsSold') ?? 'Billets vendus'}
          value={data?.tickets.total ?? 0}
          hint={`${pctDisplay(data?.tickets.pctDigital)} ${t('platformKpi.transactional.digital') ?? 'digital'}`}
          icon={<Ticket className="w-5 h-5" aria-hidden />}
          tone="teal"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.transactional.gmv') ?? 'GMV'}
          value={data ? formatCurrencyMap(data.tickets.gmv, 0) : '—'}
          hint={t('platformKpi.transactional.gmvHint') ?? 'Volume brut de ventes'}
          icon={<Ticket className="w-5 h-5" aria-hidden />}
          tone="blue"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.transactional.tripsOperated') ?? 'Trajets opérés'}
          value={data?.trips.totalCompleted ?? 0}
          hint={`${data?.trips.totalCancelled ?? 0} ${t('platformKpi.transactional.cancelled') ?? 'annulés'}`}
          icon={<BusFront className="w-5 h-5" aria-hidden />}
          tone="emerald"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.transactional.onTime') ?? 'Ponctualité'}
          value={pctDisplay(data?.trips.onTimePct)}
          hint={t('platformKpi.transactional.onTimeHint') ?? 'Tolérance ≤ 10 min'}
          icon={<Clock className="w-5 h-5" aria-hidden />}
          tone={(data?.trips.onTimePct ?? 1) >= 0.8 ? 'emerald' : 'amber'}
          loading={loading}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 t-card-bordered rounded-2xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
            {t('platformKpi.transactional.dailyTrend') ?? 'Activité quotidienne'}
          </h3>
          <Sparkline
            data={(data?.perDay ?? []).map((d) => ({ date: d.date, value: d.tickets + d.trips }))}
            ariaLabel={t('platformKpi.transactional.dailyTrend') ?? 'Activité quotidienne'}
          />
          <p className="text-[11px] t-text-3 mt-2">
            {t('platformKpi.transactional.dailyTrendHint') ?? 'Billets + trajets agrégés par jour'}
          </p>
        </div>
        <div className="t-card-bordered rounded-2xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
            {t('platformKpi.transactional.parcels') ?? 'Colis'}
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="t-text-2 text-xs">
                <Package className="w-3.5 h-3.5 inline mr-1" aria-hidden />
                {t('platformKpi.transactional.parcelsTotal') ?? 'Total'}
              </dt>
              <dd className="tabular-nums font-semibold t-text">{data?.parcels.total ?? 0}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="t-text-2 text-xs">
                {t('platformKpi.transactional.parcelsDelivered') ?? 'Livrés'}
              </dt>
              <dd className="tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{data?.parcels.delivered ?? 0}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
