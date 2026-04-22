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

// ─── IA / Yield management ───────────────────────────────────────────────────

export interface AiRoute {
  route:        string;
  score:        number;
  marge:        string;
  fillRate:     number;
  trips:        number;
  conseil:      string;
  isBlackRoute: boolean;
}

export interface FleetAdvice {
  id:       string;
  category: 'rightsize' | 'assignment' | 'maintenance';
  vehicle:  string;
  title:    string;
  detail:   string;
  impact:   string;
  score:    number;
}

export interface PricingSuggestion {
  id:            string;
  route:         string;
  slot:          string;
  currentFare:   number;
  suggested:     number;
  fillRate:       number;
  revenueImpact: number;
  confidence:    number;
  rationale:     string;
}

export interface Report {
  id:     string;
  title:  string;
  period: 'daily' | 'weekly' | 'monthly';
  date:   string;
  amount: number;
  status: 'ready' | 'discrepancy';
}

// ─── Écrans d'affichage ───────────────────────────────────────────────────────

export interface ScreenItem {
  name:   string;
  type:   string;
  status: string;
  last:   string;
}
