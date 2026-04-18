/**
 * useDashboardStats — KPIs, graphiques et activité filtrés selon les permissions.
 *
 * Conforme à la règle projet : aucune dérivation depuis roleName côté frontend.
 * Toute la visibilité est déduite de `user.permissions[]` (source de vérité backend).
 *
 * Structure prête pour l'API :
 *   remplacer la simulation par useFetch<DashboardStatsResult>(
 *     `/api/v1/tenants/${id}/analytics/summary`
 *   )
 */

import { useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../auth/auth.context';
import type { KpiItem, ChartPoint, TopLine, ActivityEntry } from '../../components/dashboard/types';

export interface DashboardStatsResult {
  kpisRow1:    KpiItem[];
  kpisRow2:    KpiItem[];
  hourlyChart: ChartPoint[];
  topLines:    TopLine[];
  activity:    ActivityEntry[];
  showChart:   boolean;
  showTopLines: boolean;
  showActivity: boolean;
  loading:     boolean;
}

// ─── Permissions (shortcuts) ─────────────────────────────────────────────────

const P = {
  STATS_READ:          'control.stats.read.tenant',
  TRIP_UPDATE:         'data.trip.update.agency',
  TRIP_CREATE:         'data.trip.create.tenant',
  TRIP_READ_TENANT:    'data.trip.read.tenant',
  TRIP_READ_OWN:       'data.trip.read.own',
  TRIP_DELAY:          'control.trip.delay.agency',
  TRIP_CHECK_OWN:      'data.trip.check.own',
  TICKET_CREATE:       'data.ticket.create.agency',
  TICKET_READ_AGENCY:  'data.ticket.read.agency',
  TICKET_READ_TENANT:  'data.ticket.read.tenant',
  TICKET_CANCEL:       'data.ticket.cancel.agency',
  PARCEL_CREATE:       'data.parcel.create.agency',
  PARCEL_UPDATE_A:     'data.parcel.update.agency',
  PARCEL_UPDATE_T:     'data.parcel.update.tenant',
  SAV_CLAIM:           'data.sav.claim.tenant',
  SAV_REPORT:          'data.sav.report.agency',
  FLEET_MANAGE:        'control.fleet.manage.tenant',
  MAINT_APPROVE:       'data.maintenance.approve.tenant',
  IAM_MANAGE:          'control.iam.manage.tenant',
  STAFF_READ:          'data.staff.read.agency',
  MANIFEST_READ_OWN:   'data.manifest.read.own',
  MANIFEST_GENERATE:   'data.manifest.generate.agency',
  MANIFEST_SIGN:       'data.manifest.sign.agency',
  CASHIER_OPEN:        'data.cashier.open.own',
  CASHIER_TX:          'data.cashier.transaction.own',
  CASHIER_CLOSE:       'data.cashier.close.agency',
  ACCIDENT_REPORT:     'data.accident.report.own',
  TRIP_LOG_EVENT:      'control.trip.log_event.own',
} as const;

function hasAny(perms: Set<string>, required: string[]): boolean {
  for (const p of required) if (perms.has(p)) return true;
  return false;
}

// ─── Données statiques par bloc (à migrer vers API) ───────────────────────────

const HOURLY_CHART: ChartPoint[] = [
  { label: '6h',  value: 42  }, { label: '7h',  value: 87  },
  { label: '8h',  value: 134 }, { label: '9h',  value: 156 },
  { label: '10h', value: 98  }, { label: '11h', value: 110 },
  { label: '12h', value: 76  }, { label: '13h', value: 88  },
  { label: '14h', value: 145 },
];

const TOP_LINES: TopLine[] = [
  { route: 'BZV → PNR', pax: 312, pct: 92 },
  { route: 'BZV → DOL', pax: 198, pct: 74 },
  { route: 'PNR → BZV', pax: 287, pct: 88 },
  { route: 'BZV → NKY', pax: 156, pct: 65 },
];

// ─── Blocs de KPIs réutilisables — chaque KPI connaît les permissions qui l'autorisent ──────

interface GatedKpi extends KpiItem {
  /** Au moins une de ces permissions est requise pour afficher ce KPI */
  requires: string[];
  /** Groupe — utilisé pour grouper les KPIs en ligne 1 (opé) vs ligne 2 (secondaire) */
  tier: 'primary' | 'secondary';
}

const ALL_KPIS: Record<string, GatedKpi> = {
  trips:     { label: 'Trajets du jour',       value: '24',     sub: '6 en cours',        delta: { value: '8%',  up: true  }, icon: 'MapPin',               accent: 'teal',    requires: [P.TRIP_UPDATE, P.TRIP_READ_TENANT, P.TRIP_CREATE], tier: 'primary' },
  tickets:   { label: 'Billets vendus',        value: '1 284',  sub: 'depuis 06:00',      delta: { value: '12%', up: true  }, icon: 'Ticket',               accent: 'emerald', requires: [P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT, P.TICKET_CREATE], tier: 'primary' },
  revenue:   { label: 'Recette brute',         value: '6,8 M',  sub: "FCFA aujourd'hui",  delta: { value: '3%',  up: true  }, icon: 'Landmark',             accent: 'amber',   requires: [P.STATS_READ], tier: 'primary' },
  fill:      { label: 'Taux remplissage',      value: '78 %',   sub: 'sur 24 bus',        delta: { value: '2%',  up: false }, icon: 'BarChart3',            accent: 'purple',  requires: [P.STATS_READ, P.TRIP_UPDATE], tier: 'primary' },
  parcels:   { label: 'Colis enregistrés',     value: '312',    sub: '18 en retard',                                          icon: 'Package',              accent: 'blue',    requires: [P.PARCEL_UPDATE_A, P.PARCEL_UPDATE_T, P.PARCEL_CREATE], tier: 'secondary' },
  sav:       { label: 'Réclamations SAV',      value: '7',      sub: '3 critiques',       delta: { value: '2',   up: false }, icon: 'MessageSquareWarning', accent: 'red',     requires: [P.SAV_CLAIM, P.SAV_REPORT], tier: 'secondary' },
  maint:     { label: 'Bus en maintenance',    value: '3',      sub: '1 urgent',                                              icon: 'Wrench',               accent: 'amber',   requires: [P.FLEET_MANAGE, P.MAINT_APPROVE], tier: 'secondary' },
  agents:    { label: 'Agents connectés',      value: '14',     sub: 'sur 18 prévus',                                         icon: 'Users',                accent: 'teal',    requires: [P.IAM_MANAGE, P.STAFF_READ], tier: 'secondary' },
  delays:    { label: 'Retards signalés',      value: '4',      sub: 'dont 1 critique',   delta: { value: '1',   up: false }, icon: 'AlertTriangle',        accent: 'red',     requires: [P.TRIP_DELAY, P.TRIP_UPDATE], tier: 'secondary' },
  manifests: { label: 'Manifestes signés',     value: '18',     sub: 'sur 24 trajets',                                        icon: 'ClipboardList',        accent: 'emerald', requires: [P.MANIFEST_GENERATE, P.MANIFEST_SIGN, P.MANIFEST_READ_OWN], tier: 'secondary' },
  cashier:   { label: 'Recette caisse',        value: '487 K',  sub: 'FCFA ce jour',      delta: { value: '9%',  up: true  }, icon: 'Landmark',             accent: 'amber',   requires: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE], tier: 'primary' },
  tx:        { label: 'Transactions',          value: '213',    sub: 'depuis ouverture',                                      icon: 'CreditCard',           accent: 'teal',    requires: [P.CASHIER_OPEN, P.CASHIER_TX], tier: 'primary' },
  cancel:    { label: 'Annulations',           value: '6',      sub: 'dont 2 remboursées',                                    icon: 'XCircle',              accent: 'red',     requires: [P.TICKET_CANCEL], tier: 'secondary' },
  myTrips:   { label: 'Mes trajets aujourd\'hui', value: '2',   sub: 'dont 1 en cours',                                       icon: 'MapPin',               accent: 'teal',    requires: [P.TRIP_READ_OWN], tier: 'primary' },
  myBus:     { label: 'Mon bus',               value: 'KA-012', sub: 'État : OK',                                             icon: 'Bus',                  accent: 'emerald', requires: [P.TRIP_READ_OWN, P.TRIP_CHECK_OWN], tier: 'primary' },
  myPax:     { label: 'Passagers prévus',      value: '48',     sub: 'sur le prochain trajet',                                icon: 'Users',                accent: 'blue',    requires: [P.TRIP_READ_OWN], tier: 'primary' },
  incidents: { label: 'Incidents signalés',    value: '1',      sub: 'en attente',        delta: { value: '1',   up: false }, icon: 'AlertCircle',          accent: 'red',     requires: [P.ACCIDENT_REPORT, P.SAV_REPORT, P.TRIP_LOG_EVENT], tier: 'secondary' },
};

