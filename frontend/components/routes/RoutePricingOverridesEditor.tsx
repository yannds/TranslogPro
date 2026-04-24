/**
 * RoutePricingOverridesEditor — éditeur du champ `Route.pricingOverrides`.
 *
 * Sémantique : chaque ligne peut **surcharger** les réglages tenant :
 *   - Taxes : activation + taux personnalisés par code TenantTax
 *   - Péages : override global de `PricingRules.tollsXof` pour cette ligne
 *   - Bagages : franchise + surcharge kg par ligne
 *
 * `null` ou `{}` = aucun override, la config tenant s'applique.
 *
 * Utilisé depuis PageRoutes (formulaire création/édition).
 * Affichage pédagogique : même quand une taxe est désactivée pour la ligne,
 * le taux effectif reste visible pour le manager.
 */
import { useMemo, useState } from 'react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { Checkbox } from '../ui/Checkbox';

export interface RoutePricingOverrides {
  taxes?:       Record<string, { rate?: number; appliedToPrice?: boolean }>;
  tolls?:       { override?: number };
  luggage?:     { freeKg?: number; perExtraKg?: number };
  fareClasses?: { allowed?: string[] };
}

interface TenantTaxRow {
  id:              string;
  code:            string;
  label:           string;
  rate:            number;
  kind:            'PERCENT' | 'FIXED';
  enabled:         boolean;
  appliedToPrice:  boolean;
  isSystemDefault: boolean;
}

interface Props {
  tenantId: string;
  value:    RoutePricingOverrides | null;
  onChange: (next: RoutePricingOverrides | null) => void;
  disabled?: boolean;
}

const inp = 'w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

export function RoutePricingOverridesEditor({ tenantId, value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const { data: taxesData } = useFetch<TenantTaxRow[]>(
    tenantId ? `/api/tenants/${tenantId}/settings/taxes` : null,
  );
  const taxes = useMemo(() => (taxesData ?? []).filter(x => x.enabled), [taxesData]);

  const [expanded, setExpanded] = useState(value !== null && value !== undefined && Object.keys(value ?? {}).length > 0);

  const patch = (p: RoutePricingOverrides) => onChange({ ...(value ?? {}), ...p });

  const toggleExpanded = () => {
    if (expanded) {
      // Replier = reset (aucun override, tenant config s'applique)
      onChange(null);
    }
    setExpanded(!expanded);
  };

  return (
    <fieldset className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
      <legend className="px-2 text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
        <Checkbox
          checked={expanded}
          onCheckedChange={toggleExpanded}
          disabled={disabled}
          aria-label={t('routes.overrides.toggle')}
        />
        <span>{t('routes.overrides.title')}</span>
      </legend>

      {!expanded && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('routes.overrides.helpOff')}
        </p>
      )}

      {expanded && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('routes.overrides.helpOn')}
          </p>

          {/* Taxes par code */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t('routes.overrides.taxesTitle')}
            </h4>
            {taxes.length === 0 ? (
              <p className="text-xs text-slate-400 italic">{t('routes.overrides.noTaxes')}</p>
            ) : (
              <div className="space-y-2">
                {taxes.map(tax => {
                  const ov = value?.taxes?.[tax.code] ?? {};
                  const effectiveApplied = ov.appliedToPrice !== undefined ? ov.appliedToPrice : tax.appliedToPrice;
                  const effectiveRate    = ov.rate !== undefined ? ov.rate : tax.rate;
                  return (
                    <div key={tax.code} className="grid grid-cols-[1fr_auto_140px] items-center gap-3 p-2 rounded bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{tax.code}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {t('routes.overrides.tenantDefault')}: {tax.kind === 'PERCENT' ? `${(tax.rate * 100).toFixed(2)}%` : tax.rate} ·{' '}
                          {tax.appliedToPrice ? t('routes.overrides.appliedDefault') : t('routes.overrides.notAppliedDefault')}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={effectiveApplied}
                          onCheckedChange={c => patch({
                            taxes: { ...(value?.taxes ?? {}), [tax.code]: { ...ov, appliedToPrice: c as boolean } },
                          })}
                          disabled={disabled}
                          aria-label={t('routes.overrides.appliedThisRoute')}
                        />
                        <span className="text-slate-600 dark:text-slate-400">{t('routes.overrides.appliedThisRoute')}</span>
                      </label>
                      {tax.kind === 'PERCENT' ? (
                        <input
                          type="number" step="0.0001" min={0} max={1}
                          value={effectiveRate}
                          onChange={e => patch({
                            taxes: { ...(value?.taxes ?? {}), [tax.code]: { ...ov, rate: parseFloat(e.target.value) } },
                          })}
                          className={inp}
                          disabled={disabled}
                          aria-label={t('routes.overrides.rateOverride')}
                        />
                      ) : (
                        <div className="text-xs text-slate-400 italic text-right">{t('routes.overrides.fixedLocked')}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Péages */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t('routes.overrides.tollsTitle')}
            </h4>
            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
              {t('routes.overrides.tollsLabel')}
            </label>
            <input
              type="number" min={0} step={50}
              placeholder={t('routes.overrides.tollsPh')}
              value={value?.tolls?.override ?? ''}
              onChange={e => {
                const v = e.target.value;
                patch({ tolls: v === '' ? {} : { override: Number(v) } });
              }}
              className={inp}
              disabled={disabled}
            />
            <p className="text-xs text-slate-400 mt-1">{t('routes.overrides.tollsHelp')}</p>
          </div>

          {/* Bagages */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t('routes.overrides.luggageTitle')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  {t('routes.overrides.luggageFreeKg')}
                </span>
                <input
                  type="number" min={0} step={1}
                  placeholder={t('routes.overrides.inheritPh')}
                  value={value?.luggage?.freeKg ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    patch({ luggage: { ...(value?.luggage ?? {}), freeKg: v === '' ? undefined : Number(v) } });
                  }}
                  className={inp}
                  disabled={disabled}
                />
              </label>
              <label className="block">
                <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  {t('routes.overrides.luggagePerExtraKg')}
                </span>
                <input
                  type="number" min={0} step={10}
                  placeholder={t('routes.overrides.inheritPh')}
                  value={value?.luggage?.perExtraKg ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    patch({ luggage: { ...(value?.luggage ?? {}), perExtraKg: v === '' ? undefined : Number(v) } });
                  }}
                  className={inp}
                  disabled={disabled}
                />
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">{t('routes.overrides.luggageHelp')}</p>
          </div>
        </div>
      )}
    </fieldset>
  );
}
