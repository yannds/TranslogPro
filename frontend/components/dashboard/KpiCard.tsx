/**
 * KpiCard — Carte KPI avec icône, valeur, delta et sous-titre
 *
 * Usage :
 *   <KpiCard label="Billets vendus" value="1 284" icon="Ticket" accent="emerald"
 *            delta={{ value: '12%', up: true }} sub="depuis 06:00" />
 */
import { cn }      from '../../lib/utils';
import { NavIcon } from './NavIcon';
import type { AccentColor, KpiDelta } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KpiCardProps {
  label:   string;
  value:   string;
  sub?:    string;
  delta?:  KpiDelta;
  icon:    string;
  accent?: AccentColor;
}

// ─── Palette d'accents ────────────────────────────────────────────────────────

const ACCENT_CLASSES: Record<AccentColor, string> = {
  teal:    'bg-teal-500/10 text-teal-400',
  amber:   'bg-amber-500/10 text-amber-400',
  emerald: 'bg-emerald-500/10 text-emerald-400',
  purple:  'bg-purple-500/10 text-purple-400',
  red:     'bg-red-500/10 text-red-400',
  blue:    'bg-blue-500/10 text-blue-400',
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, sub, delta, icon, accent = 'teal',
}: KpiCardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', ACCENT_CLASSES[accent])}>
          <NavIcon name={icon} className="w-5 h-5" />
        </div>
        {delta && (
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            delta.up ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400',
          )}>
            {delta.up ? '↑' : '↓'} {delta.value}
          </span>
        )}
      </div>
      <p className="text-3xl font-black text-white tabular-nums">{value}</p>
      <p className="text-sm font-medium text-slate-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}
