# TransLog Pro — Dashboard KPI SaaS plateforme

> Livré 2026-04-20. Roadmap 7 sprints, 5 commits, zéro régression.
> Commits : `aabb059` `b7ae2f6` `9a68c1b` `191452c` `d9f270b` `a1e3a28`

## Vue d'ensemble

Dashboard KPI de niveau plateforme (cross-tenant) destiné au staff interne TransLog (SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2). Ne remplace pas le dashboard tenant (`/admin/dashboard`) — c'est une surface **distincte** sous `/admin/platform/dashboard`, accessible uniquement au tenant plateforme.

**Utilisateurs cibles** :
- **SUPER_ADMIN** : vue complète, y compris business (MRR, ARPU, GMV, expansion revenue) — utilisée pour pilotage exécutif et présentation investisseurs.
- **SUPPORT_L1** : vue adoption + ops (sans business) — permet de repérer les tenants à accompagner (webinaires, formation, onboarding).
- **SUPPORT_L2** : L1 + cohortes rétention — investigation tickets complexes.

## Permissions (RBAC fine-grained)

4 permissions distinctes introduites (src/common/constants/permissions.ts) :

| Permission | Scope | Qui |
|---|---|---|
| `data.platform.kpi.business.read.global`  | MRR, ARR, ARPU, expansion/churn revenue | SA only |
| `data.platform.kpi.adoption.read.global`  | DAU/MAU, modules, activation, North Star, transactional, strategic | SA + L1 + L2 |
| `data.platform.kpi.retention.read.global` | Cohortes D7/D30/D90 | SA + L2 |
| `data.platform.kpi.ops.read.global`       | Incidents, qualité, santé | SA + L1 + L2 |

Seed : `prisma/seeds/iam.seed.ts` (SUPER_ADMIN_PERMISSIONS / SUPPORT_L1_PERMISSIONS / SUPPORT_L2_PERMISSIONS).

## Endpoints REST

Base : `/api/platform/kpi/*` (module `PlatformKpiModule`).

| Endpoint | Permission | Payload |
|---|---|---|
| `GET /north-star?mode=compared&days=30` | ADOPTION | `NorthStarReport` |
| `GET /mrr?days=30`                       | BUSINESS | `MrrBreakdownReport` |
| `GET /retention?days=90`                 | RETENTION | `RetentionReport` |
| `GET /transactional?days=30`             | ADOPTION | `TransactionalReport` |
| `GET /adoption?days=30`                  | ADOPTION | `AdoptionReport` |
| `GET /activation`                        | ADOPTION | `ActivationFunnelReport` |
| `GET /strategic?days=7`                  | ADOPTION | `StrategicReport` |

Tous les DTOs sont typés dans [src/modules/platform-kpi/platform-kpi.types.ts](../src/modules/platform-kpi/platform-kpi.types.ts).

### Bornes paramètres

- `days` : clampé `[1..365]`, fallback sur défaut si `NaN`/négatif/absent.
- `mode` : `declarative` | `heuristic` | `compared` — fallback `compared`.

## Méthodes du service (cross-tenant, read-only)

Fichier : [src/modules/platform-kpi/platform-kpi.service.ts](../src/modules/platform-kpi/platform-kpi.service.ts).

### 1. `getNorthStar(mode, periodDays)` — % opérations via SaaS

**Déclaratif** : compare `actual_ops_monthly / Tenant.estimatedOperationsMonthly`.
**Heuristique** : compare `actual_tickets / (fleetCapacity × tripsInPeriod × targetOccupancy)`.
**Comparé** : affiche les deux modes ; fallback auto sur heuristique si déclaratif absent.

Config : `kpi.targetOccupancyRate` (défaut 0.65).

### 2. `getMrrBreakdown(periodDays)` — business & traction

- **MRR** : somme `normalizeMonthlyAmount(Plan.price, Plan.billingCycle)` sur subs `ACTIVE + PAST_DUE`.
  - MONTHLY → identité
  - YEARLY → ÷12
  - ONE_SHOT → ÷12 (amorti)
- **ARR** = MRR × 12
- **ARPU** = MRR / tenants payants
- **Net New MRR** = new + expansion − contraction − churn (via `SubscriptionChange`)
- **MoM growth** = (Δ période courante − Δ période précédente) / |Δ précédente|
- **Ventilation par plan** : liste triée par nb tenants actifs décroissant

### 3. `getRetentionCohorts(periodDays)` — cohortes D7/D30/D90

