/**
 * TenantScopeSelector — bandeau sticky pour le staff plateforme.
 *
 * Affiche un dropdown permettant à un agent du tenant plateforme de
 * sélectionner un tenant cible pour consulter les pages tenant-scoped.
 *
 * Rendu UNIQUEMENT si `isPlatformUser === true`. Invisible pour les tenants
 * clients (ils n'ont pas ce concept).
 *
 * WCAG : role=region + aria-label, focus visible sur le select, contraste
 * AA en light + dark mode.
 */
import { useMemo } from 'react';
import { Building2, X, Info } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTenantScope } from '../../lib/platform-scope/TenantScopeProvider';

interface TenantRow {
  id:              string;
  name:            string;
  slug:            string;
  isActive:        boolean;
  provisionStatus: string;
}

export function TenantScopeSelector() {
  const { t } = useI18n();
  const { isPlatformUser, scopedTenant, setScope, clearScope } = useTenantScope();

  const { data: tenants, loading } = useFetch<TenantRow[]>(
    isPlatformUser ? '/api/tenants' : null,
  );

  const options = useMemo(
    () => (tenants ?? []).filter(t => t.isActive && t.provisionStatus === 'ACTIVE'),
    [tenants],
  );

  if (!isPlatformUser) return null;

  return (
    <div
      role="region"
      aria-label={t('tenantScope.ariaLabel')}
      className="sticky top-0 z-30 bg-teal-50 dark:bg-teal-950/40 border-b border-teal-200 dark:border-teal-900"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-teal-900 dark:text-teal-200">
          <Info className="w-3.5 h-3.5" aria-hidden />
          <span>{t('tenantScope.label')}</span>
        </div>

        <select
          aria-label={t('tenantScope.selectAria')}
          value={scopedTenant?.id ?? ''}
          onChange={e => {
            const v = e.target.value;
            if (!v) { clearScope(); return; }
            const tnt = options.find(o => o.id === v);
            if (tnt) setScope({ id: tnt.id, name: tnt.name, slug: tnt.slug });
          }}
          disabled={loading}
          className="flex-1 min-w-[220px] max-w-md rounded-md border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <option value="">{t('tenantScope.none')}</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.name} — {o.slug}</option>
          ))}
        </select>

        {scopedTenant && (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-teal-100 dark:bg-teal-900/50 text-teal-900 dark:text-teal-200">
            <Building2 className="w-3 h-3" aria-hidden />
            {scopedTenant.slug}
            <button
              type="button"
              onClick={clearScope}
              aria-label={t('tenantScope.clearAria')}
              className="ml-1 rounded hover:bg-teal-200 dark:hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * NoTenantScope — placeholder à afficher dans une page tenant-scoped quand
 * un agent plateforme n'a pas encore choisi de tenant. Invite explicite à
 * utiliser le sélecteur en haut de page.
 */
export function NoTenantScope({ pageName }: { pageName?: string }) {
  const { t } = useI18n();
  return (
    <div className="p-6 flex items-center justify-center min-h-[50vh]">
      <div role="status" className="t-card-bordered rounded-2xl p-6 max-w-md text-center space-y-3">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
          <Building2 className="w-6 h-6 text-teal-700 dark:text-teal-300" aria-hidden />
        </div>
        <h2 className="text-base font-semibold t-text">
          {pageName ? t('tenantScope.requiredFor').replace('{page}', pageName) : t('tenantScope.required')}
        </h2>
        <p className="text-sm t-text-2">{t('tenantScope.howto')}</p>
      </div>
    </div>
  );
}
