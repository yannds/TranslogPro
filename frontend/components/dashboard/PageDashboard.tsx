/**
 * PageDashboard — Tableau de bord principal.
 *
 * Contextuel par PERMISSIONS (jamais par roleName — source de vérité backend).
 * Les KPIs, charts et feed d'activité se composent dynamiquement selon
 * `user.permissions[]`. Un utilisateur sans aucune permission voit un état vide.
 *
 * Loading : skeletons du composant Skeleton partagé (aria-busy, pulse CSS).
 * Responsive :
 *   mobile (<640)   → 1 colonne
 *   tablet  (≥640)  → 2 colonnes KPI
 *   desktop (≥1024) → 4 colonnes KPI, 3 colonnes chart (2/3 + 1/3)
 *
 * WCAG 2.1 AA : sections étiquetées, progressbar ARIA sur barres, role=img
 * sur les dots de type d'activité, aria-busy pendant loading.
 */
import { cn }                  from '../../lib/utils';
import { KpiCard }             from './KpiCard';
import { MiniBarChart }        from './MiniBarChart';
import { DashboardSkeleton }   from './DashboardSkeleton';
import { ExecutiveSummaryBanner } from './ExecutiveSummaryBanner';
import { useDashboardStats }   from '../../lib/hooks/useDashboardStats';
import { useAuth }             from '../../lib/auth/auth.context';
import { useI18n }             from '../../lib/i18n/useI18n';
import type { ActivityEntry }  from './types';

const P_STATS_READ = 'control.stats.read.tenant';

// ─── Activity Feed ────────────────────────────────────────────────────────────

const TYPE_DOT: Record<ActivityEntry['type'], string> = {
  ok:   'bg-emerald-500',
  warn: 'bg-amber-500',
  err:  'bg-red-500',
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { t, dateLocale } = useI18n();
  const {
    kpisRow1, kpisRow2, hourlyChart, topLines, activity,
    showChart, showTopLines, showActivity, loading: statsLoading,
  } = useDashboardStats(user);

  const typeLabel: Record<ActivityEntry['type'], string> = {
    ok:   t('dashboard.typeOk'),
    warn: t('dashboard.typeWarn'),
    err:  t('dashboard.typeErr'),
  };

  // Loading : afficher le skeleton qui mime la future structure.
  if (authLoading || statsLoading) {
    return (
      <DashboardSkeleton
        row1Count={Math.max(kpisRow1.length, 4)}
        row2Count={kpisRow2.length}
        showChart={showChart}
        showTopLines={showTopLines}
        showActivity={showActivity}
      />
    );
  }

  // Cas rare : utilisateur sans aucune permission (ou kpisRow1 vide).
  // Affiche un état minimal plutôt qu'un dashboard cassé.
  if (kpisRow1.length === 0 && kpisRow2.length === 0 && !showChart && !showTopLines && !showActivity) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-bold t-text">{t('dashboard.title')}</h1>
          <p className="t-text-2 text-sm mt-1">
            {t('dashboard.today')} — {new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </header>
        <div
          role="status"
          className="t-card-bordered rounded-2xl p-8 text-center"
        >
          <p className="t-text-2 text-sm">{t('dashboard.noAccess')}</p>
        </div>
      </div>
    );
  }

  const canSeeExec = !!user?.permissions?.includes(P_STATS_READ);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold t-text">{t('dashboard.title')}</h1>
        <p className="t-text-2 text-sm mt-1">
          {t('dashboard.today')} — {new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </header>

      {/* Bandeau exécutif "Aujourd'hui" — seulement si permission STATS_READ (gérant/tenant-admin).
          Affiche KPI live + alertes anomalies + actions rapides. Ne remplace
          pas les KPIs gated-by-perm ci-dessous (DRY — KpiCard réutilisé). */}
      {canSeeExec && user?.tenantId && (
        <ExecutiveSummaryBanner tenantId={user.tenantId} />
      )}

      {/* KPIs ligne 1 */}
      {kpisRow1.length > 0 && (
        <section aria-labelledby="dashboard-kpi1-title">
          <h2 id="dashboard-kpi1-title" className="sr-only">{t('dashboard.kpisPrimary')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpisRow1.map(kpi => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </section>
      )}

      {/* KPIs ligne 2 */}
      {kpisRow2.length > 0 && (
        <section aria-labelledby="dashboard-kpi2-title">
          <h2 id="dashboard-kpi2-title" className="sr-only">{t('dashboard.kpisSecondary')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpisRow2.map(kpi => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </section>
      )}

      {/* Charts + Top lignes */}
      {(showChart || showTopLines) && (
        <div className={cn(
          'grid grid-cols-1 gap-4',
          showChart && showTopLines ? 'lg:grid-cols-3'
          : showChart                ? 'lg:grid-cols-1'
          :                            'lg:grid-cols-1',
        )}>
          {/* Graphique ventes */}
          {showChart && (
            <section
              aria-labelledby="dashboard-chart-title"
              className={cn(
                't-card-bordered rounded-2xl p-5',
                showTopLines && 'lg:col-span-2',
              )}
            >
              <h2 id="dashboard-chart-title" className="sr-only">{t('dashboard.revenue7d')}</h2>
              <MiniBarChart label={t('dashboard.revenue7d')} data={hourlyChart} />
            </section>
          )}

          {/* Top lignes */}
          {showTopLines && topLines.length > 0 && (
            <section
              aria-labelledby="dashboard-top-title"
              className="t-card-bordered rounded-2xl p-5 space-y-3"
            >
              <h2 id="dashboard-top-title" className="text-xs font-semibold t-text-2 uppercase tracking-wider">
                {t('dashboard.topLinesToday')}
              </h2>
              {topLines.map(r => (
                <div key={r.route}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="t-text-body font-medium">{r.route}</span>
                    <span className="t-text-2 tabular-nums">{r.pax} pax</span>
                  </div>
                  <div
                    className="w-full bg-gray-200 dark:bg-slate-800 rounded-full h-1.5"
                    role="progressbar"
                    aria-label={`${r.route} — ${r.pct}%`}
                    aria-valuenow={r.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="bg-teal-500 h-1.5 rounded-full"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* Activité récente */}
      {showActivity && activity.length > 0 && (
        <section
          aria-labelledby="dashboard-activity-title"
          className="t-card-bordered rounded-2xl p-5"
        >
          <h2 id="dashboard-activity-title" className="text-xs font-semibold t-text-2 uppercase tracking-wider mb-3">
            {t('dashboard.recentActivity')}
          </h2>
          <ul className="space-y-2">
            {activity.map((e, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="t-text-3 tabular-nums shrink-0 pt-0.5 text-xs">{e.time}</span>
                <span
                  className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', TYPE_DOT[e.type])}
                  aria-label={typeLabel[e.type]}
                  role="img"
                />
                <span className="t-text-body break-words">{e.msg}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
