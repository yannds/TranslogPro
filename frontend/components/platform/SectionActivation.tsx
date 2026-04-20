/**
 * SectionActivation — funnel d'activation 4 étapes.
 *
 * Permission : data.platform.kpi.adoption.read.global (SA + L1 + L2).
 *
 * Affiche :
 *   - 4 étapes : TRIP_CREATED → TICKET_SOLD → DRIVER_ADDED → TWO_MODULES_USED
 *   - Pour chaque étape : nb tenants + % total + % conversion vs étape précédente
 *   - Temps moyen jusqu'à activation complète
 *
 * Use-case : identifier les tenants bloqués sur une étape pour proposer
 * une assistance ciblée (webinaire, email, onboarding call).
 */
import { Flag, Timer } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { KpiTile, ProgressBar, SectionHeader, pctDisplay } from './kpi-shared';

type ActivationStep = 'TRIP_CREATED' | 'TICKET_SOLD' | 'DRIVER_ADDED' | 'TWO_MODULES_USED';

interface ActivationPayload {
  totalTenants: number;
  steps: Array<{
    step:          ActivationStep;
    tenants:       number;
    pct:           number;
    conversionPct: number;
  }>;
  avgDaysToActivate: number | null;
}

export function SectionActivation() {
  const { t } = useI18n();
  const { data, loading } = useFetch<ActivationPayload>('/api/platform/kpi/activation');

  return (
    <section aria-labelledby="pk-activation">
      <SectionHeader
        id="pk-activation"
        icon={<Flag className="w-4 h-4" />}
        title={t('platformKpi.activation.title') ?? 'Activation (early stage)'}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiTile
          label={t('platformKpi.activation.totalTenants') ?? 'Tenants totaux'}
          value={data?.totalTenants ?? 0}
          hint={t('platformKpi.activation.totalTenantsHint') ?? 'Base du funnel'}
          icon={<Flag className="w-5 h-5" aria-hidden />}
          tone="slate"
          loading={loading}
        />
        <KpiTile
          label={t('platformKpi.activation.avgDays') ?? 'Temps moyen d\'activation'}
          value={data?.avgDaysToActivate !== null && data?.avgDaysToActivate !== undefined ? `${data.avgDaysToActivate}j` : '—'}
          hint={t('platformKpi.activation.avgDaysHint') ?? 'Signup → 4 étapes complètes'}
          icon={<Timer className="w-5 h-5" aria-hidden />}
          tone="blue"
          loading={loading}
        />
      </div>

      <div className="mt-4 t-card-bordered rounded-2xl p-5 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2">
          {t('platformKpi.activation.funnel') ?? 'Funnel étapes'}
        </h3>
        {(data?.steps ?? []).map((s, i) => (
          <div key={s.step}>
            <ProgressBar
              label={t(`platformKpi.step.${s.step}`) ?? s.step}
              value={s.tenants}
              pct={s.pct}
              tone={s.pct >= 0.7 ? 'emerald' : s.pct >= 0.4 ? 'teal' : 'amber'}
            />
            {i > 0 && (
              <p className="text-[10px] t-text-3 mt-1">
                {t('platformKpi.activation.conversion') ?? 'Conversion vs étape précédente'} : {pctDisplay(s.conversionPct)}
              </p>
            )}
          </div>
        ))}
        {(data?.steps ?? []).length === 0 && !loading && (
          <p className="text-xs t-text-3">{t('platformKpi.common.noData') ?? 'Aucune donnée'}</p>
        )}
      </div>
    </section>
  );
}
