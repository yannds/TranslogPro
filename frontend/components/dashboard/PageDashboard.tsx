/**
 * PageDashboard — Tableau de bord principal
 *
 * Données via useDashboardStats (prêt pour API).
 * Composants : KpiCard (x8), MiniBarChart, TopLines, ActivityFeed.
 */
import { cn }                  from '../../lib/utils';
import { KpiCard }             from './KpiCard';
import { MiniBarChart }        from './MiniBarChart';
import { useDashboardStats }   from '../../lib/hooks/useDashboardStats';
import type { ActivityEntry }  from './types';

// ─── Activity Feed ────────────────────────────────────────────────────────────

const TYPE_DOT: Record<ActivityEntry['type'], string> = {
  ok:   'bg-emerald-500',
  warn: 'bg-amber-500',
  err:  'bg-red-500',
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageDashboard() {
  const { kpisRow1, kpisRow2, hourlyChart, topLines, activity } = useDashboardStats();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Tableau de bord</h1>
        <p className="text-slate-400 text-sm mt-1">
          Aujourd&apos;hui — {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPIs ligne 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpisRow1.map(kpi => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* KPIs ligne 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpisRow2.map(kpi => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Graphique ventes */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart label="Ventes par heure" data={hourlyChart} />
        </div>

        {/* Top lignes */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Top lignes du jour
          </p>
          {topLines.map(r => (
            <div key={r.route}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300 font-medium">{r.route}</span>
                <span className="text-slate-500">{r.pax} pax</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5">
                <div
                  className="bg-teal-500 h-1.5 rounded-full"
                  style={{ width: `${r.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activité récente */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Activité récente
        </p>
        <div className="space-y-2">
          {activity.map((e, i) => (
            <div key={i} className="flex items-start gap-3 text-sm">
              <span className="text-slate-600 tabular-nums shrink-0 pt-0.5">{e.time}</span>
              <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', TYPE_DOT[e.type])} />
              <span className="text-slate-300">{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
