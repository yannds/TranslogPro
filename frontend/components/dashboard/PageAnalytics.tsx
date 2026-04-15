/**
 * PageAnalytics — Tableaux analytiques (graphiques par période)
 *
 * Future intégration : GET /api/v1/tenants/:id/analytics/weekly
 */
import { MiniBarChart } from './MiniBarChart';
import type { ChartPoint } from './types';

// ─── Données mock ─────────────────────────────────────────────────────────────

const REVENUE_7D: ChartPoint[] = [
  { label: 'Lun', value: 5.2 }, { label: 'Mar', value: 6.8 }, { label: 'Mer', value: 4.9 },
  { label: 'Jeu', value: 7.1 }, { label: 'Ven', value: 8.4 }, { label: 'Sam', value: 9.2 },
  { label: 'Dim', value: 6.7 },
];

const PASSENGERS_BY_LINE: ChartPoint[] = [
  { label: 'BZV↔PNR', value: 42 }, { label: 'BZV↔DOL', value: 28 },
  { label: 'BZV↔NKY', value: 18 }, { label: 'PNR↔DOL', value: 14 },
  { label: 'BZV↔OUE', value: 9  },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageAnalytics() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Tableaux analytiques</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label="Recette 7 derniers jours (FCFA ×1M)"
            data={REVENUE_7D}
          />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label="Passagers par ligne (milliers)"
            data={PASSENGERS_BY_LINE}
          />
        </div>
      </div>
    </div>
  );
}