Groupage par mois de signup (`Tenant.createdAt` → `YYYY-MM`).
Pour chaque cohorte, fenêtre active = 7 jours à partir de Dn (évite biais fenêtre future).

### 4. `getTransactional(periodDays)` — tickets / trajets / colis

- GMV en devise tenant (jamais hardcodé — lu depuis `Tenant.currency`)
- **% digital** = `tickets with customer.userId != null / total` (proxy portail/mobile authentifié)
- **Ponctualité** = `trips avec |departureActual - departureScheduled| ≤ 10 min / total completed`

### 5. `getAdoptionBreakdown(periodDays)` — DAU/MAU par user type

Buckets : `STAFF`, `DRIVER` (Role.name='DRIVER'), `CUSTOMER` (User.userType).
Modules adoptés : `≥ kpi.moduleAdoptionThreshold` (défaut 0.3) des tenants actifs.

### 6. `getActivationFunnel()` — 4 étapes

1. `TRIP_CREATED`     — au moins 1 trip planifié
2. `TICKET_SOLD`      — au moins 1 ticket émis
3. `DRIVER_ADDED`     — au moins 1 user avec Role='DRIVER'
4. `TWO_MODULES_USED` — au moins 2 modules installés actifs

Seuils configurables : `kpi.activation.minTickets`, `kpi.activation.minTrips`.

### 7. `getStrategic(periodDays)` — KPI stratégiques

- **Dépendance SaaS** = North Star global (proxy)
- **Actions/user/semaine** = auditLog.count / users actifs
- **Sessions/user/semaine** = dailyActiveUser.sessionsCount / users actifs
- **Top 10 tenants actifs** : tri par nb lignes AuditLog

## Schema Prisma (additif)

### Nouveaux champs / tables

```prisma
model Tenant {
  // ...
  estimatedOperationsMonthly Json?  // { tickets, trips, incidents }
  subscriptionChanges SubscriptionChange[]
}

model SubscriptionChange {
  id                String   @id @default(cuid())
  tenantId          String
  subscriptionId    String
  fromPlanId        String?
  toPlanId          String
  fromMonthlyAmount Float    @default(0)
  toMonthlyAmount   Float    @default(0)
  deltaMonthly      Float    @default(0)
  currency          String   @default("EUR")
  changeType        String   // NEW | EXPANSION | CONTRACTION | CHURN | REACTIVATION
  reason            String?
  actorUserId       String?
  createdAt         DateTime @default(now())
  @@index([tenantId, createdAt])
  @@index([changeType, createdAt])
  @@map("subscription_changes")
}

model PlatformKpiSnapshot {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  metricKey String
  value     Float    @default(0)
  breakdown Json     @default("{}")
  createdAt DateTime @default(now())
  @@unique([date, metricKey])
  @@index([metricKey, date])
  @@map("platform_kpi_snapshots")
}
```

### Backfill

```bash
npx ts-node prisma/seeds/subscription-change.backfill.ts
```

Idempotent : crée une entrée `NEW` par subscription existante + une entrée `CHURN` pour les subs `CANCELLED`. Les changements intermédiaires sont tracés à partir de ce point en avant via `PlatformBillingService` (hook à brancher).

## Configuration (`PlatformConfigService`)

6 nouvelles clés namespace `kpi.*` :

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `kpi.targetOccupancyRate`     | number 0..1 | 0.65 | Occupation cible North Star heuristique |
| `kpi.defaultPeriodDays`       | number 1..365 | 30 | Période par défaut |
| `kpi.moduleAdoptionThreshold` | number 0..1 | 0.3  | Seuil adoption module |
| `kpi.cacheTtlSeconds`         | number 10..3600 | 60 | TTL cache KPI |
| `kpi.activation.minTickets`   | number 1..1000 | 1  | Seuil billets activation |
| `kpi.activation.minTrips`     | number 1..1000 | 1  | Seuil trajets activation |

Édition : `/admin/platform/settings` (SA only).

## UI — 7 sections dashboard

Fichiers : [frontend/components/platform/Section*.tsx](../frontend/components/platform/).

1. **SectionNorthStar** — toggle mode + table tenants avec % par catégorie
2. **SectionMrrBreakdown** (business) — MRR/ARR/ARPU + net new + by plan
3. **SectionTransactional** — billets/GMV/on-time + sparkline journalière
4. **SectionAdoptionDetailed** — DAU/MAU ventilés + modules adoption bars
5. **SectionActivation** — funnel 4 étapes avec conversion
6. **SectionRetention** — KPI D7/D30/D90 + table cohortes avec heatmap
7. **SectionStrategic** — dépendance + actions/user + top tenants actifs

