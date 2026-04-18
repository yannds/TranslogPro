/**
 * MiniBarChart — Graphique en barres CSS (pas de dépendance externe).
 *
 * Compat light/dark via tokens sémantiques.
 * Accessibilité : role="img" + aria-label + description tabulaire cachée
 * pour lecteurs d'écran (liste des points lisible).
 */
import type { ChartPoint } from './types';

export interface MiniBarChartProps {
  /** Titre affiché au-dessus du graphique */
  label: string;
  /** Points de données — valeur max utilisée comme référence 100% */
  data:  ChartPoint[];
  /** Suffixe d'unité pour l'annonce a11y (ex: "FCFA", "pax") */
  unit?: string;
}

export function MiniBarChart({ data, label, unit }: MiniBarChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);
  const summary = data
    .map(d => `${d.label}: ${d.value}${unit ? ` ${unit}` : ''}`)
    .join(', ');

  return (
    <div>
      <p className="text-xs font-semibold t-text-2 uppercase tracking-wider mb-3">
        {label}
      </p>
      <div
        className="flex items-end gap-1.5 h-24"
        role="img"
        aria-label={`${label}. ${summary}`}
      >
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-teal-500/70 hover:bg-teal-500 focus-visible:bg-teal-500 transition-colors"
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}${unit ? ` ${unit}` : ''}`}
            />
            <span className="text-[10px] t-text-3 tabular-nums">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
