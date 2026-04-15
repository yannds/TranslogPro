/**
 * KpiCard — Carte KPI avec icône, valeur, delta et sous-titre
 *
 * Utilise les tokens sémantiques (t-card-bordered, t-text, …) — jamais de
 * couleurs brutes. Pour changer le thème, modifier index.css uniquement.
 */
import { cn }      from '../../lib/utils';
import { NavIcon } from './NavIcon';
import type { AccentColor, KpiDelta } from './types';

export interface KpiCardProps {
  label:   string;
  value:   string;
  sub?:    string;
  delta?:  KpiDelta;
  icon:    string;
  accent?: AccentColor;
}

const ACCENT_CLASSES: Record<AccentColor, string> = {
  teal:    'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  amber:   'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  purple:  'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  red:     'bg-red-500/10 text-red-600 dark:text-red-400',
  blue:    'bg-blue-500/10 text-blue-600 dark:text-blue-400',
};

export function KpiCard({ label, value, sub, delta, icon, accent = 'teal' }: KpiCardProps) {
  return (
    <div className="t-card-bordered rounded-2xl p-5 hover:border-gray-300 dark:hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', ACCENT_CLASSES[accent])}>
          <NavIcon name={icon} className="w-5 h-5" />
        </div>
        {delta && (
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            delta.up ? 't-delta-up' : 't-delta-down',
          )}>
            {delta.up ? '↑' : '↓'} {delta.value}
          </span>
        )}
      </div>
      <p className="text-3xl font-black t-text tabular-nums">{value}</p>
      <p className="text-sm font-medium t-text-2 mt-1">{label}</p>
      {sub && <p className="text-xs t-text-3 mt-0.5">{sub}</p>}
    </div>
  );
}
