/**
 * types.ts — Interfaces partagées des composants dashboard
 *
 * Ces types décrivent les données utilisées par :
 *   - KpiCard, MiniBarChart (composants atomiques)
 *   - PageDashboard, PageTrips, PageAnalytics… (pages internes)
 *   - useDashboardStats (hook de données)
 */

// ─── Couleurs d'accentuation KPI ─────────────────────────────────────────────

export type AccentColor = 'teal' | 'amber' | 'emerald' | 'purple' | 'red' | 'blue';

// ─── KPI Card ─────────────────────────────────────────────────────────────────

export interface KpiDelta {
  value: string;
  up:    boolean;
}

export interface KpiItem {
  label:  string;
  value:  string;
  sub?:   string;
  delta?: KpiDelta;
  icon:   string;
  accent: AccentColor;
}

// ─── Graphiques ───────────────────────────────────────────────────────────────

export interface ChartPoint {
  label: string;
  value: number;
}

// ─── Dashboard home ───────────────────────────────────────────────────────────

export interface TopLine {
  route: string;
  pax:   number;
  pct:   number;
}

export interface ActivityEntry {
  time: string;
  msg:  string;
  type: 'ok' | 'warn' | 'err';
}

// ─── Trajets ──────────────────────────────────────────────────────────────────

export interface TripRow {
  from:   string;
  to:     string;
  time:   string;
  quai:   string;
  pax:    string;
  status: string;
  color:  string;
}

// ─── Flotte ───────────────────────────────────────────────────────────────────

export interface BusItem {
  id:        string;
  model:     string;
  capacity:  number;
  status:    string;
  km:        string;
  nextMaint: string;
  color:     string;
}

// ─── Caisse ───────────────────────────────────────────────────────────────────

export interface CashierTransaction {
  time:    string;
  op:      string;
  montant: string;
  ok:      boolean;
}

export interface CashierSummaryLine {
  label: string;
  value: string;
  color: string;
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

export interface CrmClient {
  name:   string;
  tel:    string;
  trips:  number;
  points: number;
  tier:   string;
}

// ─── IA / Lignes rentables ────────────────────────────────────────────────────

export interface AiRoute {
  route:   string;
  score:   number;
  marge:   string;
  freq:    string;
  conseil: string;
}

// ─── Écrans d'affichage ───────────────────────────────────────────────────────

export interface ScreenItem {
  name:   string;
  type:   string;
  status: string;
  last:   string;
}
