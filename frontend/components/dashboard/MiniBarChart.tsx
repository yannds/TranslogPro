/**
 * MiniBarChart — Graphique en barres CSS (pas de dépendance externe)
 *
 * Usage :
 *   <MiniBarChart
 *     label="Ventes par heure"
 *     data={[{ label: '8h', value: 134 }, ...]}
 *   />
 *
 * Note : composant pur, sans état ni effets.
 */
import type { ChartPoint } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MiniBarChartProps {
  /** Titre affiché au-dessus du graphique */
  label: string;
  /** Points de données — valeur max utilisée comme référence 100% */
  data:  ChartPoint[];
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function MiniBarChart({ data, label }: MiniBarChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        {label}
      </p>
      <div className="flex items-end gap-1.5 h-24" role="img" aria-label={label}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-teal-500/70 hover:bg-teal-400 transition-colors"
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
            <span className="text-[9px] text-slate-600">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
