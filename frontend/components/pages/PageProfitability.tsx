/**
 * PageProfitability — Tableau de rentabilité TranslogPro
 *
 * Données :
 *   GET /api/v1/tenants/:tid/analytics/profitability?from=...&to=...
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible
 * Dark mode : classes Tailwind dark: via ThemeProvider
 */

import { useState } from 'react';
import { TrendingUp, TrendingDown, BarChart3, Percent, RefreshCw } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useAuth } from '../../lib/auth/auth.context';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfitabilitySummary {
  period:                  { from: string; to: string };
  tripCount:               number;
  totalRevenue:            number;
  totalCost:               number;
  totalNetMargin:          number;
  totalOperationalMargin:  number;
  globalNetMarginRate:     number;
  avgFillRate:             number;
  byTag:                   Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, symbol = 'FCFA') {
  return `${new Intl.NumberFormat('fr-FR').format(Math.round(amount))} ${symbol}`;
}

function formatPct(rate: number) {
  return `${(rate * 100).toFixed(1)} %`;
}

const TAG_LABELS: Record<string, string> = {
  PROFITABLE:       'Rentable',
  BREAK_EVEN:       'Équilibre',
  UNPROFITABLE:     'Déficitaire',
  HIGHLY_PROFITABLE: 'Très rentable',
};

const TAG_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  PROFITABLE:        'success',
  BREAK_EVEN:        'warning',
  UNPROFITABLE:      'danger',
  HIGHLY_PROFITABLE: 'success',
};

// ─── Sélecteur de période ─────────────────────────────────────────────────────

function periodDates(days: number): { from: string; to: string } {
  const to   = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageProfitability() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [periodDays, setPeriodDays] = useState(30);
  const { from, to } = periodDates(periodDays);

  const { data, loading, error, refetch } = useFetch<ProfitabilitySummary>(
    `/api/v1/tenants/${tenantId}/analytics/profitability?from=${from}&to=${to}`,
    [tenantId, periodDays],
  );

  const PERIODS = [
    { label: '7 jours',  days: 7  },
    { label: '30 jours', days: 30 },
    { label: '90 jours', days: 90 },
  ];

  return (
    <div className="p-6 space-y-6">

      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Rentabilité</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Analyse des coûts et marges par trajet
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sélecteur de période */}
          <div
            role="group"
            aria-label="Sélectionner la période"
            className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {PERIODS.map(p => (
              <button
                key={p.days}
                type="button"
                onClick={() => setPeriodDays(p.days)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  periodDays === p.days
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refetch}
            aria-label="Actualiser"
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} aria-hidden />
          </button>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))
        ) : data ? (
          <>
            <KpiCard
              label="Recette totale"
              value={formatCurrency(data.totalRevenue)}
              icon={<TrendingUp className="w-5 h-5" aria-hidden />}
              accent="emerald"
            />
            <KpiCard
              label="Coûts totaux"
              value={formatCurrency(data.totalCost)}
              icon={<TrendingDown className="w-5 h-5" aria-hidden />}
              accent="red"
            />
            <KpiCard
              label="Marge nette"
              value={formatCurrency(data.totalNetMargin)}
              sub={`Taux : ${formatPct(data.globalNetMarginRate)}`}
              icon={<BarChart3 className="w-5 h-5" aria-hidden />}
              accent={data.totalNetMargin >= 0 ? 'blue' : 'red'}
            />
            <KpiCard
              label="Taux de remplissage"
              value={formatPct(data.avgFillRate)}
              sub={`${data.tripCount} trajets analysés`}
              icon={<Percent className="w-5 h-5" aria-hidden />}
              accent="amber"
            />
          </>
        ) : null}
      </div>

      {/* Répartition par tag */}
      {data && !loading && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Répartition par rentabilité
            </h2>
          </CardHeader>
          <CardContent>
            {Object.keys(data.byTag).length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                Aucune donnée sur cette période
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(data.byTag).map(([tag, count]) => {
                  const total = Object.values(data.byTag).reduce((a, b) => a + b, 0);
                  const pct   = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={tag} className="flex items-center gap-4">
                      <div className="w-32 shrink-0">
                        <Badge variant={TAG_VARIANTS[tag] ?? 'default'}>
                          {TAG_LABELS[tag] ?? tag}
                        </Badge>
                      </div>
                      <div className="flex-1 flex items-center gap-3">
                        <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div
                            className={cn(
                              'h-2 rounded-full transition-all',
                              TAG_VARIANTS[tag] === 'success' ? 'bg-emerald-500' :
                              TAG_VARIANTS[tag] === 'danger'  ? 'bg-red-500' :
                              TAG_VARIANTS[tag] === 'warning' ? 'bg-amber-500' : 'bg-blue-500',
                            )}
                            style={{ width: `${pct}%` }}
                            aria-label={`${pct.toFixed(0)}%`}
                          />
                        </div>
                        <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums w-20 text-right shrink-0">
                          {count} trajet{count > 1 ? 's' : ''} ({pct.toFixed(0)} %)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, accent = 'blue',
}: {
  label:  string;
  value:  string;
  sub?:   string;
  icon:   React.ReactNode;
  accent?: 'emerald' | 'red' | 'blue' | 'amber';
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    red:     'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    blue:    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  };
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn('p-2 rounded-lg', colors[accent])}>
            {icon}
          </div>
        </div>
        <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
