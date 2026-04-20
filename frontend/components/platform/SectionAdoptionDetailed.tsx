/**
 * SectionAdoptionDetailed — DAU/WAU/MAU ventilés par STAFF/DRIVER/CUSTOMER
 * + adoption modules avec flag "adopted" (≥ threshold).
 *
 * Permission : data.platform.kpi.adoption.read.global (SA + L1 + L2).
 */
import React from 'react';
import { Users, UserCog, BusFront, UserCheck } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, ProgressBar, SectionHeader, Sparkline, pctDisplay } from './kpi-shared';

type UserTypeBucket = 'STAFF' | 'DRIVER' | 'CUSTOMER';

interface AdoptionPayload {
  periodDays: number;
  users: {
    dau:          Record<UserTypeBucket, number>;
    wau:          Record<UserTypeBucket, number>;
    mau:          Record<UserTypeBucket, number>;
    dauMauRatio:  Record<UserTypeBucket, number>;
    totalActive:  Record<UserTypeBucket, number>;
  };
  modules: Array<{
    moduleKey: string;
    tenants:   number;
    pct:       number;
    adopted:   boolean;
  }>;
  trend30d: Array<{ date: string; dau: number }>;
}

const BUCKET_ICON: Record<UserTypeBucket, React.ReactNode> = {
  STAFF:    <UserCog className="w-5 h-5" aria-hidden />,
  DRIVER:   <BusFront className="w-5 h-5" aria-hidden />,
  CUSTOMER: <UserCheck className="w-5 h-5" aria-hidden />,
};

export function SectionAdoptionDetailed() {
  const { t } = useI18n();
  const [days, setDays] = React.useState(30);
  const { data, loading } = useFetch<AdoptionPayload>(`/api/platform/kpi/adoption?days=${days}`);

  const buckets: UserTypeBucket[] = ['STAFF', 'DRIVER', 'CUSTOMER'];

  return (
    <section aria-labelledby="pk-adoption-detail">
      <SectionHeader
        id="pk-adoption-detail"
        icon={<Users className="w-4 h-4" />}
        title={t('platformKpi.adoption.title') ?? 'Adoption détaillée'}
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

      {/* MAU / DAU ventilés */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {buckets.map((b) => (
          <KpiTile
            key={b}
            label={t(`platformKpi.adoption.${b.toLowerCase()}Mau`) ?? `MAU ${b}`}
            value={data?.users.mau[b] ?? 0}
            hint={`${data?.users.dau[b] ?? 0} ${t('platformKpi.adoption.dauLabel') ?? 'DAU'} · ${pctDisplay(data?.users.dauMauRatio[b])} ${t('platformKpi.adoption.stickiness') ?? 'stickiness'}`}
            icon={BUCKET_ICON[b]}
            tone={b === 'STAFF' ? 'teal' : b === 'DRIVER' ? 'amber' : 'blue'}
            loading={loading}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="t-card-bordered rounded-2xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
            {t('platformKpi.adoption.modules') ?? 'Adoption modules'}
          </h3>
          <div className="space-y-3">
            {(data?.modules ?? []).slice(0, 8).map((m) => (
              <ProgressBar
                key={m.moduleKey}
                label={m.moduleKey}
                value={m.tenants}
                pct={m.pct}
                tone={m.adopted ? 'emerald' : 'amber'}
              />
            ))}
            {(data?.modules ?? []).length === 0 && !loading && (
              <p className="text-xs t-text-3">{t('platformKpi.common.noData') ?? 'Aucune donnée'}</p>
            )}
          </div>
        </div>
        <div className="t-card-bordered rounded-2xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
            {t('platformKpi.adoption.dauTrend') ?? 'DAU (30j)'}
          </h3>
          <Sparkline data={data?.trend30d ?? []} ariaLabel={t('platformKpi.adoption.dauTrend') ?? 'DAU trend'} />
          <p className="text-[11px] t-text-3 mt-2">
            {t('platformKpi.adoption.dauTrendHint') ?? 'DAU total toutes catégories confondues'}
          </p>
        </div>
      </div>
    </section>
  );
}
