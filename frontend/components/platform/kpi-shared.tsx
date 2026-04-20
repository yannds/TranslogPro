/**
 * kpi-shared — Helpers UI communs aux sections KPI plateforme.
 *
 * Principe DRY : chaque section (NorthStar, MrrBreakdown, Retention, etc.)
 * consomme ces briques au lieu de dupliquer le JSX. Elles complètent le
 * `KpiCard` canonique du projet quand on a besoin de variations spécifiques
 * (icône `ReactNode` au lieu d'une string, tone amber/red/emerald sémantique).
 *
 * Tokens sémantiques uniquement (t-card-bordered, t-text*, t-delta-*).
 * Dark + light natif via variants Tailwind.
 */

import React from 'react';

// ─── KPI Tile ──────────────────────────────────────────────────────────────

export type KpiTone = 'teal' | 'amber' | 'blue' | 'slate' | 'red' | 'emerald' | 'purple';

const TONE_CLASSES: Record<KpiTone, string> = {
  teal:    'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  amber:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blue:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  slate:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  red:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  purple:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

export interface KpiTileProps {
  label:   string;
  value:   string | number;
  hint?:   string;
  icon:    React.ReactNode;
  tone:    KpiTone;
  loading?: boolean;
}

export function KpiTile({ label, value, hint, icon, tone, loading }: KpiTileProps) {
  return (
    <div className="t-card-bordered rounded-2xl p-5 flex items-start gap-4" aria-busy={loading || undefined}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${TONE_CLASSES[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide t-text-2">{label}</p>
        <p className="mt-1 text-2xl font-bold t-text tabular-nums">
          {loading ? <span className="inline-block h-6 w-20 rounded animate-pulse bg-slate-200 dark:bg-slate-700" /> : value}
        </p>
        {hint && <p className="mt-0.5 text-xs t-text-3 truncate">{hint}</p>}
      </div>
    </div>
  );
}

// ─── Progress bar (pour funnel / module adoption) ──────────────────────────

export interface ProgressBarProps {
  label:  string;
  value:  number;      // numérateur brut (affichage)
  pct:    number;      // 0..1
  ariaLabel?: string;
  tone?:  'teal' | 'emerald' | 'amber' | 'red';
}

const BAR_COLOR: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  teal:    'bg-teal-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  red:     'bg-red-500',
};

export function ProgressBar({ label, value, pct, ariaLabel, tone = 'teal' }: ProgressBarProps) {
  const pctRound = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="t-text-body font-medium font-mono">{label}</span>
        <span className="t-text-2 tabular-nums">{value} · {pctRound}%</span>
      </div>
      <div
        className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5"
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuenow={pctRound}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`${BAR_COLOR[tone]} h-1.5 rounded-full transition-all`} style={{ width: `${pctRound}%` }} />
      </div>
    </div>
  );
}

// ─── Sparkline SVG minimale ────────────────────────────────────────────────

export interface SparkPoint { date: string; count?: number; dau?: number; value?: number }

export function Sparkline({ data, ariaLabel }: { data: SparkPoint[]; ariaLabel: string }) {
  if (!data || data.length === 0) return <span className="text-xs t-text-3">—</span>;
  const values = data.map((d) => d.count ?? d.dau ?? d.value ?? 0);
  const max = Math.max(1, ...values);
  const w = 180;
  const h = 40;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(' ');
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-10 text-teal-500"
      preserveAspectRatio="none"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}

// ─── Section header (header commun à toutes les sous-sections) ─────────────

export function SectionHeader({
  id,
  icon,
  title,
  extra,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-teal-600 dark:text-teal-400" aria-hidden>{icon}</span>
        <h2 id={id} className="text-sm font-semibold uppercase tracking-wider t-text-2">
          {title}
        </h2>
      </div>
      {extra}
    </header>
  );
}

// ─── Format helpers (présentation uniquement) ──────────────────────────────

export function formatCurrencyMap(map: Record<string, number>, maxDigits = 0): string {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return '—';
  return entries
    .map(([ccy, amount]) => `${Math.round(amount * Math.pow(10, maxDigits)) / Math.pow(10, maxDigits)} ${ccy}`)
    .join(' · ');
}

export function pctDisplay(pct: number | null | undefined, digits = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${(pct * 100).toFixed(digits)}%`;
}

// ─── Hook — filtre période partagé entre sections ──────────────────────────

export function usePeriodFilter(defaultDays = 30) {
  const [days, setDays] = React.useState(defaultDays);
  return { days, setDays };
}