**Helpers partagés** : [frontend/components/platform/kpi-shared.tsx](../frontend/components/platform/kpi-shared.tsx)
- `KpiTile`, `ProgressBar`, `Sparkline`, `SectionHeader`, `formatCurrencyMap`, `pctDisplay`

**Montage conditionnel** : chaque section est gatée par sa permission via `useHasPerm` — pas d'appel d'API si la perm est absente.

**Tokens sémantiques** : `t-card-bordered`, `t-text*`, variants `dark:`. WCAG AA (aria-labelledby, role=progressbar, role=tab). Responsive 1/2/3/4 cols.

## i18n

**fr + en** : ~80 clés dans namespace `platformKpi.*` (fichiers `frontend/lib/i18n/locales/{fr,en}.ts`).

**6 autres locales** (es/pt/ar/wo/ln/ktu) : fallback auto sur fr, propagation documentée dans [docs/TODO_i18n_propagation.md](TODO_i18n_propagation.md).

## Tests

| Niveau | Fichier | Tests |
|---|---|---|
| Unit | `test/unit/platform-kpi/subscription-change.backfill.spec.ts` | 5 |
| Unit | `test/unit/platform-kpi/platform-kpi.service.spec.ts` | 17 |
| Unit | `test/unit/platform-kpi/platform-kpi.controller.spec.ts` | 7 |
| Security | `test/security/platform-kpi-access.spec.ts` | 15 |
| Integration | `test/integration/platform-kpi/platform-kpi.integration-spec.ts` | 4 |
| Playwright | `test/playwright/platform-kpi.sa.pw.spec.ts` | 9 |

**Résultats** :
- Unit totaux : 727 PASS (+19 vs baseline 708)
- Security totaux : 172 PASS (+15 vs baseline 157)
- Zéro régression

## Sécurité

Invariants vérifiés par `test/security/platform-kpi-access.spec.ts` :

1. **Pas de fuite tenant plateforme** : toutes les queries excluent `PLATFORM_TENANT_ID` via `{ id: { not: ... } }` ou `{ tenantId: { not: ... } }`.
2. **RBAC controller** : chaque endpoint porte `@RequirePermission` vérifié via Reflect metadata.
3. **Bornes paramètres** : `days` clampé `[1..365]`, NaN/négatif rejeté.
4. **Cohortes sans biais** : fenêtres D7/D30/D90 dans le futur sont ignorées (évite faux positifs sur tenants récents).
5. **Idempotence backfill** : `normalizeMonthlyAmount` déterministe → pas de double comptage revenue.

## Cache & performance

- Cache mémoire in-process par clé (`${method}:${days}`) — TTL configurable (`kpi.cacheTtlSeconds`, défaut 60s).
- Pre-aggregates via `DailyActiveUser` et `TenantHealthScore` (crons existants 02:00 UTC / 02:30 UTC).
- `PlatformKpiSnapshot` disponible pour cron futur (non encore alimenté — au besoin si perf dégrade).

## Commits

| # | Hash | Sprint |
|---|---|---|
| 1 | `aabb059` | feat(platform-kpi): sprint 1 — schéma Prisma KPI SaaS |
| 2 | `b7ae2f6` | feat(platform-kpi): sprint 2 — PlatformKpiService (7 méthodes) |
| 3 | `9a68c1b` | feat(platform-kpi): sprint 3 — endpoints REST + RBAC fine-grained |
| 4 | `191452c` | feat(platform-kpi): sprint 4 — UI 7 sections KPI SaaS |
| 5 | `d9f270b` | feat(platform-kpi): sprint 5 — i18n fr+en complet |
| 6 | `a1e3a28` | test(platform-kpi): sprint 6 — tests 5 niveaux complet |
| 7 | (ce doc) | docs(platform-kpi): sprint 7 — documentation |

## Extensions prévues (non bloquantes)

- **Export CSV** de chaque section (DataTableMaster supporte déjà l'export)
- **SSE temps-réel** pour refresh auto (infra `useRealtimeEvents` prête)
- **Alertes anomalies** (baseline vs realtime, notifications SA)
- **Snapshots historiques** alimentés par cron nocturne dans `PlatformKpiSnapshot`
- **Breakdown par pays / par plan** sur le North Star
- **6 locales restantes** (propagation en cours dans [TODO_i18n_propagation.md](TODO_i18n_propagation.md))
