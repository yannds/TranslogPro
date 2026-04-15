/**
 * useDashboardStats — Hook de données pour la page d'accueil du tableau de bord
 *
 * Retourne des données typées pour les KPIs, graphiques et activité récente.
 * Actuellement alimenté par des données statiques (mock).
 * Structure prête pour une intégration API : remplacer les constantes
 * par des appels useFetch<DashboardStats>('/api/v1/tenants/:id/analytics/summary')
 *
 * Usage :
 *   const { kpisRow1, kpisRow2, hourlyChart, topLines, activity } = useDashboardStats();
 */

import type {
  KpiItem, ChartPoint, TopLine, ActivityEntry,
} from '../../components/dashboard/types';

// ─── Types exportés ───────────────────────────────────────────────────────────

export interface DashboardStatsResult {
  /** KPIs ligne 1 (trajets, billets, recette, remplissage) */
  kpisRow1:    KpiItem[];
  /** KPIs ligne 2 (colis, SAV, maintenance, agents) */
  kpisRow2:    KpiItem[];
  /** Données graphique ventes par heure */
  hourlyChart: ChartPoint[];
  /** Top lignes du jour */
  topLines:    TopLine[];
  /** Journal d'activité récente */
  activity:    ActivityEntry[];
  /** Indique si une requête est en cours (prêt pour l'API) */
  loading:     boolean;
}

// ─── Données statiques (à remplacer par apiFetch) ─────────────────────────────

const KPI_ROW_1: KpiItem[] = [
  { label: 'Trajets du jour',         value: '24',     sub: '6 en cours',       delta: { value: '8%',  up: true },  icon: 'MapPin',    accent: 'teal'    },
  { label: 'Billets vendus',           value: '1 284',  sub: 'depuis 06:00',     delta: { value: '12%', up: true },  icon: 'Ticket',    accent: 'emerald' },
  { label: 'Recette brute',            value: '6,8 M',  sub: 'FCFA aujourd\'hui', delta: { value: '3%',  up: true },  icon: 'Landmark',  accent: 'amber'   },
  { label: 'Taux remplissage moyen',   value: '78 %',   sub: 'sur 24 bus',       delta: { value: '2%',  up: false }, icon: 'BarChart3', accent: 'purple'  },
];

const KPI_ROW_2: KpiItem[] = [
  { label: 'Colis enregistrés',  value: '312', sub: '18 en retard',     icon: 'Package',              accent: 'blue'   },
  { label: 'Réclamations SAV',   value: '7',   sub: '3 critiques',      delta: { value: '2', up: false }, icon: 'MessageSquareWarning', accent: 'red' },
  { label: 'Bus en maintenance', value: '3',   sub: '1 urgent',         icon: 'Wrench',               accent: 'amber'  },
  { label: 'Agents connectés',   value: '14',  sub: 'sur 18 prévus',    icon: 'Users',                accent: 'teal'   },
];

const HOURLY_CHART: ChartPoint[] = [
  { label: '6h',  value: 42  },
  { label: '7h',  value: 87  },
  { label: '8h',  value: 134 },
  { label: '9h',  value: 156 },
  { label: '10h', value: 98  },
  { label: '11h', value: 110 },
  { label: '12h', value: 76  },
  { label: '13h', value: 88  },
  { label: '14h', value: 145 },
];

const TOP_LINES: TopLine[] = [
  { route: 'BZV → PNR', pax: 312, pct: 92 },
  { route: 'BZV → DOL', pax: 198, pct: 74 },
  { route: 'PNR → BZV', pax: 287, pct: 88 },
  { route: 'BZV → NKY', pax: 156, pct: 65 },
];

const RECENT_ACTIVITY: ActivityEntry[] = [
  { time: '14:22', msg: 'Trajet BZV→PNR 14:00 — Embarquement terminé (48/50 pax)', type: 'ok'   },
  { time: '14:18', msg: 'Retard 25 min signalé — BZV→DOL départ 14:15',            type: 'warn' },
  { time: '14:05', msg: 'Nouvelle réclamation SAV #1284 — Bagage manquant',          type: 'err'  },
  { time: '13:58', msg: 'Caisse #3 ouverte par Sylvère Makosso',                    type: 'ok'   },
  { time: '13:45', msg: 'Bus KA-4421-B affecté au garage — maintenance préventive',  type: 'warn' },
];

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboardStats(): DashboardStatsResult {
  // Ici : remplacer par useFetch<DashboardStatsResult>(url, [tenantId])
  return {
    kpisRow1:    KPI_ROW_1,
    kpisRow2:    KPI_ROW_2,
    hourlyChart: HOURLY_CHART,
    topLines:    TOP_LINES,
    activity:    RECENT_ACTIVITY,
    loading:     false,
  };
}
