/**
 * YieldSuggestionCard — affiche la suggestion yield pour un trajet (Sprint 10.3).
 *
 * Consomme GET /api/tenants/:tenantId/trips/:tripId/yield (existant, exposé
 * par pricing.controller.ts). Visible seulement si user a la permission
 * `control.pricing.yield.tenant` — sinon le composant rend null (opt-in).
 *
 * Design : card compacte à insérer dans PageSellTicket à côté du prix. Affiche
 * règle matchée (GOLDEN_DAY / LOW_FILL / HIGH_FILL / BLACK_ROUTE / NO_CHANGE),
 * prix suggéré vs basePrice, delta %, reason textuel. Zéro magic number :
 * toutes les valeurs viennent du backend.
 */

import { useMemo } from 'react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { cn } from '../../lib/utils';

const PERM_YIELD = 'control.pricing.yield.tenant';

interface YieldSuggestion {
  basePrice:      number;
  suggestedPrice: number;
  delta:          number;
  deltaPercent:   number;
  rule:           'GOLDEN_DAY' | 'BLACK_ROUTE' | 'LOW_FILL' | 'HIGH_FILL' | 'NO_CHANGE';
  reason:         string;
  fillRate:       number;
  yieldActive:    boolean;
}

export interface YieldSuggestionCardProps {
  tenantId: string;
  tripId:   string;
}

const RULE_STYLE: Record<YieldSuggestion['rule'], { accent: string; icon: string }> = {
  GOLDEN_DAY:  { accent: 'amber',   icon: '★' },
  HIGH_FILL:   { accent: 'emerald', icon: '↑' },
  LOW_FILL:    { accent: 'blue',    icon: '↓' },
  BLACK_ROUTE: { accent: 'red',     icon: '⚠' },
  NO_CHANGE:   { accent: 'slate',   icon: '=' },
};

export function YieldSuggestionCard({ tenantId, tripId }: YieldSuggestionCardProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const fmt = useCurrencyFormatter();

  const canSee = !!user?.permissions?.includes(PERM_YIELD);
  const url = (canSee && tenantId && tripId)
    ? `/api/tenants/${tenantId}/trips/${tripId}/yield`
    : null;
  const deps = useMemo(() => [tenantId, tripId], [tenantId, tripId]);
  const { data, loading, error } = useFetch<YieldSuggestion>(url, deps);

  if (!canSee || loading || error || !data) return null;
  if (!data.yieldActive) return null; // module inactif → ne pas polluer l'UI
  if (data.rule === 'NO_CHANGE') return null; // aucune action suggérée

  const style = RULE_STYLE[data.rule];
  const positive = data.delta > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        't-card-bordered rounded-xl p-3 text-sm',
        style.accent === 'amber'   && 'border-amber-300/60 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/10',
        style.accent === 'emerald' && 'border-emerald-300/60 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-900/10',
        style.accent === 'blue'    && 'border-blue-300/60 dark:border-blue-800/40 bg-blue-50/60 dark:bg-blue-900/10',
        style.accent === 'red'     && 'border-red-300/60 dark:border-red-800/40 bg-red-50/60 dark:bg-red-900/10',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-lg font-bold" aria-hidden="true">{style.icon}</span>
          <div className="min-w-0">
            <p className="font-bold t-text">
              {t(`yieldSuggest.rule_${data.rule}`)}
            </p>
            <p className="text-xs t-text-2 mt-0.5 break-words">{data.reason}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums t-text">{fmt(data.suggestedPrice)}</p>
          <p className={cn(
            'text-xs tabular-nums font-semibold',
            positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400',
          )}>
            {positive ? '+' : ''}{data.deltaPercent}%
          </p>
        </div>
      </div>
    </div>
  );
}
