/**
 * useDashboardStats — KPIs, graphique et top routes depuis l'API réelle.
 *
 * Sources :
 *   STATS_READ  → /analytics/today-summary  (KPIs jour + série 7j)
 *                 /analytics/top-routes      (classement routes 30j)
 *   autres      → /analytics/kpis            (compteurs légers du jour)
 *
 * Toute valeur affichée est réelle. Le tenant vide affiche des zéros,
 * jamais des données fictives.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../auth/auth.context';
import { apiFetch } from '../api';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import type { KpiItem, ChartPoint, TopLine, ActivityEntry } from '../../components/dashboard/types';

export interface DashboardStatsResult {
  kpisRow1:     KpiItem[];
  kpisRow2:     KpiItem[];
  hourlyChart:  ChartPoint[];
  topLines:     TopLine[];
  activity:     ActivityEntry[];
  showChart:    boolean;
  showTopLines: boolean;
  showActivity: boolean;
  loading:      boolean;
}

// ─── Permission shortcuts ────────────────────────────────────────────────────

const P = {
  STATS_READ:       'control.stats.read.tenant',
  TRIP_READ_TENANT: 'data.trip.read.tenant',
  TRIP_UPDATE:      'data.trip.update.agency',
  TICKET_CREATE:    'data.ticket.create.agency',
  TICKET_READ_A:    'data.ticket.read.agency',
  TICKET_READ_T:    'data.ticket.read.tenant',
  PARCEL_CREATE:    'data.parcel.create.agency',
  PARCEL_UPDATE_A:  'data.parcel.update.agency',
  PARCEL_UPDATE_T:  'data.parcel.update.tenant',
  SAV_CLAIM:        'data.sav.claim.tenant',
  SAV_REPORT:       'data.sav.report.agency',
  FLEET_MANAGE:     'control.fleet.manage.tenant',
  MAINT_APPROVE:    'data.maintenance.approve.tenant',
  IAM_MANAGE:       'control.iam.manage.tenant',
  CASHIER_TX:       'data.cashier.transaction.own',
} as const;

function has(perms: Set<string>, p: string) { return perms.has(p); }
function hasAny(perms: Set<string>, ps: string[]) { return ps.some(p => perms.has(p)); }

// ─── API response types ──────────────────────────────────────────────────────

interface TodaySummary {
  today: {
    revenue:            number;
    ticketsSold:        number;
    parcelsRegistered:  number;
    openIncidents:      number;
    openRegisters:      number;
    discrepancyCount:   number;
    activeTrips:        number;
    fillRate:           number;
    fillRateTripsCount: number;
  };
  revenue7d: Array<{ label: string; value: number }>;
  alerts: { incidentAlert: boolean; discrepancyAlert: boolean; fillRateAlert: boolean };
}

interface SimpleKpis {
  ticketsToday:     number;
  parcelsToday:     number;
  openIncidents:    number;
  openRegisters:    number;
  discrepancyCount: number;
}

interface TopRouteItem {
  routeId:   string;
  routeName: string;
  trips:     number;
  passengers: number;
}

// ─── Number formatting ───────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)} K`;
  return n.toLocaleString('fr-FR');
}

function fmtCurrencyCompact(n: number, fmt: (v: number) => string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)} K`;
  return fmt(n);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDashboardStats(user: AuthUser | null): DashboardStatsResult {
  const fmt = useCurrencyFormatter();

  const perms    = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);
  const tenantId = user?.effectiveTenantId;

  const [todaySummary, setTodaySummary] = useState<TodaySummary | null>(null);
  const [simpleKpis,   setSimpleKpis]   = useState<SimpleKpis | null>(null);
  const [topRoutes,    setTopRoutes]     = useState<TopRouteItem[]>([]);
  const [loading,      setLoading]       = useState(true);

  const canStats   = has(perms, P.STATS_READ);
  const canTickets = hasAny(perms, [P.TICKET_CREATE, P.TICKET_READ_A, P.TICKET_READ_T]);
  const canParcels = hasAny(perms, [P.PARCEL_CREATE, P.PARCEL_UPDATE_A, P.PARCEL_UPDATE_T]);

  useEffect(() => {
    if (!user || !tenantId) { setLoading(false); return; }

    const base = `/api/tenants/${tenantId}/analytics`;
    const fetches: Promise<void>[] = [];

    if (canStats) {
      fetches.push(
        apiFetch<TodaySummary>(`${base}/today-summary`)
          .then(setTodaySummary)
          .catch(() => {}),
      );
      const to   = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 30);
      fetches.push(
        apiFetch<TopRouteItem[]>(
          `${base}/top-routes?from=${from.toISOString()}&to=${to.toISOString()}&limit=4`,
        )
          .then(data => setTopRoutes(Array.isArray(data) ? data : []))
          .catch(() => {}),
      );
    } else if (canTickets || canParcels) {
      fetches.push(
        apiFetch<SimpleKpis>(`${base}/kpis`)
          .then(setSimpleKpis)
          .catch(() => {}),
      );
    }

    Promise.all(fetches).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, canStats, canTickets, canParcels]);

  return useMemo((): DashboardStatsResult => {
    const td = todaySummary?.today;
    const kp = simpleKpis;

    const kpisRow1: KpiItem[] = [];
    const kpisRow2: KpiItem[] = [];

    if (canStats && td) {
      // ── Ligne 1 : KPIs opérationnels principaux ──────────────────────────
      if (hasAny(perms, [P.TRIP_UPDATE, P.TRIP_READ_TENANT])) {
        kpisRow1.push({
          label: 'Trajets actifs',
          value: String(td.activeTrips),
          sub:   `${td.fillRateTripsCount} planifiés`,
          icon:  'MapPin', accent: 'teal',
        });
      }
      if (canTickets) {
        kpisRow1.push({
          label: 'Billets vendus',
          value: fmtNum(td.ticketsSold),
          sub:   "aujourd'hui",
          icon:  'Ticket', accent: 'emerald',
        });
      }
      kpisRow1.push({
        label: 'Recette brute',
        value: fmtCurrencyCompact(td.revenue, fmt),
        sub:   "aujourd'hui",
        icon:  'Landmark', accent: 'amber',
      });
      if (td.fillRateTripsCount > 0) {
        kpisRow1.push({
          label: 'Taux remplissage',
          value: `${Math.round(td.fillRate * 100)} %`,
          sub:   `${td.fillRateTripsCount} bus`,
          delta: td.fillRate < 0.4 ? { value: 'Bas', up: false } : undefined,
          icon:  'BarChart3', accent: td.fillRate < 0.4 ? 'red' : 'purple',
        });
      }

      // ── Ligne 2 : KPIs secondaires ────────────────────────────────────────
      if (canParcels) {
        kpisRow2.push({
          label: 'Colis enregistrés',
          value: fmtNum(td.parcelsRegistered),
          sub:   "aujourd'hui",
          icon:  'Package', accent: 'blue',
        });
      }
      if (hasAny(perms, [P.SAV_CLAIM, P.SAV_REPORT]) || td.openIncidents > 0) {
        kpisRow2.push({
          label: 'Incidents ouverts',
          value: String(td.openIncidents),
          sub:   td.openIncidents === 0 ? 'aucun' : 'en attente',
          icon:  'AlertCircle', accent: td.openIncidents > 0 ? 'red' : 'teal',
        });
      }
      if (td.discrepancyCount > 0 && hasAny(perms, [P.IAM_MANAGE, P.CASHIER_TX])) {
        kpisRow2.push({
          label: 'Écarts caisse',
          value: String(td.discrepancyCount),
          sub:   '30 derniers jours',
          delta: { value: String(td.discrepancyCount), up: false },
          icon:  'AlertTriangle', accent: 'red',
        });
      }
      if (hasAny(perms, [P.FLEET_MANAGE, P.MAINT_APPROVE]) && td.openRegisters > 0) {
        kpisRow2.push({
          label: 'Caisses ouvertes',
          value: String(td.openRegisters),
          icon:  'Landmark', accent: 'teal',
        });
      }

    } else if (kp) {
      // ── Utilisateur sans STATS_READ : compteurs légers ───────────────────
      if (canTickets) {
        kpisRow1.push({
          label: 'Billets vendus',
          value: fmtNum(kp.ticketsToday),
          sub:   "aujourd'hui",
          icon:  'Ticket', accent: 'emerald',
        });
      }
      if (canParcels) {
        kpisRow1.push({
          label: 'Colis enregistrés',
          value: fmtNum(kp.parcelsToday),
          sub:   "aujourd'hui",
          icon:  'Package', accent: 'blue',
        });
      }
      if (kp.openIncidents > 0 && hasAny(perms, [P.SAV_CLAIM, P.SAV_REPORT])) {
        kpisRow2.push({
          label: 'Incidents ouverts',
          value: String(kp.openIncidents),
          sub:   'en attente',
          icon:  'AlertCircle', accent: 'red',
        });
      }
    }

    // ── Graphique : série CA 7j ───────────────────────────────────────────
    const chartData: ChartPoint[] = (todaySummary?.revenue7d ?? []).map(p => ({
      label: p.label.slice(5).replace('-', '/'), // "2026-04-21" → "04/21"
      value: p.value,
    }));

    // ── Top lignes : routes 30j ───────────────────────────────────────────
    const maxPax = topRoutes.reduce((m, r) => Math.max(m, r.passengers), 1);
    const topLinesMapped: TopLine[] = topRoutes.map(r => ({
      route: r.routeName,
      pax:   r.passengers,
      pct:   Math.round((r.passengers / maxPax) * 100),
    }));

    const showChart    = canStats && chartData.length > 0;
    const showTopLines = canStats && topLinesMapped.length > 0;

    return {
      kpisRow1:    kpisRow1.slice(0, 4),
      kpisRow2:    kpisRow2.slice(0, 4),
      hourlyChart: chartData,
      topLines:    topLinesMapped,
      activity:    [],
      showChart,
      showTopLines,
      showActivity: false,
      loading,
    };
  }, [todaySummary, simpleKpis, topRoutes, perms, loading, fmt, canStats, canTickets, canParcels]);
}