// ─── Activité : chaque entrée peut être gatée par permission ──────────────────

interface GatedActivity extends ActivityEntry {
  requires: string[];
}

const ACTIVITY_POOL: GatedActivity[] = [
  { time: '14:22', msg: 'Trajet BZV→PNR 14:00 — Embarquement terminé (48/50 pax)',    type: 'ok',   requires: [P.TRIP_UPDATE, P.TRIP_READ_TENANT] },
  { time: '14:20', msg: 'Billet #8821 émis — BZV→PNR · Koffi Jean',                   type: 'ok',   requires: [P.TICKET_CREATE, P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT] },
  { time: '14:18', msg: 'Retard 25 min signalé — BZV→DOL départ 14:15',               type: 'warn', requires: [P.TRIP_DELAY, P.TRIP_UPDATE, P.TRIP_READ_TENANT] },
  { time: '14:11', msg: 'Annulation #8815 — Remboursement 3 500 FCFA',                type: 'warn', requires: [P.TICKET_CANCEL, P.CASHIER_TX] },
  { time: '14:10', msg: 'Manifeste #M-1084 signé — BZV→NKY',                          type: 'ok',   requires: [P.MANIFEST_GENERATE, P.MANIFEST_SIGN] },
  { time: '14:05', msg: 'Nouvelle réclamation SAV #1284 — Bagage manquant',           type: 'err',  requires: [P.SAV_CLAIM, P.SAV_REPORT] },
  { time: '14:02', msg: 'Colis #C-441 enregistré — 4,2 kg — BZV→NKY',                 type: 'ok',   requires: [P.PARCEL_CREATE, P.PARCEL_UPDATE_A] },
  { time: '13:58', msg: 'Caisse #3 ouverte par Sylvère Makosso',                      type: 'ok',   requires: [P.CASHIER_OPEN, P.CASHIER_CLOSE, P.IAM_MANAGE] },
  { time: '13:45', msg: 'Bus KA-4421-B affecté au garage — maintenance préventive',   type: 'warn', requires: [P.FLEET_MANAGE, P.MAINT_APPROVE] },
  { time: '13:30', msg: 'Contrôle technique bus KA-012 validé',                       type: 'ok',   requires: [P.TRIP_CHECK_OWN, P.FLEET_MANAGE] },
  { time: '13:15', msg: 'Incident signalé — bagages quai 2',                           type: 'err',  requires: [P.ACCIDENT_REPORT, P.SAV_REPORT] },
];

