/**
 * Types DTO PlatformKpiService — contrats stables pour controller + frontend.
 * Toute évolution qui casse un champ existant nécessite versioning endpoint.
 */

import type { ActivationStep, NorthStarMode, SubscriptionChangeType, UserTypeBucket } from './platform-kpi.constants';

// ─── North Star ────────────────────────────────────────────────────────────

export interface NorthStarTenantEntry {
  tenantId:           string;
  tenantName:         string;
  tenantSlug:         string;
  // Mode déclaratif : actual / estimated (par catégorie). null si pas d'estimation.
  declarative:        null | {
    tickets:   { actual: number; estimated: number; pct: number };
    trips:     { actual: number; estimated: number; pct: number };
    incidents: { actual: number; estimated: number; pct: number };
  };
  // Mode heuristique : actual / capacity × targetOccupancy.
  heuristic:          null | {
    tickets:   { actual: number; theoretical: number; pct: number };
    trips:     { actual: number; theoretical: number; pct: number };
  };
  // Mode effectif appliqué (après fallback automatique si declarative null).
  appliedMode:        NorthStarMode;
}

export interface NorthStarReport {
  mode:              NorthStarMode;      // mode demandé
  periodDays:        number;
  targetOccupancy:   number;             // 0..1
  global: {
    pctViaSaasAvg:   number | null;      // moyenne pondérée des %
    tenantsCovered:  number;             // nb tenants avec au moins une source
    tenantsMissing:  number;             // nb tenants sans ni déclaratif ni capacité
  };
  perTenant:         NorthStarTenantEntry[];
}

// ─── MRR Breakdown ─────────────────────────────────────────────────────────

export interface MrrBreakdownReport {
  periodDays:        number;
  currencyReference: string; // devise majoritaire (la + agrégée)
  totals: {
    mrr:             Record<string, number>; // par devise
    arr:             Record<string, number>;
    arpu:            Record<string, number>;
    activeTenants:   number;
    payingTenants:   number;
  };
  growth: {
    momPct:          number | null; // M vs M-1
    newRevenue:      Record<string, number>;
    expansionRevenue: Record<string, number>;
    contractionRevenue: Record<string, number>;
    churnRevenue:    Record<string, number>; // signe positif (c'est ce qu'on perd)
    netNewMrr:       Record<string, number>; // new + expansion - contraction - churn
  };
  byChangeType:      Array<{ type: SubscriptionChangeType; count: number; amountByCurrency: Record<string, number> }>;
  byPlan:            Array<{ planId: string; planSlug: string; activeTenants: number; mrrByCurrency: Record<string, number> }>;
}

// ─── Retention Cohorts ─────────────────────────────────────────────────────

export interface CohortBucket {
  cohortMonth:        string;   // "YYYY-MM"
  tenantsSignedUp:    number;
  activeD7:           number;   // actifs entre J+7 et J+14
  activeD30:          number;   // actifs à J+30 (fenêtre 7j)
  activeD90:          number;   // actifs à J+90 (fenêtre 7j)
  retentionD7Pct:     number;
  retentionD30Pct:    number;
  retentionD90Pct:    number;
}

export interface RetentionReport {
  periodDays:     number;
  cohorts:        CohortBucket[];
  overall: {
    avgD7:        number;
    avgD30:       number;
    avgD90:       number;
  };
}

// ─── Transactional ─────────────────────────────────────────────────────────

export interface TransactionalReport {
  periodDays:        number;
  tickets: {
    total:           number;
    gmv:             Record<string, number>;
    avgTicketPrice:  Record<string, number>;
    pctDigital:      number; // 0..1 — via customerId lié à User
    pctOffline:      number;
  };
  trips: {
    totalPlanned:    number;
    totalCompleted:  number;
    totalCancelled:  number;
    onTimePct:       number | null;
  };
  parcels: {
    total:           number;
    delivered:       number;
  };
  perDay:            Array<{ date: string; tickets: number; trips: number }>;
}

// ─── Adoption ──────────────────────────────────────────────────────────────

export interface AdoptionReport {
  periodDays:        number;
  users: {
    dau:             Record<UserTypeBucket, number>;
    wau:             Record<UserTypeBucket, number>;
    mau:             Record<UserTypeBucket, number>;
    dauMauRatio:     Record<UserTypeBucket, number>; // stickiness
    totalActive:     Record<UserTypeBucket, number>;
  };
  modules: Array<{
    moduleKey:       string;
    tenants:         number;
    pct:             number;
    adopted:         boolean; // ≥ kpi.moduleAdoptionThreshold
  }>;
  trend30d:          Array<{ date: string; dau: number }>;
}

// ─── Activation Funnel ─────────────────────────────────────────────────────

export interface ActivationFunnelReport {
  totalTenants:       number;
  steps: Array<{
    step:             ActivationStep;
    tenants:          number;
    pct:              number;
    conversionPct:    number; // vs étape précédente
  }>;
  avgDaysToActivate:  number | null;
}

// ─── Modules Usage (per tenant) ────────────────────────────────────────────

/**
 * Rapport par module pour un tenant donné. Source : InstalledModule (état
 * courant + historique activation) + ModuleUsageDaily (rollup cron).
 *
 * Un module peut être :
 *   - installed: false, everUsed: false → jamais installé
 *   - installed: true, isActive: true   → actif
 *   - installed: true, isActive: false  → désactivé (deactivatedAt/By renseignés)
 *
 * actionCount / uniqueUsers agrégés sur la période demandée. Si la somme est 0
 * alors que isActive = true, le module est "installé non utilisé" — signal
 * fort pour le support (churn risk) ou pour un nudge tenant.
 */
export interface ModuleUsageEntry {
  moduleKey:        string;
  installed:        boolean;     // existe une ligne InstalledModule (même inactive)
  isActive:         boolean;
  activatedAt:      string | null; // ISO
  activatedBy:      string | null;
  deactivatedAt:    string | null;
  deactivatedBy:    string | null;
  periodDays:       number;
  actionCount:      number;      // somme sur la période
  uniqueUsers:      number;      // max quotidien sur la période (proxy "utilisateurs distincts du module")
  activeDays:       number;      // nb de jours avec actionCount > 0
  lastUsedAt:       string | null; // date (YYYY-MM-DD) du dernier rollup > 0
}

export interface ModulesUsageReport {
  tenantId:         string;
  periodDays:       number;
  generatedAt:      string; // ISO
  modules:          ModuleUsageEntry[];
}

// ─── Strategic ─────────────────────────────────────────────────────────────

export interface StrategicReport {
  periodDays:           number;
  avgActionsPerUserWeek: number;
  avgSessionsPerUserWeek: number;
  saasDependencyPct:    number | null; // proxy = pctViaSaasAvg du North Star
  topActiveTenants:     Array<{ tenantId: string; tenantName: string; actionsCount: number }>;
}
