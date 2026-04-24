/**
 * TripProfitabilityPanel — simulation rentabilité pré-trajet (Sprint 11.A).
 *
 * Widget réutilisable à monter dans tout formulaire de création/édition de
 * Trip (planificateur, scheduler). Consomme POST /pricing/simulate-trip.
 *
 * Gated par permission `data.profitability.read.tenant` (granulaire, pas de
 * check sur le rôle). Les rôles TENANT_ADMIN, AGENCY_MANAGER et ACCOUNTANT
 * la reçoivent par défaut via le seed IAM — mais la matrice reste configurable.
 *
 * Design : non-bloquant. Affiche un badge PROFITABLE / BREAK_EVEN / DEFICIT +
 * message factuel. L'admin décide seul s'il programme ou pas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth/auth.context';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiPost } from '../../lib/api';
import { cn } from '../../lib/utils';

const PERM_PROFITABILITY = 'data.profitability.read.tenant';

interface SimulationResult {
  input: { routeId: string; busId: string; ticketPrice: number; fillRate: number };
  costs: { totalVariableCost: number; totalFixedCost: number; totalCost: number };
  projected: {
    totalSeats: number; bookedSeats: number;
    ticketPrice: number; fillRate: number;
    ticketRevenue: number; parcelRevenue: number; totalRevenue: number;
    operationalMargin: number; netMargin: number; netMarginRate: number;
    breakEvenSeats: number;
    profitabilityTag: 'PROFITABLE' | 'BREAK_EVEN' | 'DEFICIT';
  };
  recommendations: {
    breakEvenPriceAtFillRate:     number | null;
    profitablePriceAtFillRate:    number | null;
    breakEvenFillRateAtPrice:     number | null;
    profitableFillRateAtPrice:    number | null;
    breakEvenSeatsAtPrice:        number | null;
    profitabilityThresholdPct:    number;
    primaryMessage:               string;
  };
}

export interface TripProfitabilityPanelProps {
  tenantId:     string;
  routeId?:     string;
  busId?:       string;
  ticketPrice?: number;
  fillRate?:    number;
}

const TAG_STYLE: Record<SimulationResult['projected']['profitabilityTag'], { bg: string; text: string; label: string }> = {
  PROFITABLE: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', label: 'profitability.tag_PROFITABLE' },
  BREAK_EVEN: { bg: 'bg-amber-100   dark:bg-amber-900/30',   text: 'text-amber-700   dark:text-amber-400',   label: 'profitability.tag_BREAK_EVEN' },
  DEFICIT:    { bg: 'bg-red-100     dark:bg-red-900/30',     text: 'text-red-700     dark:text-red-400',     label: 'profitability.tag_DEFICIT' },
};

export function TripProfitabilityPanel(props: TripProfitabilityPanelProps) {
  const { tenantId, routeId, busId, ticketPrice, fillRate } = props;
  const { user } = useAuth();
  const { t } = useI18n();
  const fmt = useCurrencyFormatter();

  const canSee = !!user?.permissions?.includes(PERM_PROFITABILITY);

  const [data, setData]       = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const ready = !!(canSee && tenantId && routeId && busId);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<SimulationResult>(
        `/api/tenants/${tenantId}/simulate-trip`,
        { routeId, busId, ticketPrice, fillRate },
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ready, tenantId, routeId, busId, ticketPrice, fillRate]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Debounce léger : recalcule 300 ms après le dernier changement de prix/fillRate
  const depsKey = useMemo(
    () => `${routeId ?? ''}|${busId ?? ''}|${ticketPrice ?? ''}|${fillRate ?? ''}`,
    [routeId, busId, ticketPrice, fillRate],
  );
  void depsKey;

  if (!canSee) return null;
  if (!ready && !loading) {
    return (
      <div className="t-card-bordered rounded-xl p-3 text-xs t-text-3">
        {t('profitability.needsInputs')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="t-card-bordered rounded-xl p-3 text-xs t-text-3 animate-pulse">
        {t('profitability.loading')}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="t-card-bordered rounded-xl p-3 text-xs text-red-600 dark:text-red-400">
        {error ?? t('profitability.unavailable')}
      </div>
    );
  }

  const style = TAG_STYLE[data.projected.profitabilityTag];

  return (
    <section
      aria-labelledby="trip-profitability-title"
      className="t-card-bordered rounded-2xl p-4 space-y-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="trip-profitability-title" className="text-sm font-bold t-text">
            {t('profitability.title')}
          </h2>
          <p className="text-xs t-text-2 mt-0.5">{data.recommendations.primaryMessage}</p>
        </div>
        <span
          className={cn(
            'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest',
            style.bg, style.text,
          )}
          aria-label={t('profitability.tagAria')}
        >
          {t(style.label)}
        </span>
      </header>

      {/* KPI compacts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <p className="t-text-3 uppercase tracking-wider text-[10px]">{t('profitability.totalCost')}</p>
          <p className="tabular-nums font-bold t-text">{fmt(data.costs.totalCost)}</p>
        </div>
        <div>
          <p className="t-text-3 uppercase tracking-wider text-[10px]">{t('profitability.projectedRevenue')}</p>
          <p className="tabular-nums font-bold t-text">{fmt(data.projected.totalRevenue)}</p>
        </div>
        <div>
          <p className="t-text-3 uppercase tracking-wider text-[10px]">{t('profitability.netMargin')}</p>
          <p className={cn(
            'tabular-nums font-bold',
            data.projected.netMargin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
          )}>
            {fmt(data.projected.netMargin)}
          </p>
        </div>
        <div>
          <p className="t-text-3 uppercase tracking-wider text-[10px]">{t('profitability.marginRate')}</p>
          <p className="tabular-nums font-bold t-text">
            {Math.round(data.projected.netMarginRate * 100)}%
          </p>
        </div>
      </div>

      {/* Recommandations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {data.recommendations.breakEvenPriceAtFillRate != null && (
          <div className="t-card-flat rounded-lg p-2">
            <p className="t-text-3 uppercase tracking-wider text-[10px]">{t('profitability.breakEvenPrice')}</p>
            <p className="tabular-nums font-bold t-text mt-0.5">
              {fmt(data.recommendations.breakEvenPriceAtFillRate)}
            </p>
            <p className="t-text-3 text-[10px] mt-0.5">
              {t('profitability.atFillRate')} {Math.round((data.projected.fillRate) * 100)}%
            </p>
          </div>
        )}
        {data.recommendations.breakEvenSeatsAtPrice != null && (
          <div className="t-card-flat rounded-lg p-2">
            <p className="t-text-3 uppercase tracking-wider text-[10px]">{t('profitability.breakEvenFillRate')}</p>
            <p className="tabular-nums font-bold t-text mt-0.5">
              {data.recommendations.breakEvenSeatsAtPrice} {t('profitability.seats')}
              {' '}({Math.round((data.recommendations.breakEvenFillRateAtPrice ?? 0) * 100)}%)
            </p>
            <p className="t-text-3 text-[10px] mt-0.5">
              {t('profitability.atPrice')} {fmt(data.projected.ticketPrice)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