// ─── Hook principal ───────────────────────────────────────────────────────────

/**
 * Compose le dashboard à partir des permissions de l'utilisateur.
 *
 * @param user AuthUser (ou null si non connecté → renvoie loading=true)
 * @param options.simulateLoadingMs Durée de loading simulée (dev). 0 = immediate.
 *        Ne pas garder en prod une fois branché sur l'API.
 */
export function useDashboardStats(
  user: AuthUser | null,
  options: { simulateLoadingMs?: number } = {},
): DashboardStatsResult {
  const { simulateLoadingMs = 500 } = options;
  const [loading, setLoading] = useState<boolean>(simulateLoadingMs > 0 && !!user);

  useEffect(() => {
    if (!user) return;
    if (simulateLoadingMs <= 0) { setLoading(false); return; }
    const t = setTimeout(() => setLoading(false), simulateLoadingMs);
    return () => clearTimeout(t);
  }, [user, simulateLoadingMs]);

  const perms = useMemo(
    () => new Set(user?.permissions ?? []),
    [user?.permissions],
  );

  const visible = useMemo(() => {
    const kpis = Object.values(ALL_KPIS).filter(k => hasAny(perms, k.requires));
    const primary   = kpis.filter(k => k.tier === 'primary');
    const secondary = kpis.filter(k => k.tier === 'secondary');
    return {
      kpisRow1: primary.slice(0, 4),
      kpisRow2: primary.length > 4
        ? [...primary.slice(4), ...secondary].slice(0, 4)
        : secondary.slice(0, 4),
      showChart:    hasAny(perms, [P.STATS_READ]),
      showTopLines: hasAny(perms, [P.STATS_READ, P.TRIP_READ_TENANT]),
      showActivity: perms.size > 0,
      activity:     ACTIVITY_POOL
        .filter(a => hasAny(perms, a.requires))
        .slice(0, 6),
    };
  }, [perms]);

  return {
    kpisRow1:    visible.kpisRow1,
    kpisRow2:    visible.kpisRow2,
    hourlyChart: visible.showChart ? HOURLY_CHART : [],
    topLines:    visible.showTopLines ? TOP_LINES : [],
    activity:    visible.activity,
    showChart:    visible.showChart,
    showTopLines: visible.showTopLines,
    showActivity: visible.showActivity,
    loading,
  };
}
