/**
 * useDashboardStats — KPIs, graphiques et activité filtrés selon le rôle
 *
 * Chaque profil voit uniquement les métriques qui le concernent (PRD §Profils).
 * Structure prête pour l'API : remplacer les constantes par
 *   useFetch<DashboardStatsResult>(`/api/v1/tenants/${id}/analytics/summary?role=${role}`)
 */

import type { KpiItem, ChartPoint, TopLine, ActivityEntry } from '../../components/dashboard/types';

export interface DashboardStatsResult {
  kpisRow1:    KpiItem[];
  kpisRow2:    KpiItem[];
  hourlyChart: ChartPoint[];
  topLines:    TopLine[];
  activity:    ActivityEntry[];
  loading:     boolean;
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

// ─── Blocs de KPIs réutilisables ──────────────────────────────────────────────

const KPI_TRIPS: KpiItem   = { label: 'Trajets du jour',       value: '24',    sub: '6 en cours',        delta: { value: '8%',  up: true  }, icon: 'MapPin',    accent: 'teal'    };
const KPI_TICKETS: KpiItem  = { label: 'Billets vendus',         value: '1 284', sub: 'depuis 06:00',      delta: { value: '12%', up: true  }, icon: 'Ticket',    accent: 'emerald' };
const KPI_REVENUE: KpiItem  = { label: 'Recette brute',          value: '6,8 M', sub: 'FCFA aujourd\'hui', delta: { value: '3%',  up: true  }, icon: 'Landmark',  accent: 'amber'   };
const KPI_FILL: KpiItem     = { label: 'Taux remplissage',       value: '78 %',  sub: 'sur 24 bus',        delta: { value: '2%',  up: false }, icon: 'BarChart3', accent: 'purple'  };
const KPI_PARCELS: KpiItem  = { label: 'Colis enregistrés',      value: '312',   sub: '18 en retard',                                          icon: 'Package',   accent: 'blue'    };
const KPI_SAV: KpiItem      = { label: 'Réclamations SAV',       value: '7',     sub: '3 critiques',       delta: { value: '2',   up: false }, icon: 'MessageSquareWarning', accent: 'red' };
const KPI_MAINT: KpiItem    = { label: 'Bus en maintenance',     value: '3',     sub: '1 urgent',                                              icon: 'Wrench',    accent: 'amber'   };
const KPI_AGENTS: KpiItem   = { label: 'Agents connectés',       value: '14',    sub: 'sur 18 prévus',                                         icon: 'Users',     accent: 'teal'    };
const KPI_DELAYS: KpiItem   = { label: 'Retards signalés',       value: '4',     sub: 'dont 1 critique',   delta: { value: '1',   up: false }, icon: 'AlertTriangle', accent: 'red' };
const KPI_MANIFESTS: KpiItem = { label: 'Manifestes signés',     value: '18',    sub: 'sur 24 trajets',                                        icon: 'ClipboardList', accent: 'emerald' };
const KPI_CASHIER: KpiItem  = { label: 'Recette caisse',         value: '487 K', sub: 'FCFA ce jour',      delta: { value: '9%',  up: true  }, icon: 'Landmark',  accent: 'amber'   };
const KPI_TX: KpiItem       = { label: 'Transactions',           value: '213',   sub: 'depuis ouverture',                                      icon: 'CreditCard', accent: 'teal'   };
const KPI_CANCEL: KpiItem   = { label: 'Annulations',            value: '6',     sub: 'dont 2 remboursées',                                    icon: 'XCircle',    accent: 'red'    };
const KPI_MY_TRIPS: KpiItem = { label: 'Mes trajets aujourd\'hui', value: '2',   sub: 'dont 1 en cours',                                       icon: 'MapPin',     accent: 'teal'  };
const KPI_MY_BUS: KpiItem   = { label: 'Mon bus',                value: 'KA-012', sub: 'État : OK',                                            icon: 'Bus',        accent: 'emerald' };
const KPI_MY_PAX: KpiItem   = { label: 'Passagers prévus',       value: '48',    sub: 'sur le prochain trajet',                                icon: 'Users',      accent: 'blue'  };
const KPI_INCIDENTS: KpiItem = { label: 'Incidents signalés',    value: '1',     sub: 'en attente',        delta: { value: '1',   up: false }, icon: 'AlertCircle', accent: 'red'  };

// ─── Activité récente par rôle ────────────────────────────────────────────────

const ACTIVITY_ADMIN: ActivityEntry[] = [
  { time: '14:22', msg: 'Trajet BZV→PNR 14:00 — Embarquement terminé (48/50 pax)', type: 'ok'   },
  { time: '14:18', msg: 'Retard 25 min signalé — BZV→DOL départ 14:15',            type: 'warn' },
  { time: '14:05', msg: 'Nouvelle réclamation SAV #1284 — Bagage manquant',          type: 'err'  },
  { time: '13:58', msg: 'Caisse #3 ouverte par Sylvère Makosso',                    type: 'ok'   },
  { time: '13:45', msg: 'Bus KA-4421-B affecté au garage — maintenance préventive',  type: 'warn' },
];

const ACTIVITY_CASHIER: ActivityEntry[] = [
  { time: '14:20', msg: 'Billet #8821 émis — BZV→PNR · Koffi Jean',               type: 'ok'   },
  { time: '14:11', msg: 'Annulation #8815 — Remboursement 3 500 FCFA',              type: 'warn' },
  { time: '14:02', msg: 'Colis #C-441 enregistré — 4,2 kg — BZV→NKY',              type: 'ok'   },
  { time: '13:55', msg: 'Billet #8810 émis — BZV→DOL · Marie Nzila',               type: 'ok'   },
];

const ACTIVITY_DRIVER: ActivityEntry[] = [
  { time: '14:00', msg: 'Trajet BZV→PNR démarré — 48 passagers',                   type: 'ok'   },
  { time: '13:45', msg: 'Briefing équipage complété',                               type: 'ok'   },
  { time: '13:30', msg: 'Contrôle technique bus KA-012 validé',                     type: 'ok'   },
];

const ACTIVITY_SUPERVISOR: ActivityEntry[] = [
  { time: '14:22', msg: 'Embarquement BZV→PNR terminé — quai 3',                   type: 'ok'   },
  { time: '14:18', msg: 'Retard 25 min — BZV→DOL quai 7',                          type: 'warn' },
  { time: '14:10', msg: 'Manifeste #M-1084 signé — BZV→NKY',                       type: 'ok'   },
  { time: '14:05', msg: 'Incident signalé — bagages quai 2',                        type: 'err'  },
];

// ─── Mapping rôle → KPIs ──────────────────────────────────────────────────────

interface RoleView {
  row1:     KpiItem[];
  row2:     KpiItem[];
  activity: ActivityEntry[];
  /** false = masquer le graphe ventes (pas pertinent pour ce rôle) */
  showChart: boolean;
}

const ROLE_VIEWS: Record<string, RoleView> = {
  // Vues complètes — tous les indicateurs de gestion
  SUPER_ADMIN: {
    row1: [KPI_TRIPS, KPI_TICKETS, KPI_REVENUE, KPI_FILL],
    row2: [KPI_PARCELS, KPI_SAV, KPI_MAINT, KPI_AGENTS],
    activity: ACTIVITY_ADMIN, showChart: true,
  },
  TENANT_ADMIN: {
    row1: [KPI_TRIPS, KPI_TICKETS, KPI_REVENUE, KPI_FILL],
    row2: [KPI_PARCELS, KPI_SAV, KPI_MAINT, KPI_AGENTS],
    activity: ACTIVITY_ADMIN, showChart: true,
  },

  // Gestionnaire d'agence — opérationnel, pas de finance globale
  AGENCY_MANAGER: {
    row1: [KPI_TRIPS, KPI_TICKETS, KPI_FILL, KPI_AGENTS],
    row2: [KPI_PARCELS, KPI_SAV, KPI_DELAYS, KPI_MANIFESTS],
    activity: ACTIVITY_ADMIN, showChart: false,
  },

  // Superviseur de gare — focus embarquement et incidents
  SUPERVISOR: {
    row1: [KPI_TRIPS, KPI_AGENTS, KPI_DELAYS, KPI_MANIFESTS],
    row2: [KPI_TICKETS, KPI_PARCELS, KPI_SAV, KPI_INCIDENTS],
    activity: ACTIVITY_SUPERVISOR, showChart: false,
  },

  // Caissier — uniquement finance et billeterie
  CASHIER: {
    row1: [KPI_TICKETS, KPI_CASHIER, KPI_TX, KPI_CANCEL],
    row2: [KPI_PARCELS, KPI_SAV],
    activity: ACTIVITY_CASHIER, showChart: true,
  },

  // Agent de gare — billets, colis, manifestes
  STATION_AGENT: {
    row1: [KPI_TICKETS, KPI_PARCELS, KPI_MANIFESTS, KPI_SAV],
    row2: [],
    activity: ACTIVITY_CASHIER, showChart: false,
  },

  // Agent de quai — trajets en cours et embarquement
  QUAI_AGENT: {
    row1: [KPI_TRIPS, KPI_MANIFESTS, KPI_DELAYS, KPI_AGENTS],
    row2: [],
    activity: ACTIVITY_SUPERVISOR, showChart: false,
  },

  // Chauffeur — uniquement ses propres trajets
  DRIVER: {
    row1: [KPI_MY_TRIPS, KPI_MY_BUS, KPI_MY_PAX, KPI_INCIDENTS],
    row2: [],
    activity: ACTIVITY_DRIVER, showChart: false,
  },
};

const DEFAULT_VIEW: RoleView = ROLE_VIEWS.TENANT_ADMIN!;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboardStats(roleName?: string): DashboardStatsResult & { showChart: boolean } {
  const view = (roleName && ROLE_VIEWS[roleName]) ? ROLE_VIEWS[roleName]! : DEFAULT_VIEW;

  return {
    kpisRow1:    view.row1,
    kpisRow2:    view.row2,
    hourlyChart: view.showChart ? HOURLY_CHART : [],
    topLines:    TOP_LINES,
    activity:    view.activity,
    loading:     false,
    showChart:   view.showChart,
  };
}
