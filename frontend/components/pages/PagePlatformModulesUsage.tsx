/**
 * PagePlatformModulesUsage — Usage des modules par tenant (portail plateforme).
 *
 * Vue diagnostic pour SA/L1/L2 qui permet de voir, pour un tenant donné :
 *   - Quels modules sont installés (actifs / désactivés / jamais installés)
 *   - Qui les a activés/désactivés et quand (traçabilité InstalledModule)
 *   - L'usage agrégé sur la période (actionCount, uniqueUsers, activeDays, lastUsedAt)
 *
 * Source :
 *   GET /api/tenants                                     (dropdown)
 *   GET /api/platform/kpi/modules/usage/:tenantId?days=  (données)
 *
 * Permission backend : data.platform.kpi.adoption.read.global (SA + L1 + L2).
 * La page n'expose aucun montant business — elle peut rester sous le pilier
 * "adoption" côté RBAC (comme les autres sections KPI côté tenant).
 *
 * WCAG AA : aria-labelledby sur les sections, Select/Input focusables,
 * DataTableMaster nativement accessible. Mobile → desktop (grid 1/2/4).
 */

import { useMemo, useState } from 'react';
import {
  Package, Activity, PowerOff, Users as UsersIcon, RefreshCw, AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { Select }  from '../ui/Select';
import { Button }  from '../ui/Button';
import { Badge }   from '../ui/Badge';
import { KpiTile, ProgressBar } from '../platform/kpi-shared';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Permissions ──────────────────────────────────────────────────────────────

const P_KPI_ADOPTION = 'data.platform.kpi.adoption.read.global';
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// ─── Types (alignés sur PlatformKpiService.ModulesUsageReport) ────────────────

interface ModuleUsageEntry {
  moduleKey:     string;
  installed:     boolean;
  isActive:      boolean;
  activatedAt:   string | null;
  activatedBy:   string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  periodDays:    number;
  actionCount:   number;
  uniqueUsers:   number;
  activeDays:    number;
  lastUsedAt:    string | null;
}

interface ModulesUsageReport {
  tenantId:    string;
  periodDays:  number;
  generatedAt: string;
  modules:     ModuleUsageEntry[];
}

interface TenantOption { id: string; name: string; slug: string }

// DataTableMaster exige `id` — on le dérive de moduleKey (unique).
// `adoptionScore` (0..100) = indicateur composite d'adoption. Calculé côté front
// pour éviter un aller-retour backend. Formule documentée dans computeAdoption().
interface ModuleRow extends ModuleUsageEntry { id: string; adoptionScore: number }

/**
 * computeAdoption(row, periodDays) — score d'adoption 0..100.
 *
 * Combine deux signaux indépendants et prend le MIN pour rester honnête :
 *   - Intensité  = actionCount / (periodDays × minActionsPerDayForFullScore)
 *                  → mesure "ça tape fort chaque jour ?"
 *   - Régularité = activeDays / periodDays
 *                  → mesure "ça tape souvent ?"
 *
 * Un module "tapé 200× en 1 seul jour" a une intensité forte mais une
 * régularité faible → score = min(100, 20) = 20 (faiblement adopté).
 * Un module "tapé 10× tous les jours" a intensité moyenne + régularité max
 * → score ≈ 50. Un module tapé 50×/jour tous les jours = 100.
 *
 * Seuil `minActionsPerDayForFullScore` = 50 (choix d'ingénierie visible ici,
 * pas de config DB — on peut l'ajuster si les tenants ont des profils très
 * différents ; pour l'instant les 8 modules du registry ont des volumes
 * comparables en ordre de grandeur).
 */
function computeAdoption(row: ModuleUsageEntry, periodDays: number): number {
  if (!row.isActive) return 0;
  if (row.actionCount === 0) return 0;
  const MIN_ACTIONS_PER_DAY = 50;
  const intensityPct  = Math.min(100, (row.actionCount / (periodDays * MIN_ACTIONS_PER_DAY)) * 100);
  const regularityPct = Math.min(100, (row.activeDays / periodDays) * 100);
  return Math.round(Math.min(intensityPct, regularityPct));
}

function adoptionTone(score: number): 'teal' | 'emerald' | 'amber' | 'red' {
  if (score >= 70) return 'emerald';
  if (score >= 40) return 'teal';
  if (score >= 10) return 'amber';
  return 'red';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(row: ModuleUsageEntry, t: (k: string) => string): {
  label: string;
  variant: 'success' | 'danger' | 'outline';
} {
  if (row.isActive)   return { label: t('platformModulesUsage.statusActive'),      variant: 'success' };
  if (row.installed)  return { label: t('platformModulesUsage.statusDeactivated'), variant: 'danger'  };
  return                     { label: t('platformModulesUsage.statusNotInstalled'), variant: 'outline' };
}

function formatDate(iso: string | null, dateLocale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(dateLocale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function useHasPerm(perm: string): boolean {
  const { user } = useAuth();
  return (user?.permissions ?? []).includes(perm);
}

// ─── Colonnes ─────────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string, dateLocale: string): Column<ModuleRow>[] {
  return [
    {
      key: 'moduleKey',
      header: t('platformModulesUsage.colModule'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <Package className="w-3.5 h-3.5 t-text-3 shrink-0" aria-hidden />
          <span className="text-sm font-mono t-text">{row.moduleKey}</span>
        </div>
      ),
    },
    {
      key: 'isActive',
      header: t('platformModulesUsage.colStatus'),
      sortable: true,
      width: '140px',
      cellRenderer: (_v, row) => {
        const { label, variant } = statusLabel(row, t);
        return <Badge variant={variant} size="sm">{label}</Badge>;
      },
      csvValue: (_v, row) => statusLabel(row, t).label,
    },
    {
      key: 'adoptionScore',
      header: t('platformModulesUsage.colAdoption'),
      sortable: true,
      align: 'left',
      width: '160px',
      cellRenderer: (_v, row) => {
        const tone = adoptionTone(row.adoptionScore);
        const toneBar: Record<ReturnType<typeof adoptionTone>, string> = {
          emerald: 'bg-emerald-500', teal: 'bg-teal-500',
          amber: 'bg-amber-500',     red:  'bg-red-500',
        };
        return (
          <div className="flex items-center gap-2">
            <div
              className="flex-1 bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 min-w-[60px]"
              role="progressbar"
              aria-label={`${row.moduleKey} adoption`}
              aria-valuenow={row.adoptionScore}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={`${toneBar[tone]} h-1.5 rounded-full`} style={{ width: `${row.adoptionScore}%` }} />
            </div>
            <span className="text-xs tabular-nums t-text-2 shrink-0">{row.adoptionScore}</span>
          </div>
        );
      },
      csvValue: (_v, row) => String(row.adoptionScore),
    },
    {
      key: 'actionCount',
      header: t('platformModulesUsage.colActions'),
      sortable: true,
      align: 'right',
      width: '110px',
      cellRenderer: (_v, row) => (
        <span className="tabular-nums t-text">{row.actionCount.toLocaleString()}</span>
      ),
    },
    {
      key: 'uniqueUsers',
      header: t('platformModulesUsage.colUsers'),
      sortable: true,
      align: 'right',
      width: '110px',
      cellRenderer: (_v, row) => (
        <span className="tabular-nums t-text-2">{row.uniqueUsers}</span>
      ),
    },
    {
      key: 'activeDays',
      header: t('platformModulesUsage.colActiveDays'),
      sortable: true,
      align: 'right',
      width: '120px',
      cellRenderer: (_v, row) => (
        <span className="tabular-nums t-text-2">{row.activeDays}</span>
      ),
    },
    {
      key: 'lastUsedAt',
      header: t('platformModulesUsage.colLastUsed'),
      sortable: true,
      width: '130px',
      cellRenderer: (_v, row) => (
        <span className="text-xs t-text-2">{row.lastUsedAt ?? '—'}</span>
      ),
      csvValue: (_v, row) => row.lastUsedAt ?? '',
    },
    {
      key: 'activatedAt',
      header: t('platformModulesUsage.colActivated'),
      sortable: true,
      width: '170px',
      cellRenderer: (_v, row) => (
        <div className="text-xs">
          <p className="t-text-2">{formatDate(row.activatedAt, dateLocale)}</p>
          {row.activatedBy && (
            <p className="font-mono t-text-3 truncate max-w-[140px]" title={row.activatedBy}>
              {row.activatedBy.slice(0, 8)}…
            </p>
          )}
        </div>
      ),
      csvValue: (_v, row) => `${row.activatedAt ?? ''} by ${row.activatedBy ?? ''}`,
    },
    {
      key: 'deactivatedAt',
      header: t('platformModulesUsage.colDeactivated'),
      sortable: true,
      width: '170px',
      cellRenderer: (_v, row) => (
        row.deactivatedAt ? (
          <div className="text-xs">
            <p className="t-text-2">{formatDate(row.deactivatedAt, dateLocale)}</p>
            {row.deactivatedBy && (
              <p className="font-mono t-text-3 truncate max-w-[140px]" title={row.deactivatedBy}>
                {row.deactivatedBy.slice(0, 8)}…
              </p>
            )}
          </div>
        ) : <span className="text-xs t-text-3">—</span>
      ),
      csvValue: (_v, row) => row.deactivatedAt
        ? `${row.deactivatedAt} by ${row.deactivatedBy ?? ''}`
        : '',
    },
  ];
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PagePlatformModulesUsage() {
  const { t, dateLocale } = useI18n();
  const canRead = useHasPerm(P_KPI_ADOPTION);

  // Dropdown tenants — on filtre d'emblée le tenant plateforme (pas de modules
  // métier à tracker dessus, il héberge uniquement les agents SaaS).
  const { data: tenants, loading: lTenants } = useFetch<TenantOption[]>(
    canRead ? '/api/tenants' : null,
  );

  const tenantOptions = useMemo(
    () => (tenants ?? [])
      .filter(t => t.id !== PLATFORM_TENANT_ID)
      .map(t => ({ value: t.id, label: `${t.name} (${t.slug})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [tenants],
  );

  const [tenantId, setTenantId] = useState<string>('');
  const [days,     setDays]     = useState<number>(30);
  const [rev,      setRev]      = useState(0);

  // Sélection auto du premier tenant disponible dès que la liste est chargée.
  const effectiveTenantId = tenantId || tenantOptions[0]?.value || '';

  const url = canRead && effectiveTenantId
    ? `/api/platform/kpi/modules/usage/${effectiveTenantId}?days=${days}`
    : null;

  const { data, loading, error, refetch } = useFetch<ModulesUsageReport>(
    url,
    [effectiveTenantId, days, rev],
  );

  // Enrichir les rows avec `id` + `adoptionScore` (calculé côté front).
  const rows: ModuleRow[] = useMemo(
    () => (data?.modules ?? []).map(m => ({
      ...m,
      id: m.moduleKey,
      adoptionScore: computeAdoption(m, data?.periodDays ?? days),
    })),
    [data, days],
  );

  // KPI tiles — comptages dérivés.
  const stats = useMemo(() => {
    const active      = rows.filter(r => r.isActive).length;
    const deactivated = rows.filter(r => r.installed && !r.isActive).length;
    const totalActions = rows.reduce((a, r) => a + r.actionCount, 0);
    const uniqueUsersMax = rows.reduce((a, r) => Math.max(a, r.uniqueUsers), 0);
    // Modules "installés mais jamais utilisés sur la période" = churn risk
    const idleInstalled = rows.filter(r => r.isActive && r.actionCount === 0).length;
    // Adoption moyenne tenant = moyenne des scores des modules actifs
    // (les modules non installés / désactivés ont score 0 et sont exclus).
    const activeRows = rows.filter(r => r.isActive);
    const avgAdoption = activeRows.length > 0
      ? Math.round(activeRows.reduce((a, r) => a + r.adoptionScore, 0) / activeRows.length)
      : 0;
    // Rows triées par score décroissant pour le panneau d'adoption
    const rowsByAdoption = [...rows]
      .filter(r => r.installed)
      .sort((a, b) => b.adoptionScore - a.adoptionScore);
    return { active, deactivated, totalActions, uniqueUsersMax, idleInstalled, avgAdoption, rowsByAdoption };
  }, [rows]);

  // Accès refusé explicite plutôt que page vide.
  if (!canRead) {
    return (
      <div className="p-6">
        <div role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          {t('platformModulesUsage.forbidden')}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" aria-labelledby="pmu-title">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
            <Package className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 id="pmu-title" className="text-2xl font-bold t-text">
              {t('platformModulesUsage.title')}
            </h1>
            <p className="text-sm t-text-2 mt-0.5">
              {t('platformModulesUsage.subtitle')}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRev(r => r + 1)}
          disabled={loading || !effectiveTenantId}
          aria-label={t('platformModulesUsage.refresh')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
          <span className="ml-1">{t('platformModulesUsage.refresh')}</span>
        </Button>
      </header>

      {/* Filtres */}
      <section
        aria-labelledby="pmu-filters"
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4"
      >
        <h2 id="pmu-filters" className="sr-only">{t('platformModulesUsage.filtersLabel')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium t-text-2 mb-1" htmlFor="pmu-tenant">
              {t('platformModulesUsage.tenantLabel')}
            </label>
            <Select
              id="pmu-tenant"
              options={tenantOptions.length === 0
                ? [{ value: '', label: lTenants ? t('platformModulesUsage.loading') : t('platformModulesUsage.noTenants') }]
                : tenantOptions}
              value={effectiveTenantId}
              onChange={e => setTenantId(e.target.value)}
              disabled={lTenants || tenantOptions.length === 0}
            />
          </div>
          <div>
            <label className="block text-xs font-medium t-text-2 mb-1" htmlFor="pmu-days">
              {t('platformModulesUsage.periodLabel')}
            </label>
            <Select
              id="pmu-days"
              options={[
                { value: '7',  label: t('platformModulesUsage.period7d')  },
                { value: '30', label: t('platformModulesUsage.period30d') },
                { value: '90', label: t('platformModulesUsage.period90d') },
              ]}
              value={String(days)}
              onChange={e => setDays(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end">
            <p className="text-xs t-text-3">
              {data
                ? t('platformModulesUsage.lastComputed').replace('{date}', new Date(data.generatedAt).toLocaleString(dateLocale))
                : ''}
            </p>
          </div>
        </div>
      </section>

      {/* Erreur */}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {/* KPI tiles */}
      <section aria-labelledby="pmu-kpi">
        <h2 id="pmu-kpi" className="sr-only">{t('platformModulesUsage.kpiLabel')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiTile
            label={t('platformModulesUsage.kpiActive')}
            value={stats.active}
            hint={t('platformModulesUsage.kpiActiveHint')}
            icon={<Package className="w-5 h-5" aria-hidden />}
            tone="teal"
            loading={loading}
          />
          <KpiTile
            label={t('platformModulesUsage.kpiDeactivated')}
            value={stats.deactivated}
            hint={t('platformModulesUsage.kpiDeactivatedHint')}
            icon={<PowerOff className="w-5 h-5" aria-hidden />}
            tone="amber"
            loading={loading}
          />
          <KpiTile
            label={t('platformModulesUsage.kpiActions')}
            value={stats.totalActions.toLocaleString()}
            hint={t('platformModulesUsage.kpiActionsHint').replace('{n}', String(days))}
            icon={<Activity className="w-5 h-5" aria-hidden />}
            tone="blue"
            loading={loading}
          />
          <KpiTile
            label={t('platformModulesUsage.adoptionLabel')}
            value={`${stats.avgAdoption}/100`}
            hint={t('platformModulesUsage.adoptionLegend')}
            icon={<TrendingUp className="w-5 h-5" aria-hidden />}
            tone={stats.avgAdoption >= 50 ? 'emerald' : stats.avgAdoption >= 20 ? 'teal' : 'amber'}
            loading={loading}
          />
          <KpiTile
            label={t('platformModulesUsage.kpiIdle')}
            value={stats.idleInstalled}
            hint={t('platformModulesUsage.kpiIdleHint')}
            icon={<UsersIcon className="w-5 h-5" aria-hidden />}
            tone={stats.idleInstalled > 0 ? 'red' : 'emerald'}
            loading={loading}
          />
        </div>
      </section>

      {/* Panneau "degré d'adoption par module" — vue synthétique avant le
          tableau détaillé. Barres triées par score décroissant. */}
      {stats.rowsByAdoption.length > 0 && (
        <section
          aria-labelledby="pmu-adoption"
          className="t-card-bordered rounded-2xl p-5"
        >
          <header className="mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
            <h2 id="pmu-adoption" className="text-sm font-semibold uppercase tracking-wider t-text-2">
              {t('platformModulesUsage.adoptionLabel')}
            </h2>
          </header>
          <p className="text-xs t-text-3 mb-3">{t('platformModulesUsage.adoptionLegend')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {stats.rowsByAdoption.map(r => (
              <ProgressBar
                key={r.moduleKey}
                label={`${r.moduleKey}${r.isActive ? '' : ` · ${t('platformModulesUsage.statusDeactivated').toLowerCase()}`}`}
                value={r.actionCount}
                pct={r.adoptionScore / 100}
                tone={adoptionTone(r.adoptionScore) === 'red' ? 'red'
                      : adoptionTone(r.adoptionScore) === 'amber' ? 'amber'
                      : adoptionTone(r.adoptionScore) === 'emerald' ? 'emerald' : 'teal'}
                ariaLabel={`${r.moduleKey} adoption ${r.adoptionScore}/100`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Table */}
      <DataTableMaster<ModuleRow>
        columns={useMemo(() => buildColumns(t, dateLocale), [t, dateLocale])}
        data={rows}
        loading={loading}
        defaultSort={{ key: 'actionCount', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('platformModulesUsage.searchPlaceholder')}
        emptyMessage={t('platformModulesUsage.emptyMessage')}
        exportFormats={['csv', 'json']}
        exportFilename={`modules-usage-${effectiveTenantId.slice(0, 8)}`}
        stickyHeader
      />
    </div>
  );
}
