# TransLog Pro — Architecture Technique Complète
**Dossier Technique de Référence v3.0**

---

## Table des Matières

1. [Vue d'Ensemble](#1-vue-densemble)
2. [Backend — Modules et Responsabilités](#2-backend--modules-et-responsabilités)
3. [Workflow Engine](#3-workflow-engine)
4. [Event System](#4-event-system)
5. [Base de Données](#5-base-de-données)
6. [APIs](#6-apis)
7. [Realtime Layer](#7-realtime-layer)
8. [Sécurité](#8-sécurité)
9. [Stockage Fichiers](#9-stockage-fichiers)
10. [Infrastructure](#10-infrastructure)
11. [Observabilité](#11-observabilité)

---

## 1. Vue d'Ensemble

### 1.1 Diagramme Logique Global

```
╔══════════════════════════════════════════════════════════════════════╗
║                          CLIENTS LAYER                               ║
║  React Native (Agent/Driver/Client) │ Next.js (Admin/BI/Web)        ║
║  Kiosk (Gare)                       │ IoT Screens (Bus/Gare)        ║
╚══════════════╤═══════════════════════════════════╤════════════════════╝
               │ HTTPS/WSS                         │ WebSocket
╔══════════════▼═══════════════════════════════════▼════════════════════╗
║                        API GATEWAY (Nginx + Kong OSS)                ║
║  SSL Termination · Rate Limiting · mTLS Upstream · CORS per tenant  ║
╚══════════════╤═══════════════════════════════════╤════════════════════╝
               │                                   │
      ┌────────▼────────┐               ┌──────────▼──────────┐
      │  REST API        │               │  Realtime Gateway    │
      │  NestJS HTTP     │               │  Socket.io + Redis   │
      │  /api/v1/...     │               │  Adapter             │
      └────────┬────────┘               └──────────┬──────────┘
               │                                   │
╔══════════════▼═══════════════════════════════════▼════════════════════╗
║                     DOMAIN LAYER (NestJS Modular Monolith)            ║
║                                                                       ║
║  IAM · Tenant · Ticketing · Parcel · Fleet · Trip · Cashier          ║
║  Tracking · Manifest · FlightDeck · Garage · SAV · Notification      ║
║  Display · Analytics · Scheduler · QuotaManager                      ║
║                                                                       ║
║  ┌─────────────────────────────────────────────────────────────────┐  ║
║  │              UNIFIED WORKFLOW ENGINE (UWE)                       │  ║
║  │  WorkflowConfig | GuardEvaluator | SideEffectDispatcher         │  ║
║  │  OptimisticLock | AuditTrail | TransitionIdempotency            │  ║
║  └─────────────────────────────────────────────────────────────────┘  ║
║                                                                       ║
║  ┌─────────────────────────────────────────────────────────────────┐  ║
║  │              INFRASTRUCTURE PORTS                                │  ║
║  │  IEventBus | ISecretService | IStorageService | IIdentity       │  ║
║  │  IWeatherService | IGeoService (PostGIS ou Haversine)           │  ║
║  └─────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════╤════════════════════════════════════════╝
                               │
╔══════════════════════════════▼════════════════════════════════════════╗
║                     EVENT INFRASTRUCTURE                              ║
║                                                                       ║
║  ┌────────────────────────────────┐  ┌──────────────────────────┐    ║
║  │  Transactional Outbox          │  │  Redis Pub/Sub            │    ║
║  │  PostgreSQL OutboxEvent table  │  │  WS fan-out               │    ║
║  │  OutboxPoller (1s interval)    │  │  GPS throttle buffer      │    ║
║  │  DLQ + Retry backoff           │  │  Socket.io Adapter        │    ║
║  └────────────────────────────────┘  └──────────────────────────┘    ║
╚══════════════════════════════╤════════════════════════════════════════╝
                               │
╔══════════════════════════════▼════════════════════════════════════════╗
║                          DATA LAYER                                   ║
║                                                                       ║
║  PostgreSQL 16 + PostGIS   │   Redis 7    │   MinIO (S3-compat)      ║
║  RLS RESTRICTIVE            │   Cache L2   │   Per-tenant buckets     ║
║  Partitioned AuditLog       │   Pub/Sub    │   Typed signed URLs      ║
║  PgBouncer SESSION mode     │   GPS buffer │   TTL by doc type        ║
╚══════════════════════════════╤════════════════════════════════════════╝
                               │
╔══════════════════════════════▼════════════════════════════════════════╗
║                    SECRETS & PKI LAYER                                ║
║              HashiCorp Vault HA (Raft — 3 nœuds)                     ║
║   KV v2 | PKI Engine | Transit | AppRole | Kubernetes Auth           ║
╚═══════════════════════════════════════════════════════════════════════╝
```

### 1.2 Décisions Architecturales Clés (ADR Summary)

| ADR | Décision | Raison |
|---|---|---|
| ADR-01 | Event Bus = Outbox PG + Redis | Atomicité, portabilité, 0 service supplémentaire |
| ADR-02 | RLS RESTRICTIVE | Fail-closed — 0 ligne si contexte absent |
| ADR-03 | PgBouncer SESSION mode | SET LOCAL compatible avec RLS |
| ADR-04 | QR = HMAC-SHA256 Vault | Infalsifiable, vérifiable sans DB |
| ADR-05 | Sub-états discrets | Compatible moteur stateless WorkflowEngine |
| ADR-06 | tenantId from session only | Supprime tenant-hopping header |
| ADR-07 | GPS Redis buffer + batch 10s | Anti write-storm |
| ADR-08 | AuditLog partitionné RANGE | Performance sur millions de lignes |
| ADR-09 | Vault HA Raft 3 nœuds | Supprime SPOF critique |
| ADR-10 | Socket.io Redis Adapter | Scalabilité horizontale |
| ADR-11 | WorkflowTransition table | Idempotence transitions + webhooks |
| ADR-12 | Roadbook JSONB en DB | Requêtable (pas MinIO opaque) |
| ADR-13 | Parcel/Shipment.destinationId FK | Guard FIELD_MATCH robuste |
| ADR-14 | Ticket ≠ Traveler | Ticket = financier immuable, Traveler = opérationnel |
| ADR-15 | WorkflowConfig versioning | Entités in-flight suivent config active |
| ADR-16 | IAM runtime | DB RolePermission + Redis 60s — zéro hardcode |
| ADR-17 | User.userType | Discriminateur CUSTOMER/STAFF/ANONYMOUS — pas d'entité Customer (CUSTOMER unifie voyageur + expéditeur) |
| ADR-18 | TripEvent/Incident | Table unifiée + type discriminateur — BaseEvent partagé |
| ADR-19 | PostGIS | Optionnel avec fallback haversine — IGeoService interface |
| ADR-20 | GPS Public Reporter | TTL 24h — RGPD minimisation données |
| ADR-21 | Public Reporter URL | /public/{slug} séparé — isolation auth vs non-auth, rate limit IP |
| ADR-22 | IWeatherService | Interface permutable — Smart Bus Display météo |
| ADR-23 | Maintenance au km | `maintenanceCostPerKm × distanceKm` — coût mécanique réel vs forfait mensuel biaisé |
| ADR-24 | TenantBusinessConfig | Modèle DB 1:1 Tenant — constantes métier (365, 30, 0.05…) sans magic numbers dans le code |
| ADR-25 | CSS White Label SSR | `<style data-tenant-brand>` + CSS custom properties + `sanitizeCss()` — pas de round-trip JS |
| ADR-26 | ICostCalculator interface | `CostCalculatorEngine` pure (sans NestJS/Prisma) — testable sans DB. Seul `ProfitabilityService` dépend de Prisma. |
| ADR-27 | Dual Margin | Marge Opérationnelle (rev−var) + Marge Nette (rev−total) — piloter prix = piloter les deux niveaux |
| ADR-28 | SchedulingGuardModule partagé | Logique d'assignabilité centralisée, réutilisable par Trip, Crew, Scheduler |
| ADR-29 | ModuleGuard global APP_GUARD | SaaS modularité — modules désactivables sans modifier le code métier |
| ADR-30 | @RequireModule décorateur classe | Module désactivé = 403 sur tous les endpoints ; pas de logique conditionnelle dans les services |
| ADR-31 | Cache module Redis TTL 300s | TTL long (modules rarement modifiés) + `invalidateModuleCache()` sur changement |
| ADR-32 | allEquipmentOk côté serveur | Intégrité — le client ne peut pas forcer allEquipmentOk=true |
| ADR-33 | Remédiation anti-doublon | Idempotence — vérification PENDING/IN_PROGRESS avant create |
| ADR-34 | `apiFetch` redirect 401 | Session-cookie → redirect automatique `/login` sur 401 (no JWT refresh) |
| ADR-35 | `versionRef` anti-race | `useFetch` ignore les réponses obsolètes via compteur de version |
| ADR-36 | Entity-type tabs ARIA | `PageWorkflowStudio` : `role="tablist/tab/tabpanel"` sans router |

---

## 2. Backend — Modules et Responsabilités

### 2.1 Structure des Répertoires

```
src/
├── main.ts                          # Bootstrap NestJS + Vault init
├── app.module.ts                    # Root module
│
├── infrastructure/                  # Adapters (jamais importés par domain)
│   ├── database/
│   │   ├── prisma.service.ts        # PrismaClient singleton + RLS extension
│   │   ├── rls.middleware.ts        # SET LOCAL app.tenant_id par requête
│   │   ├── tenant-context.service.ts
│   │   └── database.module.ts
│   ├── secret/
│   │   ├── interfaces/
│   │   │   └── secret.interface.ts  # ISecretService
│   │   ├── vault.service.ts         # Implémentation Vault
│   │   └── secret.module.ts
│   ├── storage/
│   │   ├── interfaces/
│   │   │   └── storage.interface.ts # IStorageService
│   │   ├── minio.service.ts         # Implémentation MinIO
│   │   └── storage.module.ts
│   ├── weather/
│   │   ├── interfaces/
│   │   │   └── weather.interface.ts # IWeatherService
│   │   ├── openweathermap.service.ts # Implémentation OpenWeatherMap (permutable)
│   │   └── weather.module.ts
│   ├── eventbus/
│   │   ├── interfaces/
│   │   │   └── eventbus.interface.ts # IEventBus
│   │   ├── outbox.service.ts        # Écriture dans OutboxEvent
│   │   ├── outbox-poller.service.ts # Poller @Cron 1s
│   │   ├── redis-publisher.service.ts
│   │   └── eventbus.module.ts
│   └── identity/
│       ├── interfaces/
│       │   └── identity.interface.ts # IIdentityManager
│       ├── better-auth.service.ts
│       └── identity.module.ts
│
├── core/                            # Moteurs transversaux
│   ├── workflow/
│   │   ├── interfaces/
│   │   │   ├── workflow-entity.interface.ts
│   │   │   └── transition-input.interface.ts
│   │   ├── types/
│   │   │   ├── guard-definition.type.ts
│   │   │   └── side-effect-definition.type.ts
│   │   ├── workflow.engine.ts       # Moteur principal
│   │   ├── guard.evaluator.ts       # Évaluateur de Guards
│   │   ├── side-effect.dispatcher.ts
│   │   ├── audit.service.ts         # AuditLog ISO 27001
│   │   └── workflow.module.ts
│   ├── iam/
│   │   ├── types/
│   │   │   └── permission.types.ts  # Constantes compile-time uniquement (PAS runtime)
│   │   ├── decorators/
│   │   │   └── permission.decorator.ts
│   │   ├── guards/
│   │   │   └── permission.guard.ts  # Vérifie prisma.rolePermission + Redis cache 60s
│   │   ├── middleware/
│   │   │   └── tenant.middleware.ts
│   │   ├── services/
│   │   │   └── rbac.service.ts      # manage roles/permissions via DB
│   │   └── iam.module.ts
│   │
│   │   # Seed initial IAM (exécuté par OnboardingService)
│   │   # prisma/seeds/iam.seed.ts → insère Role + RolePermission par défaut
│   ├── pricing/
│   │   ├── pricing.engine.ts
│   │   └── pricing.module.ts
│   └── security/
│       └── qr/
│           └── qr.service.ts        # HMAC-SHA256 QR generation/verification
│
├── modules/                         # Domain modules
│   ├── tenant/
│   │   ├── dto/
│   │   │   ├── create-tenant.dto.ts
│   │   │   └── install-module.dto.ts
│   │   ├── tenant.controller.ts
│   │   ├── tenant.service.ts
│   │   └── tenant.module.ts
│   ├── ticketing/
│   │   ├── dto/
│   │   │   ├── create-ticket.dto.ts
│   │   │   └── verify-qr.dto.ts
│   │   ├── ticketing.controller.ts
│   │   ├── ticketing.service.ts
│   │   └── ticketing.module.ts
│   ├── parcel/
│   │   ├── dto/
│   │   │   ├── create-parcel.dto.ts
│   │   │   └── create-shipment.dto.ts
│   │   ├── parcel.controller.ts
│   │   ├── parcel.service.ts
│   │   ├── shipment.service.ts
│   │   └── parcel.module.ts
│   ├── fleet/
│   │   ├── dto/
│   │   │   ├── create-bus.dto.ts
│   │   │   └── create-staff.dto.ts
│   │   ├── fleet.controller.ts
│   │   ├── fleet.service.ts
│   │   └── fleet.module.ts
│   ├── trip/
│   │   ├── dto/
│   │   │   └── create-trip.dto.ts
│   │   ├── trip.controller.ts
│   │   ├── trip.service.ts
│   │   └── trip.module.ts
│   ├── cashier/
│   │   ├── dto/
│   │   │   └── open-register.dto.ts
│   │   ├── cashier.controller.ts
│   │   ├── cashier.service.ts
│   │   └── cashier.module.ts
│   ├── tracking/
│   │   ├── tracking.controller.ts
│   │   ├── tracking.service.ts
│   │   └── tracking.module.ts
│   ├── manifest/
│   │   ├── manifest.controller.ts
│   │   ├── manifest.service.ts
│   │   └── manifest.module.ts
│   ├── flight-deck/
│   │   ├── dto/
│   │   │   ├── submit-checklist.dto.ts
│   │   │   └── report-incident.dto.ts
│   │   ├── flight-deck.controller.ts
│   │   ├── flight-deck.service.ts
│   │   └── flight-deck.module.ts
│   ├── garage/
│   │   ├── dto/
│   │   │   └── create-maintenance-report.dto.ts
│   │   ├── garage.controller.ts
│   │   ├── garage.service.ts
│   │   └── garage.module.ts
│   ├── sav/
│   │   ├── dto/
│   │   │   └── create-claim.dto.ts
│   │   ├── sav.controller.ts
│   │   ├── sav.service.ts
│   │   └── sav.module.ts
│   ├── notification/
│   │   ├── handlers/
│   │   │   ├── parcel-notification.handler.ts
│   │   │   ├── trip-notification.handler.ts
│   │   │   └── sav-notification.handler.ts
│   │   ├── notification.service.ts
│   │   └── notification.module.ts
│   ├── display/
│   │   ├── display.controller.ts
│   │   ├── display.gateway.ts       # Socket.io WebSocket Gateway
│   │   └── display.module.ts
│   ├── analytics/
│   │   ├── analytics.controller.ts
│   │   ├── analytics.service.ts
│   │   └── analytics.module.ts
│   ├── crm/
│   │   ├── dto/
│   │   │   ├── update-voyager-profile.dto.ts
│   │   │   └── create-campaign.dto.ts
│   │   ├── crm.controller.ts
│   │   ├── crm.service.ts
│   │   └── crm.module.ts
│   ├── feedback/
│   │   ├── dto/
│   │   │   └── submit-feedback.dto.ts
│   │   ├── feedback.controller.ts
│   │   ├── feedback.service.ts        # calcul Rating agrégé
│   │   └── feedback.module.ts
│   ├── safety/
│   │   ├── dto/
│   │   │   └── create-safety-alert.dto.ts
│   │   ├── safety.controller.ts
│   │   ├── safety.service.ts          # corrélation GPS anti-fraude
│   │   └── safety.module.ts
│   ├── crew/
│   │   ├── dto/
│   │   │   └── assign-crew.dto.ts
│   │   ├── crew.controller.ts
│   │   ├── crew.service.ts
│   │   └── crew.module.ts
│   ├── public-reporter/
│       ├── dto/
│       │   └── create-report.dto.ts
│       ├── public-reporter.controller.ts  # /public/{slug}/report
│       ├── public-reporter.service.ts     # validation géo-temporelle + RGPD
│       └── public-reporter.module.ts
│   ├── white-label/                       # ── AJOUT v4.0 ──
│   │   ├── dto/
│   │   │   └── upsert-brand.dto.ts        # validation couleurs HEX + URLs
│   │   ├── white-label.controller.ts      # GET/PUT/DELETE /brand + /brand/style + /brand/tokens
│   │   ├── white-label.middleware.ts      # Attach req.tenantBrand (non-blocking)
│   │   ├── white-label.service.ts         # getBrand (Redis cache 5min) + buildStyleTag + sanitizeCss
│   │   └── white-label.module.ts
│   └── pricing/                           # ── AJOUT v4.0 ──
│       ├── dto/
│       │   └── bus-cost-profile.dto.ts    # UpsertBusCostProfileDto
│       ├── interfaces/
│       │   └── cost-calculator.interface.ts # ICostCalculator (pure — pas de NestJS)
│       ├── engines/
│       │   └── cost-calculator.engine.ts  # Implémentation pure — testable sans DB
│       ├── profitability.service.ts       # Orchestration Prisma + CostCalculatorEngine
│       ├── yield.service.ts               # Moteur Yield Management 4 règles
│       ├── pricing.controller.ts          # 7 endpoints profil coût + snapshot + yield
│       └── pricing.module.ts              # class ProfitabilityModule (évite conflit core/pricing)
│
└── common/
    ├── constants/
    │   ├── workflow-states.ts       # Enums d'états par entité
    │   └── permissions.ts           # Constantes compile-time (références seulement — PAS source runtime)
    ├── types/
    │   ├── domain-event.type.ts     # DomainEvent interface
    │   ├── base-event.type.ts       # BaseEvent interface partagée TripEvent/Incident
    │   └── api-response.type.ts     # Response envelopes
    ├── decorators/
    │   ├── tenant-id.decorator.ts   # @TenantId() param decorator
    │   ├── current-user.decorator.ts # @CurrentUser()
    │   └── scope-context.decorator.ts # @ScopeCtx() param decorator
    ├── filters/
    │   └── http-exception.filter.ts # RFC 7807
    ├── geo/
    │   ├── interfaces/
    │   │   └── geo.interface.ts     # IGeoService (ST_Distance ou haversine)
    │   └── haversine.service.ts     # Fallback sans PostGIS
    └── interceptors/
        ├── request-id.interceptor.ts
        └── logging.interceptor.ts
```

### 2.2 Responsabilités par Module

| Module | Propriétaire | Publie | Consomme |
|---|---|---|---|
| `core/iam` | User, Role, Permission, Session, Agency | — | — |
| `core/workflow` | WorkflowConfig, WorkflowTransition, AuditLog | Tous events via IEventBus | — |
| `core/pricing` | PricingRules | — | InstalledModule |
| `modules/tenant` | Tenant, InstalledModule | `tenant.provisioned` | — |
| `modules/agency` | Agency (CRUD) | — | — |
| `modules/ticketing` | Ticket, Traveler, Baggage | Via WorkflowEngine | `trip.boarding_started`, `trip.completed` |
| `modules/parcel` | Parcel, Shipment | Via WorkflowEngine | `trip.departed` |
| `modules/fleet` | Bus, Staff, Route, Waypoint, Station | `bus.status_changed` | `incident.mechanical` |
| `modules/trip` | Trip | Via WorkflowEngine | `checklist.pre_departure.compliant` |
| `modules/cashier` | CashRegister, Transaction | `cashregister.opened/closed` | — |
| `modules/tracking` | — (lit Trip.lat/lng) | `gps.updated` → Redis direct | — |
| `modules/manifest` | — (agrégation) | — | `ticket.boarded`, `parcel.loaded` |
| `modules/flight-deck` | Checklist, Incident | `checklist.*.compliant`, `incident.*` | `trip.arrived` |
| `modules/garage` | MaintenanceReport | `maintenance.approved` | `incident.mechanical` |
| `modules/sav` | LostFoundItem, Claim | `sav.*` | `incident.lost_object`, `parcel.damaged` |
| `modules/notification` | NotificationPreference | — | Tous events domain |
| `modules/display` | — (read-only) | — | `trip.*` → Redis → WebSocket |
| `modules/analytics` | — (read-only agrégée) | — | — |
| `modules/crm` | Campaign, VoyagerProfile enrichi | — | `trip.completed` |
| `modules/feedback` | Feedback, Rating | `rating.updated` | `trip.completed` |
| `modules/safety` | SafetyAlert | `safety.alert` via IEventBus | GPS buffer Redis |
| `modules/crew` | CrewAssignment | — | — |
| `modules/public-reporter` | PublicReport | `public.report.created` | GPS buffer Redis |

### 2.3 Distinction Agence vs Gare (dimensions orthogonales)

Deux entités que l'UI et les permissions ne doivent jamais confondre.

| Aspect | `Agency` | `Station` |
|---|---|---|
| Domaine | Organisationnel / RH | Géographique / opérationnel |
| Rôle | Bureau du transporteur (employés, manager, caisse) | Point sur la carte (origine/destination, dépose colis, embarquement) |
| IAM | Scope permission `.agency`, `User.agencyId` FK | Pas de scope IAM, pas de rattachement user |
| FKs entrants | `User.agencyId`, `CashRegister.agencyId` | `Route.originId`, `Waypoint.stationId`, `Parcel.destinationId`, `Shipment.destinationId`, `Traveler.dropOffStationId`, `Agency.stationId?` |
| Question | *« Qui gère ça ? »* | *« Où ça se passe ? »* |

**Relation optionnelle.** `Agency.stationId?` peut pointer vers une `Station` (agence installée dans une gare). La réciproque (`Station._count.agencies`) indique combien d'agences opèrent depuis la gare.

**Cas valides.**
- Gare-relais **sans** agence (simple point d'arrêt routier).
- Agence de back-office **sans** gare (comptabilité, direction).
- N agences rattachées à la même gare.

**Corollaire IAM.** `PermissionGuard` ne vérifie jamais de `stationId` ; il vérifie `agencyId`. Une station n'est donc **jamais** un scope d'autorisation — c'est une donnée métier.

### 2.4 Personnel : Staff (RH) vs StaffAssignment (métier)

Voir [DESIGN_Staff_Assignment.md](DESIGN_Staff_Assignment.md) pour le détail et l'historique de la refonte.

Trois couches distinctes **qu'il ne faut jamais confondre** :

```
User ─── identité + login + scope IAM (permissions)
  └─ staffProfile?: Staff ── enveloppe RH : statut global, home agency, hireDate
                              └─ assignments: StaffAssignment[] ── postes occupés
                                                                   (rôle × agence × dispo)
```

| Couche | Question | Exemples de champs |
|---|---|---|
| `User.role` (IAM) | *« Qu'a-t-il le droit de faire ? »* | permissions RBAC |
| `Staff` | *« Est-il employé chez nous ? »* | `status`, `agencyId` (home), `hireDate` |
| `StaffAssignment` | *« Quel(s) poste(s) occupe-t-il, où, depuis quand ? »* | `role`, `agencyId?`, `startDate`, `endDate?`, `isAvailable` |

**Règles d'or.**
- Modifier un rôle IAM **ne crée pas** de Staff ni d'affectation. Les deux axes sont indépendants.
- Un Staff peut avoir 0..N affectations actives (multi-rôles, multi-agences possibles).
- Une affectation est **clôturée** (`status=CLOSED` + `endDate`), jamais supprimée — l'historique reste exploitable.
- L'archivage d'un Staff cascade : toutes ses affectations ouvertes passent en CLOSED (invariant DESIGN §5.2).

**Couverture d'une affectation (3 cas).**

| Configuration | Signification |
|---|---|
| `agencyId` renseigné, pas de `StaffAssignmentAgency` | **Mono-agence** (cas courant) |
| `agencyId = null`, pas de `StaffAssignmentAgency` | **Tenant-wide** (toutes agences) |
| `agencyId = null`, N lignes `StaffAssignmentAgency` | **Multi-spécifique** (N agences précises) |

Requête « visible depuis agence X » :
```sql
SELECT * FROM staff_assignments A
WHERE A.status='ACTIVE' AND A.isAvailable=true AND (
     A.agencyId = :X
  OR (A.agencyId IS NULL AND NOT EXISTS (SELECT 1 FROM staff_assignment_agencies WHERE "assignmentId"=A.id))
  OR EXISTS (SELECT 1 FROM staff_assignment_agencies WHERE "assignmentId"=A.id AND agencyId=:X)
)
```

### 2.5 Invariant Agency — "tout tenant ≥1 agence"

**Problème résolu.** Le `PermissionGuard` ([`src/core/iam/guards/permission.guard.ts`](src/core/iam/guards/permission.guard.ts)) rejette avec 403 toute requête dont la permission est en scope `.agency` si l'acteur n'a pas d'`agencyId`. Un tenant fraîchement onboardé doit donc disposer d'au moins une agence, et son admin doit y être rattaché, sinon tous les endpoints scope `.agency` retournent 403 (observé : `restore-starter-pack`, `GET /templates`, etc.).

**Contrat (pattern Office 365).**

| Acteur | Garantie | Code |
|---|---|---|
| `OnboardingService.onboard()` | Crée l'agence « Agence principale » (fr) / « Main Agency » (en) AVANT l'admin user et lui affecte `agencyId` | [`onboarding.service.ts`](src/modules/onboarding/onboarding.service.ts) |
| `bootstrapPlatform()` + `backfillDefaultAgencies()` | Agence "Main" pour le tenant plateforme + rattrape tous les tenants existants sans agence | [`prisma/seeds/iam.seed.ts`](prisma/seeds/iam.seed.ts) |
| `AgencyService.remove()` | Retourne 409 Conflict si c'est la dernière agence ; détache les users (`agencyId = null`) sinon | [`src/modules/agency/agency.service.ts`](src/modules/agency/agency.service.ts) |
| Dev seed | Utilise `ensureDefaultAgency()` pour tous les tenants | [`prisma/seeds/dev.seed.ts`](prisma/seeds/dev.seed.ts) |

**Permissions dédiées.**
- `control.agency.manage.tenant` → `AgencyModule.create/update/remove`
- `data.agency.read.tenant` → `AgencyModule.findAll/findOne` (accordée par défaut à `TENANT_ADMIN`)

**Endpoints** (`AgencyController`, `/tenants/:tenantId/agencies`)
```
GET    /              → liste  (AGENCY_READ_TENANT)
GET    /:id           → détail (AGENCY_READ_TENANT)
POST   /              → créer  (AGENCY_MANAGE_TENANT)
PATCH  /:id           → éditer (AGENCY_MANAGE_TENANT)
DELETE /:id           → suppr. (AGENCY_MANAGE_TENANT) — 409 si dernière agence
```

**Backfill tenants existants.** `npx ts-node prisma/seeds/iam.seed.ts` — idempotent ; crée l'« Agence principale » (ou renomme l'ancienne « Siège »/« Headquarters » si mono-agence) et rattache les users `STAFF`/`DRIVER` orphelins pour chaque tenant sans agence. Appelle aussi `backfillDefaultWorkflows()` pour seeder les `WorkflowConfig` par défaut manquants.

---

## 3. Workflow Engine

### 3.1 Interfaces

```typescript
// IWorkflowEntity — chaque entité managée par le moteur
interface IWorkflowEntity {
  id:       string
  tenantId: string
  status:   string
  version:  number   // optimistic lock
}

// TransitionInput — entrée du moteur
interface TransitionInput {
  entityType:      WorkflowEntityType  // enum
  entityId:        string
  action:          string
  userId:          string
  tenantId:        string
  idempotencyKey:  string   // obligatoire — format: {entityType}:{entityId}:{action}:{reqHash}
  context?:        Record<string, unknown>
  ipAddress?:      string
}

// TransitionResult
interface TransitionResult {
  status:     'SUCCESS' | 'ALREADY_PROCESSED' | 'GUARD_FAILED' | 'LOCKED'
  entity?:    IWorkflowEntity
  transition?: WorkflowTransition
  error?:     { code: string; message: string }
}
```

### 3.2 Algorithme Complet

```typescript
async transition(input: TransitionInput): Promise<TransitionResult> {
  // 1. IDEMPOTENCE — retour immédiat si déjà traité
  const existing = await db.workflowTransition.findUnique({
    where: { idempotencyKey: input.idempotencyKey }
  })
  if (existing) return { status: 'ALREADY_PROCESSED', transition: existing }

  // 2. CHARGEMENT AVEC LOCK PESSIMISTE
  const entity = await loadEntityForUpdate(input.entityType, input.entityId)
  // → SELECT ... FOR UPDATE NOWAIT — 423 si lock tenu

  // 3. RÉSOLUTION CONFIG (cache in-process LRU, TTL 30s)
  const config = await configCache.get(
    `${input.tenantId}:${input.entityType}:${entity.status}:${input.action}`
  ) ?? await loadAndCacheConfig(...)
  if (!config) throw new WorkflowTransitionNotFoundError()

  // 4. VÉRIFICATION PERMISSION
  await iamService.assertPermission(input.userId, config.requiredPerm, input.tenantId)

  // 5. ÉVALUATION GUARDS
  const failedGuard = await guardEvaluator.findFirstFailed(config.guards, entity, input.context)
  if (failedGuard) throw new GuardFailedError(failedGuard.errorCode, failedGuard.errorMessage)

  // 6. TRANSACTION ATOMIQUE (4 opérations en 1 transaction)
  const result = await db.$transaction(async (tx) => {
    // 6a. Update état avec version check (optimistic lock)
    const updated = await tx.$queryRaw`
      UPDATE ${entityTable} SET status = ${config.toState}, version = version + 1
      WHERE id = ${entity.id} AND version = ${entity.version}
      RETURNING *
    `
    if (updated.length === 0) throw new OptimisticLockError()

    // 6b. Log idempotence
    await tx.workflowTransition.create({ data: { idempotencyKey: input.idempotencyKey, ... } })

    // 6c. AuditLog immuable
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId, userId: input.userId,
        plane: config.requiredPerm.startsWith('control') ? 'control' : 'data',
        level: 'info',
        action: `${input.entityType.toLowerCase()}.${input.action.toLowerCase()}`,
        resource: `${input.entityType}:${input.entityId}`,
        oldValue: { status: entity.status, version: entity.version },
        newValue: { status: config.toState, version: entity.version + 1 },
        ipAddress: input.ipAddress,
      }
    })

    // 6d. OutboxEvent (atomique avec la transaction)
    await tx.outboxEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: `${input.entityType.toLowerCase()}.${input.action.toLowerCase()}`,
        aggregateType: input.entityType,
        aggregateId: input.entityId,
        payload: buildEventPayload(entity, config, input),
        status: 'PENDING',
      }
    })

    return updated[0]
  })

  // 7. SIDE EFFECTS SYNCHRONES (hors transaction — uniquement les critiques)
  const syncEffects = config.sideEffects.filter(e => !e.async)
  await sideEffectDispatcher.executeSyncBatch(syncEffects, result, input)

  return { status: 'SUCCESS', entity: result }
}
```

### 3.3 Guard Evaluator

```typescript
// Types de Guards supportés
enum GuardType {
  ENTITY_STATE      = 'ENTITY_STATE',      // Trip.status == 'BOARDING'
  CAPACITY          = 'CAPACITY',          // Shipment.remainingWeight >= Parcel.weight
  FIELD_MATCH       = 'FIELD_MATCH',       // Shipment.destinationId == Parcel.destinationId
  CHECKLIST_COMPLIANT = 'CHECKLIST_COMPLIANT', // Checklist PRE_DEPARTURE isCompliant
  RATE_LIMIT        = 'RATE_LIMIT',        // SOS max 3/hour
}

// Évaluation en parallèle, court-circuit sur premier échec
async findFirstFailed(guards, entity, context): Promise<GuardDefinition | null> {
  const results = await Promise.all(guards.map(g => evaluate(g, entity, context)))
  return results.find(r => !r.passed) ?? null
}
```

### 3.4 WorkflowConfig — Seeds par défaut

Chaque nouveau tenant reçoit une configuration par défaut (seed) pour les 5 workflows majeurs. L'admin peut ensuite la modifier via `control.workflow.config.tenant`. La seed est versionnée (version = 1) et peut être comparée à la configuration tenant actuelle pour audit.

---

## 4. Event System

### 4.1 Architecture Transactional Outbox

```
WRITE PATH:
  Domain Action
    └── WorkflowEngine.transition()
          └── db.$transaction([
                updateEntity,
                createWorkflowTransition,    ← idempotence
                createAuditLog,              ← audit
                createOutboxEvent(PENDING)   ← event atomique
              ])

DELIVERY PATH (OutboxPoller — toutes les 1s):
  SELECT ... FOR UPDATE SKIP LOCKED (50 events max)
    └── Pour chaque event:
          1. EventDispatcher.dispatch(event) → handlers in-process
          2. RedisPublisher.publish(channel, payload) → WebSocket fan-out
          3. UPDATE OutboxEvent SET status = 'DELIVERED'
          └── Si échec: retry avec backoff exponentiel → DLQ après 5 tentatives

DEAD LETTER QUEUE:
  DeadLetterEvent table
    └── Interface admin : GET /control/tenants/{tid}/dlq
    └── Replay manuel  : POST /control/tenants/{tid}/dlq/{id}/replay
    └── Alerte         : Prometheus alert si DLQ non-vide > 1h
```

### 4.2 Convention Événements

```
Format : {entity_type_snake}.{action_past_tense}[.{qualifier}]

ticket.created | ticket.confirmed | ticket.checked_in | ticket.boarded
ticket.cancelled | ticket.expired | ticket.refunded

parcel.created | parcel.assigned_to_shipment | parcel.loaded
parcel.in_transit | parcel.arrived | parcel.delivered | parcel.damaged

trip.planned | trip.boarding_started | trip.departed
trip.paused | trip.resumed | trip.delayed | trip.completed

bus.boarding_opened | bus.departed | bus.arrived | bus.maintenance_entered | bus.restored

checklist.pre_departure.compliant | checklist.pre_departure.failed
checklist.post_trip.completed | checklist.boarding_ready.compliant

incident.declared | incident.sos_triggered | incident.resolved

cashregister.opened | cashregister.closed | cashregister.discrepancy_detected

tenant.provisioned | tenant.module.installed | tenant.module.uninstalled
```

### 4.3 Redis Channels (WebSocket Fan-out)

```
{tenantId}:trip:{tripId}                  → Clients tracking bus
{tenantId}:station:{stationId}:display    → Écrans départs/arrivées gare
{tenantId}:bus:{busId}:screen             → Écran tablette sur bus
{tenantId}:tracking:{tripId}:gps         → Flux GPS temps réel
{tenantId}:manifest:{tripId}              → Updates manifest chauffeur
{tenantId}:notifications:{userId}         → Notifications push in-app
```

### 4.4 Retry Policy

```
Tentative 1: immédiat
Tentative 2: +10s
Tentative 3: +40s
Tentative 4: +160s (2min40)
Tentative 5: +640s (10min40) → DLQ si échec

Formule: delay = min(attempts² × 10s, 600s)
```

---

## 5. Base de Données

### 5.1 Schéma Prisma (Résumé des tables)

| Table | Description | Clés |
|---|---|---|
| Tenant | Transporteur SaaS | id, slug, provisionStatus |
| Agency | Agence/Gare d'une entreprise | id, tenantId, stationId |
| User | Utilisateur | id, tenantId, agencyId, roleId |
| Role | Conteneur de permissions | id, tenantId |
| Permission | Clé de permission string | id, key |
| Station | Gare ou relais | id, tenantId, coordinates(PostGIS) |
| Route | Ligne permanente | id, tenantId, originId, destinationId |
| Waypoint | Point de passage d'une route | id, routeId, stationId, order |
| Bus | Véhicule | id, tenantId, status, seatLayout, version |
| Staff | Enveloppe RH d'un user | id, userId, tenantId, agencyId, status, hireDate |
| StaffAssignment | Poste occupé par un Staff | id, staffId, role, agencyId?, status, dates, isAvailable, totalDriveTimeToday |
| StaffAssignmentAgency | Couverture multi-agences d'une affectation | assignmentId, agencyId |
| Trip | Occurrence d'une route | id, tenantId, status, roadbook, version |
| Checklist | Formulaire vérification | id, tripId, type, isCompliant |
| Incident | Anomalie terrain | id, tripId, type, severity |
| Ticket | Billet passager | id, tenantId, tripId, qrCode, status, version |
| Traveler | État opérationnel passager | id, ticketId, dropOffStationId, status |
| Baggage | Bagage lié à un ticket | id, ticketId, weight, type |
| Parcel | Colis unitaire | id, tenantId, destinationId(FK Station), status, history |
| Shipment | Groupement de colis | id, tenantId, tripId, destinationId(FK Station), status |
| PricingRules | Règles tarifaires | id, tenantId, routeId, rules(JSONB) |
| CashRegister | Session de caisse | id, tenantId, agencyId, auditStatus |
| Transaction | Flux financier | id, cashRegisterId, type, paymentMethod |
| MaintenanceReport | Rapport mécanicien | id, busId, mechanicId, partsUsed |
| LostFoundItem | Objet trouvé | id, tenantId, tripId, status, signatureUrl |
| Claim | Réclamation formelle | id, tenantId, entityId, type, status |
| WorkflowConfig | Config UWE par tenant | id, tenantId, entityType, guards, sideEffects, version |
| WorkflowTransition | Log idempotence | id, idempotencyKey@unique |
| OutboxEvent | File d'événements | id, status, aggregateType, payload |
| DeadLetterEvent | Événements en échec | id, errorLog, resolvedAt |
| AuditLog | Trace ISO 27001 | id, tenantId, action, oldValue, newValue (partitionné) |
| InstalledModule | Feature flags tenant | id, tenantId, moduleKey, config |
| NotificationPreference | Préférences notif | id, userId, sms, whatsapp, push |
| Session | Sessions Better Auth | id, userId, token@unique |
| Account | Comptes OAuth | id, userId, providerId |
| **v3.0 — nouvelles tables** | | |
| Role | Rôle DB-driven par tenant | id, tenantId, name, isSystem |
| RolePermission | Mapping rôle↔permission | id, roleId, permission (unique) |
| TripEvent | Événements trip (pauses/checkpoints/incidents) | id, tripId, type, severity, claimId? |
| Feedback | Note brute voyageur post-trip | id, userId, tripId, driverId?, busId?, ratings JSONB |
| Rating | Agrégat notes par entité | id, entityType, entityId, avgScore, count |
| SafetyAlert | Alerte conduite dangereuse | id, tenantId, tripId, reporterId, verificationScore |
| CrewAssignment | Équipage par trajet | id, tripId, staffId, crewRole, briefedAt? |
| PublicReport | Signalement citoyen | id, tenantId, plateOrPark, type, reporterGpsExpireAt |
| Campaign | Campagne marketing tenant | id, tenantId, criteria JSONB, status |
| **v4.0 — CRM Customer unifié (2026-04-18)** | | |
| Customer | Identité CRM tenant-scoped (voyageur + expéditeur unifiés) | id, tenantId, phoneE164, email, name, userId?, segments[], compteurs, deletedAt, @@unique([tenantId, phoneE164]), @@unique([tenantId, email]) |
| CustomerClaimToken | Magic link sha-256 hashé (one-shot, TTL 30j) | id, tenantId, customerId, tokenHash@unique, channel, expiresAt, usedAt?, invalidatedAt? |
| CustomerRetroClaimOtp | OTP SMS/WhatsApp pour claim rétroactif (Phase 3, TTL 5min, 5 attempts max) | id, tenantId, phoneE164, otpHash, targetType, targetId, attempts, expiresAt, usedAt?, invalidatedAt? |

**Changements FKs (v4.0 CRM) :**
- `Ticket.passengerId` devient **nullable** (plus de sentinel `portal-anonymous`) ; ajout de `customerId`, `passengerPhone`, `passengerEmail` ; index `[tenantId, customerId]`, `[tenantId, passengerPhone]`.
- `Ticket.agencyId` devient **nullable** (vente portail public sans agence).
- `Parcel.senderId` devient **nullable** ; ajout de `senderCustomerId`, `recipientCustomerId` ; index dédiés.
- `User.customerProfile` : back-relation optionnelle vers `Customer` (one-to-one via `Customer.userId`).

### 5.1.bis Architecture CRM — Customer canonique

**Principe :** `Customer` (identité CRM) est décorrélé de `User` (authentification). Un Customer existe dès la 1ʳᵉ transaction, avec ou sans compte :

```
   ┌─────────────┐      ┌──────────────────┐        ┌──────────┐
   │  Ticket     │──────▶  Customer        │◀───────│  Parcel  │
   │  (issue)    │      │  (resolveOr      │        │ (register)│
   └─────────────┘      │   CreateCustomer)│        └──────────┘
                        │                  │
                        │  userId?         │   claim (magic link sha-256)
                        └────────┬─────────┘        │
                                 │                  ▼
                                 └────────────▶  User (signup)
```

Clef de matching : `(tenantId, phoneE164)` → fallback `(tenantId, email)`. Téléphone normalisé E.164 via `src/common/helpers/phone.helper.ts` (country du tenant).

**Services** :
- `CustomerResolverService.resolveOrCreate` : upsert idempotent, tenant-scoped, enrichissement progressif.
- `CustomerClaimService.issueToken` : génère token (crypto.randomBytes 32), stocke `sha256(token)`, invalide les tokens précédents, dispatche WhatsApp+SMS+Email.
- `CustomerClaimService.previewToken` / `completeToken` : consomme one-shot avec isolation tenant stricte.
- `RetroClaimService.initiate` / `confirm` (Phase 3) : claim rétroactif avec OTP 6 chiffres, sha256, 5 tentatives max, rate-limit 3/jour/phone, isolation tenant.
- `CustomerRecommendationService.byCustomer` / `byPhone` (Phase 4) : recommandations dérivées à la volée (top siège, fareClass, routes) depuis l'historique Ticket/Parcel, sans persistance.
- `CustomerSegmentService.recomputeForCustomer` / `recomputeForTenant` (Phase 5) : segments auto VIP/FREQUENT/NEW/DORMANT, préserve les segments manuels (CORPORATE, labels libres), idempotent.
- `CustomerResolverService.bumpCounters` : incrémente totalTickets / totalParcels / totalSpentCents dans la tx ticket/parcel ; `recomputeSegmentsFor` : hook fire-and-forget post-commit.

**Règles d'or :**
1. Le token clair n'est JAMAIS stocké — seulement `sha-256`.
2. `@@unique([tenantId, phoneE164])` partielle (NULL toléré par PG) — plusieurs Customers email-only possibles.
3. `totalSpentCents: BigInt` — JAMAIS Float sur un compteur monétaire.
4. Soft-delete via `deletedAt` + `mergedIntoId` pour RGPD droit à l'oubli sans perdre les agrégats financiers.
5. Rate-limit claim endpoints : 10 preview/min/IP, 5 complete/min/IP via `@Throttle` Nest.

### 5.2 Politiques RLS (Row Level Security)

```sql
-- Mode RESTRICTIVE : 0 ligne si app.tenant_id non défini (fail-closed)
ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ticket" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Ticket"
  AS RESTRICTIVE FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- app_superadmin bypass (Control Plane uniquement)
CREATE POLICY superadmin_bypass ON "Ticket"
  AS PERMISSIVE FOR ALL TO app_superadmin USING (true);

-- Pattern identique pour : Trip, Parcel, Shipment, Ticket, Traveler,
-- Bus, Staff, CashRegister, Transaction, Checklist, Incident,
-- MaintenanceReport, LostFoundItem, Claim, AuditLog, OutboxEvent
-- WorkflowConfig, InstalledModule, PricingRules, Route, Station, Agency
```

### 5.3 Middleware RLS dans NestJS

```typescript
// Prisma extension — SET LOCAL automatique sur chaque query
const prismaWithRls = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const ctx = tenantContext.getStore()  // AsyncLocalStorage
        if (ctx?.tenantId) {
          return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL app.tenant_id = ${ctx.tenantId}`
            return query(args)
          })
        }
        return query(args)
      }
    }
  }
})
```

### 5.4 Index Critiques

```sql
-- WorkflowConfig : lookup par le moteur (très fréquent)
CREATE INDEX CONCURRENTLY idx_wf_config_lookup
  ON "WorkflowConfig" ("tenantId", "entityType", "fromState", "action")
  WHERE "isActive" = true;

-- OutboxEvent : le poller lit uniquement PENDING
CREATE INDEX CONCURRENTLY idx_outbox_pending
  ON "OutboxEvent" ("status", "scheduledAt")
  WHERE "status" = 'PENDING';

-- Traveler : getStationDropOff() — query critique temps réel
CREATE INDEX CONCURRENTLY idx_traveler_dropoff
  ON "Traveler" ("tripId", "dropOffStationId")
  WHERE "status" = 'BOARDED';

-- Trip : filtrer par status actifs uniquement
CREATE INDEX CONCURRENTLY idx_trip_active
  ON "Trip" ("tenantId", "status")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');

-- AuditLog : partitionnement RANGE mensuel
CREATE TABLE "AuditLog" PARTITION BY RANGE ("createdAt");
-- Partitions créées automatiquement par pg_cron chaque mois

-- WorkflowTransition : idempotency check (unique déjà indexé)
-- Parcel tracking
CREATE INDEX CONCURRENTLY idx_parcel_tracking
  ON "Parcel" ("trackingCode");

-- Ticket QR verify
CREATE INDEX CONCURRENTLY idx_ticket_qr
  ON "Ticket" ("qrCode");
```

### 5.5 Gestion du Cache Redis

```
Stratégie : Cache-Aside (read-through manuel)

Clés Redis :
  wf:config:{tenantId}:{entityType}:{fromState}:{action}   TTL: 30s  (WorkflowConfig)
  display:{tenantId}:{stationId}:snapshot                   TTL: 10s  (snapshot écrans)
  gps:buffer:{tripId}                                       TTL: 30s  (throttle GPS)
  manifest:{tripId}                                         TTL: 5s   (cache manifest)
  pricing:{tenantId}:{routeId}                              TTL: 300s (règles tarifaires)

Invalidation :
  WorkflowConfig → invalidé sur control.workflow.config.tenant
  Manifest       → invalidé sur ticket.boarded ou parcel.loaded
  Pricing        → invalidé sur control.pricing.manage.tenant
  IAM Permissions → invalidé sur control.iam.manage.tenant (pattern: iam:perm:{roleId}:*)

Clés supplémentaires v3.0 :
  iam:perm:{roleId}:{permission}                     TTL: 60s  (cache permission guard)
  rl:public:{tenantId}:{ip}                          TTL: 3600s (rate limit public reporter)
  rating:cache:{entityType}:{entityId}               TTL: 300s (cache agrégat notes)
  safety:gps:{tripId}                                TTL: 30s  (dernière position connue bus)
```

---

## 6. APIs

### 6.1 Conventions

```
Versioning:      /api/v1/ → /api/v2/ (breaking change = nouveau préfixe)
Tenant scope:    /api/v1/tenants/{tenantId}/...
Control plane:   /api/v1/control/...
Auth web:        Cookie httpOnly (Better Auth)
Auth mobile:     Bearer token (SecureStore iOS/Android Keystore)
Idempotence:     Header Idempotency-Key: {uuid} — obligatoire sur POST mutants
Pagination:      Cursor-based: ?cursor={id}&limit={n}&direction=asc|desc
Erreurs:         RFC 7807 Problem Details
```

### 6.2 Format d'Erreur RFC 7807

```json
{
  "type": "https://translog.io/errors/guard-failed",
  "title": "Workflow Guard Failed",
  "status": 409,
  "detail": "Checklist PRE_DEPARTURE must be compliant",
  "errorCode": "GUARD_CHECKLIST_NOT_COMPLIANT",
  "instance": "/api/v1/workflow/transition",
  "context": {
    "entityType": "TRIP",
    "entityId": "clx...",
    "action": "DEPART",
    "guard": "CHECKLIST_COMPLIANT"
  },
  "requestId": "req_01J3...",
  "timestamp": "2026-04-11T10:00:00Z"
}
```

### 6.3 Endpoint Unifié de Transition Workflow

```
POST /api/v1/tenants/{tenantId}/workflow/transition
Headers: Idempotency-Key: {uuid}
Body: {
  "entityType": "TICKET" | "PARCEL" | "TRIP" | "BUS" | "TRAVELER" | "SHIPMENT",
  "entityId": "...",
  "action": "BOARD" | "LOAD" | "DEPART" | ...,
  "context": { ... }   // données additionnelles pour les guards
}
Response 200: { status: "SUCCESS", entity: {...} }
Response 202: { status: "ALREADY_PROCESSED" }  // idempotent
Response 409: { type: ".../guard-failed", ... }
Response 423: { type: ".../entity-locked", ... }
Response 403: { type: ".../permission-denied", ... }
```

---

## 7. Realtime Layer

### 7.1 Architecture Socket.io + Redis Adapter

```
Client (mobile/web/écran)
  └── connect(namespace, { tenantId, token })
        └── Authenticate (session token ou device whitelist)
        └── Join rooms : {tenantId}:station:{id}:display
        └── Emit snapshot initial (état courant depuis Redis/DB)

OutboxPoller (backend)
  └── Deliver event
        └── EventDispatcher.dispatch() → handlers in-process
        └── RedisPublisher.publish(channel, payload)
              └── Socket.io Redis Adapter
                    └── Broadcast vers tous les pods
                          └── server.to(room).emit(eventType, data)
```

### 7.2 Gestion Reconnexion

```typescript
// Côté serveur : replay des événements manqués
async handleConnection(client: Socket) {
  const { lastEventId, tenantId, stationId } = client.handshake.auth

  // Rejoindre les rooms
  client.join(`${tenantId}:station:${stationId}:display`)

  // Snapshot initial depuis Redis (ou DB si cache miss)
  const snapshot = await redis.get(`display:${tenantId}:${stationId}:snapshot`)
  client.emit('snapshot', snapshot ? JSON.parse(snapshot) : await buildSnapshot(...))

  // Replay des événements manqués (max 100, dernières 5min)
  if (lastEventId) {
    const missed = await db.outboxEvent.findMany({
      where: { tenantId, status: 'DELIVERED', id: { gt: lastEventId },
               createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
      orderBy: { createdAt: 'asc' }, take: 100
    })
    missed.forEach(e => client.emit('replay', e.payload))
  }
}
```

### 7.3 GPS Throttling

```typescript
// Accepte 1 mise à jour GPS toutes les 5s par trip côté API
// Écrit en Redis immédiatement pour Pub/Sub (temps réel clients)
// Écrit en DB toutes les 10s (protection write amplification)

async updateGps(tripId, lat, lng, tenantId) {
  const apiThrottleKey = `gps:api:${tripId}`
  if (await redis.set(apiThrottleKey, '1', 'EX', 5, 'NX') === null) {
    return  // throttled — pas de réponse d'erreur, silencieux
  }

  // Pub/Sub immédiat (pas de throttle sur le realtime client)
  await redis.publish(`${tenantId}:tracking:${tripId}:gps`,
    JSON.stringify({ lat, lng, ts: Date.now() }))

  // Buffer DB : écrit uniquement si > 10s depuis dernier write DB
  const dbThrottleKey = `gps:db:${tripId}`
  if (await redis.set(dbThrottleKey, '1', 'EX', 10, 'NX')) {
    db.trip.update({ where: { id: tripId },
      data: { currentLat: lat, currentLng: lng, lastGpsAt: new Date() }
    }).catch(e => logger.error('GPS DB write failed', { tripId, error: e.message }))
  }
}
```

---

## 8. Sécurité

### 8.1 Vault HA — Bootstrap

```bash
# Cluster Raft 3 nœuds — init séquence
vault operator init -key-shares=5 -key-threshold=3
# → 5 unseal keys + 1 root token
# → Stocker les unseal keys dans 5 endroits distincts (jamais ensemble)

# Secrets Engine
vault secrets enable -version=2 -path=secret kv
vault secrets enable -path=pki pki
vault secrets enable -path=transit transit
vault auth enable kubernetes  # pour les pods K8s

# Structure des secrets
secret/platform/db          → DATABASE_URL
secret/platform/redis       → REDIS_URL
secret/platform/minio       → MINIO endpoint + credentials
secret/tenants/{tid}/hmac   → tenant_hmac_key (QR signing)
secret/tenants/{tid}/pay    → flutterwave_secret, paystack_secret
secret/tenants/{tid}/sms    → twilio_api_key
```

### 8.2 QR Code — HMAC-SHA256

```typescript
// Génération
async generateQr(ticket: { id, tripId, seatNumber, tenantId }): Promise<string> {
  const key = await secretService.getSecret(`tenants/${ticket.tenantId}`, 'hmac_key')
  const payload = `${ticket.id}:${ticket.tripId}:${ticket.seatNumber ?? 'NONE'}`
  const sig = createHmac('sha256', key).update(payload).digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

// Vérification — timing-safe
async verifyQr(qrCode: string, tenantId: string): Promise<TicketQrData> {
  const [encodedPayload, sig] = qrCode.split('.')
  if (!encodedPayload || !sig) throw new InvalidQrError()
  const payload = Buffer.from(encodedPayload, 'base64url').toString()
  const key = await secretService.getSecret(`tenants/${tenantId}`, 'hmac_key')
  const expected = createHmac('sha256', key).update(payload).digest('base64url')
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new InvalidQrError()
  const [ticketId, tripId, seatNumber] = payload.split(':')
  return { ticketId, tripId, seatNumber: seatNumber === 'NONE' ? null : seatNumber }
}
```

### 8.3 Session & Auth

```
Web  : Cookie httpOnly + SameSite=Strict + Secure
Mobile : Better Auth token mode → SecureStore (iOS Keychain / Android Keystore)
JWT  : Short-lived (15min) pour API programmatiques B2B
tenantId : TOUJOURS extrait de la session — jamais du header pour routes auth
```

### 8.4 Rate Limiting

```typescript
const LIMITS = {
  client_mobile:   { ttl: 60, limit: 60 },
  agent_gare:      { ttl: 60, limit: 300 },   // scans intensifs
  chauffeur:       { ttl: 60, limit: 120 },
  super_admin:     { ttl: 60, limit: 600 },
  sos_endpoint:    { ttl: 3600, limit: 3 },   // 3 SOS/heure/userId
  payment_webhook: { ttl: 60, limit: 100 },   // IP allowlist uniquement
}
```

### 8.5 IAM Zero-Hardcode — Runtime Guard

```typescript
// PermissionGuard — vérification DB + cache Redis
@Injectable()
export class PermissionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPerm = this.reflector.get<string>('permission', context.getHandler())
    if (!requiredPerm) throw new InternalServerErrorException('Missing @Permission() decorator')

    const user = getSession(context)
    const cacheKey = `iam:perm:${user.roleId}:${requiredPerm}`

    // Cache Redis TTL 60s
    const cached = await this.redis.get(cacheKey)
    if (cached !== null) return cached === '1'

    // Source de vérité : DB
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId: user.roleId, permission: requiredPerm },
    })
    const granted = rp !== null
    await this.redis.setex(cacheKey, 60, granted ? '1' : '0')

    if (!granted) throw new ForbiddenException()
    return true
  }
}

// Invalidation cache sur modification IAM
// EventHandler 'control.iam.manage.tenant' → redis.del(`iam:perm:${roleId}:*`)
```

**Seed IAM — appelé par OnboardingService :**
```
prisma/seeds/iam.seed.ts
  → insère 11 rôles système par défaut (isSystem=true) avec leurs RolePermission :
      TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT, CASHIER, DRIVER, HOSTESS,
      MECHANIC, AGENT_QUAI, DISPATCHER, CUSTOMER, PUBLIC_REPORTER
  → exécuté atomiquement dans la transaction de provisioning tenant
  → idempotent : upsert sur Role.name @unique([tenantId, name])
  → le runner standalone (main()) est guardé par `require.main === module` pour
    permettre l'import du module (TENANT_ROLES) dans les tests unitaires sans
    déclencher d'opérations Prisma
```

**Contrat RBAC — permissions granulaires, jamais de rôle en dur :**

Le backend (`@RequirePermission('x.y.z')`), la navigation (`nav.config.ts anyOf: […]`)
et le gating UI (`user.permissions.includes(...)`) vérifient **uniquement des permissions**.
Les rôles ne sont que des groupements par défaut — chaque tenant peut rebattre la
matrice via `/admin/iam/roles`.

Exemple de split lecture/écriture (Taxes & Fiscalité, sprint 2026-04-20) :

| Permission | Scope | Rôles seedés par défaut | Usage |
|---|---|---|---|
| `data.tax.read.tenant` | tenant | TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT, CASHIER | Lecture grille fiscale (caissier voit les taxes appliquées au ticket POS) |
| `control.tax.manage.tenant` | tenant | TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT | CRUD TenantTax (ajouter taxe éco, changer taux TVA 18%→20%, cascade…) |

Ce split permet à un comptable de gérer la fiscalité au jour le jour sans toucher
aux autres paramètres tenant (`control.settings.manage.tenant` reste réservé
admin/gérant pour company/payment/branding/portal).

### 8.6 RGPD — Points de Conformité

| Donnée | Rétention | Mécanisme |
|---|---|---|
| GPS Public Reporter | 24h | `reporterGpsExpireAt` + pg_cron nightly delete |
| GPS Voyageur (tracking opt-in) | Session trip + 7j | Supprimé avec TripEvent après 7j |
| Photo pièce d'identité SAV | URL signée 15min | MinIO TTL + URL expirée automatiquement |
| Feedback commentaire libre | 2 ans | Policy configurable tenant |
| AuditLog | 7 ans (légal) | Partitions archivées, pas de delete |

**Annonces permanentes obligatoires :**
- Formulaire Public Reporter : *"Votre position GPS est utilisée uniquement pour valider ce signalement et sera supprimée sous 24h."*
- Formulaire Feedback/Notation : *"Votre avis est utilisé pour améliorer le service. Non revendu. Voir politique de confidentialité."*
- Tracking temps réel Voyageur : *"Votre position est partagée avec le conducteur pour votre sécurité. Désactivable dans les paramètres."*

Ces messages sont des constantes non-configurables côté UI (pas overridables par tenant).

### 8.7 Rate Limiting — Public Reporter

```typescript
// Endpoint public — pas d'auth — rate limit IP agressif
// POST /public/{tenantSlug}/report

const PUBLIC_REPORTER_LIMIT = {
  windowSec:   3600,   // 1 heure
  maxRequests: 5,      // 5 signalements/IP/heure (configurable par tenant)
}

// Sliding window Redis
async checkIpRateLimit(ip: string, tenantId: string): Promise<void> {
  const key = `rl:public:${tenantId}:${ip}`
  const count = await this.redis.incr(key)
  if (count === 1) await this.redis.expire(key, PUBLIC_REPORTER_LIMIT.windowSec)
  if (count > PUBLIC_REPORTER_LIMIT.maxRequests) {
    throw new TooManyRequestsException(
      'Limite de signalements atteinte. Réessayez dans 1 heure.'
    )
  }
}
```

**Protections supplémentaires sur /public :**
- Pas de cookie, pas de session
- `tenantId` extrait de `tenantSlug` (résolution via `Tenant.slug` — pas de path param brut)
- CORS restreint à `*.translog.app` + domaine custom tenant
- Corps de requête limité à 10kb
- Photo optionnelle : validation MIME strict (JPEG/PNG uniquement), max 5Mo, scan antivirus via hook MinIO

### 8.8 mTLS Inter-Services

```yaml
# Chaque service obtient un certificat Vault PKI au démarrage
# Communications : API ↔ Redis, API ↔ MinIO, API ↔ Vault
# Certificate rotation : 24h TTL, renouvelé automatiquement à 80% de la durée de vie
# Revocation : vault write pki/revoke serial_number=xxx
```

---

## 9. Stockage Fichiers

### 9.1 Structure Buckets MinIO

```
translog-{tenantId}-docs/
  ├── incidents/{incidentId}/     TTL: 90 jours
  ├── sav/{itemId}/photo/         TTL: 30 jours post-remise
  ├── sav/{itemId}/signature/     TTL: 7 ans (légal)
  ├── maintenance/{reportId}/     TTL: 2 ans
  ├── checklists/{tripId}/        TTL: 1 an
  └── tickets/{ticketId}/qr.pdf   TTL: 6 mois

translog-platform/
  ├── templates/                  Templates PDF, email
  └── wf-configs-backup/          Backups WorkflowConfig (audit)
```

### 9.2 TTL des URLs Signées

```typescript
enum DocumentType {
  PARCEL_LABEL    = 'PARCEL_LABEL',    // 24h
  TICKET_PDF      = 'TICKET_PDF',      // 2h
  INCIDENT_PHOTO  = 'INCIDENT_PHOTO',  // 1h
  ID_PHOTO_SAV    = 'ID_PHOTO_SAV',    // 15min (donnée biométrique)
  MAINTENANCE_DOC = 'MAINTENANCE_DOC', // 4h
  CHECKLIST_DOC   = 'CHECKLIST_DOC',   // 30min
}

const TTL_SECONDS: Record<DocumentType, number> = {
  [DocumentType.PARCEL_LABEL]:    86400,
  [DocumentType.TICKET_PDF]:      7200,
  [DocumentType.INCIDENT_PHOTO]:  3600,
  [DocumentType.ID_PHOTO_SAV]:    900,    // 15min MAX
  [DocumentType.MAINTENANCE_DOC]: 14400,
  [DocumentType.CHECKLIST_DOC]:   1800,
}
```

---

## 10. Infrastructure

### 10.1 Services Docker Compose

| Service | Image | Rôle |
|---|---|---|
| `postgres` | postgis/postgis:16-3.4 | DB principale + PostGIS |
| `pgbouncer` | pgbouncer/pgbouncer:1.22 | Connection pooler SESSION mode |
| `redis` | redis:7-alpine | Cache + Pub/Sub + GPS buffer |
| `vault` | hashicorp/vault:1.16 | Secrets + PKI |
| `minio` | minio/minio:latest | Object storage |
| `nginx` | nginx:alpine | Reverse proxy + SSL |
| `api` | translog-api:local | NestJS backend |

### 10.2 Variables d'Environnement

```bash
# Seule variable autorisée dans le Dockerfile et .env :
VAULT_ADDR=http://vault:8200

# En développement uniquement (jamais en production) :
VAULT_TOKEN=dev-root-token
NODE_ENV=development
```

### 10.3 Kubernetes — Ressources

```yaml
api:
  replicas: 3
  requests: { cpu: 250m, memory: 512Mi }
  limits:   { cpu: 1000m, memory: 1Gi }

vault:
  StatefulSet: 3 replicas (Raft HA)
  storage: 10Gi per node

postgres:
  StatefulSet: 1 primary + 1 read replica
  storage: 100Gi

redis:
  Deployment: 1 (ou Redis Sentinel pour HA)
```

---

## 11. Observabilité

### 11.1 Logging (Winston JSON structuré)

```json
{
  "level": "info",
  "timestamp": "2026-04-11T10:00:00.000Z",
  "requestId": "req_01J3...",
  "tenantId": "ten_...",
  "userId": "usr_...",
  "module": "WorkflowEngine",
  "action": "TICKET.BOARD",
  "duration_ms": 23,
  "message": "Transition successful"
}
```

### 11.2 Métriques Prometheus

```
http_request_duration_seconds{route, method, status, tenant}
workflow_transitions_total{entity_type, action, status, tenant}
outbox_events_pending_total                    ← alerte si > 1000
outbox_dlq_total                               ← alerte si > 0 pendant 1h
websocket_connections_active{tenant}
gps_updates_per_second{trip}
vault_secret_reads_total
```

### 11.3 Alertes Critiques

| Alerte | Condition | Sévérité |
|---|---|---|
| DLQ non-vide | `outbox_dlq_total > 0` pendant > 1h | CRITICAL |
| Vault indisponible | health check Vault != 200 | CRITICAL |
| Taux d'erreur workflow | `error_rate > 1%` sur 5min | WARNING |
| Latence PgBouncer | `client_wait_time > 500ms` | WARNING |
| Outbox backlog | `outbox_pending > 1000` | WARNING |
| SOS sans résolution | incident SOS non résolu > 30min | CRITICAL |

### 11.4 Tracing (OpenTelemetry → Jaeger)

```
Spans instrumentés :
  WorkflowEngine.transition()    → span complet avec guards + side effects
  OutboxPoller.deliver()          → span par événement livré
  PrismaService.$queryRaw         → auto-instrumentation Prisma
  HTTP requests                   → auto-instrumentation NestJS
```

---

---

## 12. PostGIS & Géolocalisation (Optionnel)

### 12.1 IGeoService Interface

```typescript
// Interface permutable — PostGIS ou haversine applicatif
interface IGeoService {
  distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number>
  isWithinRadius(lat: number, lng: number, centerLat: number, centerLng: number, radiusMeters: number): Promise<boolean>
  autocompleteStations(query: string, tenantId: string, limit?: number): Promise<Station[]>
}

// Implémentation PostGIS (production)
// SELECT ST_Distance(ST_MakePoint($1,$2)::geography, ST_MakePoint($3,$4)::geography)

// Implémentation Haversine (dev/test — sans PostGIS)
// Calcul JS standard — précision ~0.5% acceptable pour use cases de validation
```

### 12.2 Cas d'Usage Géo

| Use Case | PostGIS | Fallback |
|---|---|---|
| Validation géo Public Reporter | `ST_Distance < 2km` | Haversine applicatif |
| Geofencing départ bus (anomalie) | `ST_DWithin(bus_pos, gare_pos, 200)` | Haversine applicatif |
| Checkpoint waypoint atteint | `ST_DWithin(bus_pos, waypoint_zone, radius)` | Distance point→point |
| Autocomplete stations | `Waypoint.gpsZone` PostGIS | `ILIKE '%{query}%'` sur `Station.name` |

### 12.3 Colonnes PostGIS (optionnelles)

```sql
-- Ajoutées uniquement si PostGIS activé (migration conditionnelle)
ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "coordinates" GEOGRAPHY(Point, 4326);
ALTER TABLE "Waypoint" ADD COLUMN IF NOT EXISTS "gpsZone" GEOGRAPHY(Polygon, 4326);

-- Index spatial
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_station_geo ON "Station" USING GIST ("coordinates");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_waypoint_zone ON "Waypoint" USING GIST ("gpsZone");
```

---

---

## 13. White Label (Module W) — v4.0

### 13.1 WhiteLabelService

```typescript
// Cache Redis : clé brand:{tenantId}, TTL 300s
// Injection Redis : @Inject(REDIS_CLIENT) — même token que rbac.service.ts
async getBrand(tenantId: string): Promise<BrandConfig>       // cache-first
async upsert(tenantId: string, dto: UpsertBrandDto)          // invalide le cache
async remove(tenantId: string)                                // invalide le cache
buildStyleTag(brand: BrandConfig): string                    // <style data-tenant-brand>
buildThemeTokens(brand: BrandConfig): Record<string, string> // tokens React/CSS
```

### 13.2 Injection dans le Layout

```html
<!-- SSR : injecté dans <head> avant le premier paint -->
<style data-tenant-brand>
  :root {
    --color-primary: #2563eb;
    --color-secondary: #1a3a5c;
    --color-accent: #f59e0b;
    --color-text: #111827;
    --color-bg: #ffffff;
    --font-family: Inter, sans-serif;
  }
</style>
```

### 13.3 WhiteLabelMiddleware

Résout le `tenantId` depuis la session (auth) ou le path param (`/public/:slug/...`). Attache `req.tenantBrand` de manière non-bloquante (catch → defaults). Appliqué après `TenantMiddleware`.

---

## 14. Profitabilité & Yield Management (Module Pricing) — v4.0

### 14.1 ICostCalculator Interface (Pure Logic)

```typescript
interface ICostCalculator {
  computeCosts(distanceKm: number, profile: CostInputProfile): CostBreakdown;
  computeMargins(costs, totalRevenue, ticketRevenue, totalSeats, bookedSeats, avgTicketPrice, constants): MarginBreakdown;
}
```

`CostCalculatorEngine` = implémentation pure TypeScript (pas de NestJS, pas de Prisma). Testable unitairement sans `@Module`, sans DB.

### 14.2 Formules clés

```
Variable :
  fuelCost        = (consumPer100Km / 100) × distanceKm × fuelPrice
  adBlueCost      = fuelCost × adBlueRatioFuel × (adBlueCostPerL / fuelPricePerL)
  maintenanceCost = maintenanceCostPerKm × distanceKm        ← km-based (ADR-23)
  stationFee      = stationFeePerDeparture

Fixes proratisés :
  driverDailyCost    = monthlySalary / avgTripsPerMonth
  insuranceDailyCost = annualInsurance / daysPerYear         ← TenantBusinessConfig
  depreciationDaily  = (purchase - residual) / years / daysPerYear

Post-snapshot :
  agencyCommission   = ticketRevenue × agencyCommissionRate  ← commission séparée
  operationalMargin  = totalRevenue - totalVariableCost      ← marge opérationnelle
  netMargin          = totalRevenue - totalCost              ← marge nette
```

### 14.3 Yield Engine — 4 règles en cascade

```
GOLDEN_DAY  → isGoldenDay (avgFillRate > 0.85) : prix × (1 + goldenDayMultiplier)
BLACK_ROUTE → isBlackRoute (>50% déficit 90j)  : prix → breakEven estimé
LOW_FILL    → J-2 et fillRate < 0.40           : prix × (1 - lowFillDiscount)
HIGH_FILL   → fillRate ≥ 0.80                  : prix × (1 + highFillPremium)
Bornes      : [basePrice × 0.70, basePrice × 2.00]
```

Tous les seuils configurables via `InstalledModule.config` (clé `YIELD_ENGINE`).

---

---

## 15. Modules RH & Sécurité — v5.0

### 15.1 Vue d'ensemble

Quatre nouveaux modules domaine ajoutés en avril 2026, tous protégés par `@RequireModule('KEY')` :

| Module NestJS       | Clé SaaS         | Controller prefix                     | Permissions principales                                    |
|---------------------|------------------|---------------------------------------|------------------------------------------------------------|
| `FleetDocsModule`   | `FLEET_DOCS`     | `tenants/:tid/fleet-docs`             | `control.fleet.manage.tenant`                              |
| `DriverProfileModule` | `DRIVER_PROFILE` | `tenants/:tid/driver-profile`        | `control.driver.manage.tenant`, `data.driver.profile.agency` |
| `CrewBriefingModule` | `CREW_BRIEFING` | `tenants/:tid/crew-briefing`          | `control.fleet.manage.tenant`, `data.crew.manage.tenant`   |
| `QhseModule`        | `QHSE`           | `tenants/:tid/qhse`                   | `control.qhse.manage.tenant`, `data.accident.report.own`   |

---

### 15.2 FleetDocsModule (`src/modules/fleet-docs/`)

**Responsabilités :**
- CRUD `VehicleDocument` (documents réglementaires par bus : CT, assurance, visite…)
- CRUD `ConsumableTracking` (huile, pneus, filtres — suivi au km)
- Calcul statuts `VALID / EXPIRING / EXPIRED / MISSING` (helper `_computeDocStatus`)
- Calcul statuts `OK / ALERT / OVERDUE` (helper `_computeConsumableStatus`)
- `@Cron(EVERY_DAY_AT_6AM)` → `refreshDocumentStatuses()` + publie `fleet.document.alert`

**Logique métier (_computeDocStatus) :**
```
MISSING  — expiresAt absent
EXPIRED  — now > expiresAt
EXPIRING — now >= expiresAt − alertDaysBeforeExpiry × 86400s
VALID    — sinon
```

**Logique métier (_computeConsumableStatus) :**
```
ALERT   — lastReplacedKm = null (jamais remplacé)
OVERDUE — currentKm >= lastReplacedKm + nominalLifetimeKm
ALERT   — currentKm >= nextDueKm − alertKmBefore
OK      — sinon
```

**Events publiés :** `fleet.document.alert`, `fleet.consumable.alert`

---

### 15.3 DriverProfileModule (`src/modules/driver-profile/`)

**Responsabilités :**
- `DriverRestConfig` — config repos par tenant (minRestMinutes, maxDrivingMinutesPerDay)
- `DriverLicense` — CRUD permis (cat. D/EC/D+E), upload MinIO, alertes expiration
- `DriverRestPeriod` — start/end période de repos
- `checkRestCompliance(tenantId, staffId)` → `{ canDrive, restRemainingMinutes, activeRestPeriod }`
- `DriverTrainingType` + `DriverTraining` — types et sessions de formation, auto-replanification
- `DriverRemediationRule` + `DriverRemediationAction` — évaluation en cascade par score
- `evaluateRemediationForDriver(tenantId, staffId, score)` → `string[]` (actionIds créés)
- `@Cron` → `refreshLicenseStatuses()` + `alertOverdueTrainings()`

**Logique `evaluateRemediationForDriver` :**
```
1. Récupère règles actives où scoreBelowThreshold >= currentScore (ordre priorité)
2. Pour chaque règle : skip si action PENDING/IN_PROGRESS existe déjà (anti-doublon)
3. Crée DriverRemediationAction (status=PENDING)
4. Si actionType=TRAINING et trainingTypeId : crée DriverTraining dans J+7
5. Publie driver.remediation.triggered
6. Retourne [actionId1, actionId2, ...]
```

**Events publiés :** `driver.rest.started`, `driver.rest.violation`, `driver.remediation.triggered`, `driver.training.due`, `driver.license.expiring`

---

### 15.4 CrewBriefingModule (`src/modules/crew-briefing/`)

**Responsabilités :**
- `BriefingEquipmentType` — catalogue équipements obligatoires par tenant (gilets, lampes, trousse…)
- `CrewBriefingRecord` — UN briefing par `crewAssignment` (contrainte unique)
- `allEquipmentOk` — calculé à la création selon items cochés vs types obligatoires

**Logique allEquipmentOk :**
```
Pour chaque BriefingEquipmentType { isMandatory=true } :
  checked = checkedItems.find(i.equipmentTypeId === eq.id)
  if !checked || !checked.ok || checked.qty < eq.requiredQty → manquant
allEquipmentOk = missing.length === 0
```

**Events publiés :** `crew.briefing.completed`, `crew.briefing.equipment_missing`

---

### 15.5 QhseModule (`src/modules/qhse/`)

**Responsabilités :**
- `AccidentReport` + tiers (`AccidentThirdParty`) + blessés (`AccidentInjury`) + suivi médical
- `Dispute` + dépenses (`DisputeExpense`) — suivi assureur/litige
- `QhseProcedure` + `QhseProcedureStep` — bibliothèque procédures par tenant
- `QhseProcedureExecution` + `QhseStepExecution` — exécution traçable (photos optionnelles)
- Auto-déclenchement procédure sur `AccidentReport` si `SeverityType.requiresQhse=true`

**Logique executeStep :**
```
1. Vérifie photoRequired : si requis et pas de photoUrl → BadRequestException
2. Met à jour QhseStepExecution (status, notes, photoUrl)
3. Si tous les steps terminés → execution.status = COMPLETED
4. Publie qhse.procedure.completed si terminé
```

**Events publiés :** `accident.reported`, `accident.updated`, `qhse.procedure.started`, `qhse.procedure.completed`, `dispute.opened`, `dispute.settled`

---

### 15.6 SchedulingGuardModule (`src/modules/scheduling-guard/`)

Module transversal partagé — exporté pour injection dans `TripModule` et `CrewModule`.

**Interface `checkAssignability(tenantId, busId?, staffId?)` :**

```typescript
interface AssignabilityCheckResult {
  canAssign: boolean;
  reasons:   BlockReason[];  // codes: BUS_MAINTENANCE | BUS_OUT_OF_SERVICE |
}                            //        BUS_DOCUMENT_EXPIRED | DRIVER_REST_REQUIRED |
                             //        DRIVER_SUSPENDED | DRIVER_LICENSE_EXPIRED
```

**Vérifications bus :**
1. `bus.status === 'MAINTENANCE_REQUIRED'` → `BUS_MAINTENANCE`
2. `bus.status IN ('OUT_OF_SERVICE', 'RETIRED')` → `BUS_OUT_OF_SERVICE`
3. `VehicleDocument { status='EXPIRED', type.isMandatory=true }` → `BUS_DOCUMENT_EXPIRED`

**Vérifications driver :**
1. `DriverRestPeriod` ouverte avec temps restant > 0 → `DRIVER_REST_REQUIRED`
2. `DriverRemediationAction { actionType='SUSPENSION', status IN PENDING/IN_PROGRESS }` → `DRIVER_SUSPENDED`
3. Aucun `DriverLicense { category IN [D,EC,D+E], status IN [VALID,EXPIRING] }` → `DRIVER_LICENSE_EXPIRED`

**Intégration :** `TripService.create()` et `CrewService.assign()` appellent `checkAssignability` avant toute création/affectation. `BadRequestException` si `!canAssign`.

---

### 15.7 ModuleGuard (`src/core/iam/guards/module.guard.ts`)

Guard global enregistré via `APP_GUARD` (s'exécute après `PermissionGuard`).

**Déclencheur :** `@RequireModule('KEY')` sur classe ou méthode du controller.

**Logique :**
```
1. Pas de @RequireModule → skip (route sans exigence module)
2. Extraire tenantId depuis req[SCOPE_CONTEXT_KEY] (post-PermissionGuard) ou req.user.tenantId
3. Cache Redis : module:{tenantId}:{moduleKey} TTL 300s
   - hit '1' → allow
   - hit '0' → ForbiddenException
4. DB : InstalledModule { tenantId, moduleKey } → isActive
   - true → allow + cache '1'
   - false/absent → ForbiddenException + cache '0'
```

**Invalidation cache :** `ModuleGuard.invalidateModuleCache(tenantId, moduleKey)` — à appeler depuis `TenantService` lors d'un changement d'état `InstalledModule.isActive`.

**Décorateur :** `src/common/decorators/require-module.decorator.ts` — `@RequireModule('FLEET_DOCS')`

---

### 15.8 Nouveaux EventTypes (domain-event.type.ts)

| Type | Déclencheur |
|------|-------------|
| `fleet.document.alert` | Document expirant/expiré détecté par le cron |
| `fleet.consumable.alert` | Consommable en alerte ou dépassé |
| `driver.rest.started` | Début d'une période de repos |
| `driver.rest.violation` | Fin de repos avec durée insuffisante |
| `driver.remediation.triggered` | Action de remédiation créée |
| `driver.training.due` | Formation planifiée en retard |
| `driver.license.expiring` | Permis entrant dans la fenêtre d'alerte |
| `crew.briefing.completed` | Briefing conforme créé |
| `crew.briefing.equipment_missing` | Briefing non conforme (équipements manquants) |
| `accident.reported` | Rapport d'accident créé |
| `accident.updated` | Statut accident mis à jour |
| `qhse.procedure.started` | Exécution de procédure QHSE démarrée |
| `qhse.procedure.completed` | Procédure QHSE terminée (tous steps OK) |
| `dispute.opened` | Litige ouvert |
| `dispute.settled` | Litige clôturé |

---

### 15.9 Nouvelles Permissions

| Constante | String | Usage |
|-----------|--------|-------|
| `DRIVER_MANAGE_TENANT` | `control.driver.manage.tenant` | Gérer dossiers chauffeurs, repos, formations, remédiation |
| `DRIVER_PROFILE_AGENCY` | `data.driver.profile.agency` | Consulter profil chauffeur (scope agence) |
| `DRIVER_REST_OWN` | `data.driver.rest.own` | Chauffeur — voir ses propres périodes de repos |
| `QHSE_MANAGE_TENANT` | `control.qhse.manage.tenant` | Gérer accidents, litiges, procédures QHSE |
| `ACCIDENT_REPORT_OWN` | `data.accident.report.own` | Déclarer/consulter ses propres accidents |

---

### 15.10 Navigation (`nav.config.ts`)

Sections et items ajoutés :

**Flotte → groupe `fleet-docs` :**
- Documents en alerte `/admin/fleet-docs` (`FLEET_MANAGE`)
- Consommables `/admin/fleet-docs/consumables` (`FLEET_MANAGE`)
- Configuration docs `/admin/fleet-docs/config` (`FLEET_MANAGE`)

**Personnel → groupe `drivers` (étendu) :**
- Permis & Habilitations `/admin/drivers/licenses` (`DRIVER_MANAGE`, `DRIVER_PROFILE`)
- Temps de repos `/admin/drivers/rest` (`DRIVER_MANAGE`)
- Formations `/admin/drivers/trainings` (`DRIVER_MANAGE`)
- Remédiation `/admin/drivers/remediation` (`DRIVER_MANAGE`)

**Personnel → groupe `crew` :**
- Planning équipages `/admin/crew/planning` (`CREW_MANAGE`)
- Briefings pré-départ `/admin/crew/briefing` (`CREW_MANAGE`)

**Section QHSE (nouvelle) :**
- Rapports d'accidents `/admin/qhse/accidents` (`QHSE_MANAGE`, `ACCIDENT_REPORT`)
- Litiges & Sinistres `/admin/qhse/disputes` (`QHSE_MANAGE`)
- Procédures QHSE `/admin/qhse/procedures` (`QHSE_MANAGE`)
- Configuration QHSE `/admin/qhse/config` (`QHSE_MANAGE`)

**Configuration (sprint orphans 2026-04-20) :**
- Taxes & Fiscalité `/admin/settings/taxes` (`TAX_READ`, `TAX_MANAGE`) — CRUD TenantTax
- Configuration paiement `/admin/settings/payment` (`SETTINGS_MANAGE`) — TTL intent, MoMo timeouts, webhooks (précédemment orpheline)

**Affichage & Gare (sprint orphans 2026-04-20) :**
- Annonces gare `/admin/display/announcements` (`ANNOUNCEMENT_MANAGE`, `ANNOUNCEMENT_READ`) — branchée au vrai composant `PageAnnouncements` (auparavant rendait un `PageWip` placeholder)

> **Contrat orphelins** : toute page ajoutée dans `frontend/components/pages/` doit dans
> la même PR (1) être importée en lazy dans `PageRouter.tsx`, (2) avoir un `case 'x':`
> retournant le composant, (3) une entrée nav dans `nav.config.ts` avec `href`, `icon`
> et `anyOf: [permissions]`. Un audit croisé a été rajouté à la check-list sprint
> pour détecter les composants créés mais non référencés.

---

### 15.11 Nouvelles Décisions Architecturales

| ADR | Décision | Raison |
|-----|----------|--------|
| ADR-28 | `SchedulingGuardModule` partagé | Single Responsibility — logique d'assignabilité centralisée, réutilisable par Trip, Crew, tout futur scheduler |
| ADR-29 | `ModuleGuard` global APP_GUARD | SaaS modularité — modules désactivables sans modifier le code métier ; isolation via décorateur déclaratif |
| ADR-30 | `@RequireModule` décorateur classe | Module désactivé = 403 complet sur tous les endpoints ; pas de logique conditionnelle dans les services |
| ADR-31 | Cache module Redis TTL 300s | Modules rarement modifiés — TTL long évite les DB hits à chaque requête ; `invalidateModuleCache()` assure la cohérence sur changement |
| ADR-32 | `allEquipmentOk` calculé côté serveur | Intégrité des données — le client ne peut pas forcer allEquipmentOk=true ; calculé depuis les types configurés en DB |
| ADR-33 | `evaluateRemediationForDriver` anti-doublon | Idempotence — score peut être réévalué plusieurs fois sans créer plusieurs actions pour la même règle ; vérification `PENDING/IN_PROGRESS` avant `create` |

---

## 16. Frontend Infrastructure — v6.0

### 16.1 Vue d'ensemble

Sprint 1 (Workflow Studio) et Sprint 2 (Admin Panel réel) ajoutent :
- `PageWorkflowStudio` : sélecteur d'entité + `WorkflowDesigner` (React Flow)
- Couche API centralisée : `apiFetch` + raccourcis + gestion 401
- Hook `useFetch<T>` : loading/error/data/refetch avec anti-race-condition
- Auth context + `LoginPage` + `ProtectedRoute`
- Pages connectées API : `PageProfitability` (GET /analytics/profitability) + `PageBranding` (GET/PUT /brand)

### 16.2 Workflow Studio (`frontend/components/pages/PageWorkflowStudio.tsx`)

Sélecteur de type d'entité (tabs ARIA `role="tablist"`).
Entités disponibles : **Ticket | Trip | Parcel | Bus**.
Délègue entièrement au `WorkflowDesigner` (ReactFlow + SimulationPanel + BlueprintPanel intégrés).
`DEMO_TENANT_ID` jusqu'à intégration auth complète.

```tsx
<WorkflowDesigner tenantId={tenantId} entityType={selectedType} />
```

### 16.3 Client API centralisé (`frontend/lib/api.ts`)

```typescript
// Point d'entrée unique
apiFetch<T>(path, opts?) → Promise<T>

// Raccourcis
apiGet / apiPost / apiPut / apiPatch / apiDelete

// Comportement 401
window.location.href = '/login';   // redirect automatique
```

Session-cookie : `credentials: 'include'` sur toutes les requêtes.
`ApiError` : status + body pour les composants.

### 16.4 Hook `useFetch<T>` (`frontend/lib/hooks/useFetch.ts`)

```typescript
const { data, loading, error, refetch } = useFetch<T>(url, deps?)
```

- Anti race-condition : `versionRef` — ignore les réponses obsolètes
- `url: null` → ne déclenche pas de requête (utile avant que le tenantId soit connu)
- `refetch()` : re-fetch manuel (ex: après mutation)

### 16.5 Auth (`frontend/lib/auth/auth.context.tsx`)

```typescript
const { user, loading, login, logout } = useAuth();
```

- `AuthProvider` : vérifie `GET /api/auth/me` au montage
- `login(email, password)` : POST /api/auth/sign-in → cookie session
- `logout()` : POST /api/auth/sign-out → `window.location.href = '/login'`

### 16.6 Route protection (`frontend/components/auth/`)

```tsx
<AuthProvider>
  <ProtectedRoute>
    <AdminDashboard />
  </ProtectedRoute>
</AuthProvider>
```

`ProtectedRoute` : loading → spinner / no user → `<LoginPage />` / user → children.

### 16.7 Pages connectées

| Page | Fichier | Endpoints |
|------|---------|-----------|
| Rentabilité | `PageProfitability.tsx` | GET /api/v1/tenants/:tid/analytics/profitability |
| White-label | `PageBranding.tsx` | GET/PUT /api/v1/tenants/:tid/brand |

Remplacent les `PageWip` stubs pour `pricing-yield` et `white-label`.

### 16.8 Nouvelles Décisions Architecturales

| ADR | Titre | Décision |
|-----|-------|----------|
| ADR-34 | `apiFetch` avec redirect 401 | Session-cookie + redirect automatique /login sur 401 — pas de refresh token JWT (Better Auth gère la session) |
| ADR-35 | `versionRef` anti-race dans `useFetch` | Compteur d'appels — ignore les réponses si une version plus récente est en cours |
| ADR-36 | `PageWorkflowStudio` entity-type tabs | ARIA `role="tablist/tab/tabpanel"` — sélecteur accessible sans router |

---

## 17. Portail Plateforme SaaS — v7.0 (2026-04-18)

> Complète l'architecture IAM Transverse du PRD section V.4 avec les modules
> backend et frontend livrés pour la gestion commerciale et opérationnelle
> du produit par l'équipe interne TransLog Pro.
>
> Référence complète : [`DOCUMENTATION_MULTI_TENANT.md`](./DOCUMENTATION_MULTI_TENANT.md)

### 17.1 Vue d'ensemble

Le tenant plateforme `__platform__` (UUID nil `00000000-0000-0000-0000-000000000000`)
héberge le staff interne qui :

- **Onboarde** les tenants clients et gère leur cycle de vie
- **Définit le catalogue** de plans SaaS (prix, cycle, modules inclus)
- **Facture** les tenants (souscriptions + factures mensuelles/annuelles)
- **Supervise** : growth (MRR, churn), adoption (DAU/MAU, modules), santé (score 0-100)
- **Supporte** : tickets escaladés par les tenants avec SLA par plan
- **Tune** les seuils opérationnels DB-driven (`PlatformConfig`) sans redéploiement
- **Enquête** via impersonation JIT (cf. §V.4.3 du PRD)

### 17.2 Modules backend ajoutés

```
src/modules/
├── platform/                # Bootstrap SA + CRUD staff (existant)
├── platform-plans/          # CRUD Plan + PlanModule + catalogue public [NEW]
├── platform-billing/        # PlatformSubscription + PlatformInvoice + cron [NEW]
├── platform-analytics/      # Growth/Adoption/Health + crons DAU/HealthScore [NEW]
├── platform-config/         # KV store DB-driven + cache + registry [NEW]
└── support/                 # SupportTicket + SupportMessage (tenant↔plateforme) [NEW]
```

### 17.3 Modèles Prisma ajoutés (8)

```prisma
model Plan {
  id, slug @unique, name, description,
  price, currency, billingCycle (MONTHLY|YEARLY|ONE_SHOT|CUSTOM),
  trialDays, limits (JSON), sla (JSON), sortOrder,
  isPublic, isActive
  modules PlanModule[]
}

model PlanModule { planId, moduleKey  @@unique([planId, moduleKey]) }

model PlatformSubscription {
  tenantId @unique, planId,
  status (TRIAL|ACTIVE|PAST_DUE|SUSPENDED|CANCELLED),
  startedAt, trialEndsAt,
  currentPeriodStart, currentPeriodEnd, renewsAt,
  cancelledAt, cancelReason, externalRefs (JSON)
}

model PlatformInvoice {
  invoiceNumber @unique,   // PF-YYYY-NNNNNN
  subscriptionId, tenantId,
  periodStart, periodEnd,
  subtotal, taxRate, taxAmount, totalAmount, currency,
  status (DRAFT|ISSUED|PAID|VOID|OVERDUE),
  issuedAt, dueAt, paidAt,
  paymentMethod, paymentRef, lineItems (JSON)
}

model SupportTicket {
  tenantId, reporterUserId,
  title, description,
  category (BUG|QUESTION|FEATURE_REQUEST|INCIDENT|BILLING|OTHER),
  priority (LOW|NORMAL|HIGH|CRITICAL),
  status (OPEN|IN_PROGRESS|WAITING_CUSTOMER|RESOLVED|CLOSED),
  assignedToPlatformUserId,
  firstResponseAt, resolvedAt, closedAt, slaDueAt
}

model SupportMessage {
  ticketId, authorId,
  authorScope (TENANT|PLATFORM),
  body, attachments (JSON),
  isInternal   // note interne non-visible au tenant
}

model DailyActiveUser {
  tenantId, userId, date @db.Date, sessionsCount
  @@unique([userId, date])
}

model TenantHealthScore {
  tenantId, date @db.Date, score (0-100),
  components (JSON)
  @@unique([tenantId, date])
}

model PlatformConfig {
  key @id, value (JSON),
  updatedBy, updatedAt, createdAt
}
```

Champs ajoutés sur modèles existants :
- `User.lastLoginAt`, `lastActiveAt`, `loginCount` — source DAU/MAU
- `Tenant.planId`, `activatedAt`, `suspendedAt`
- `InstalledModule.enabledAt`, `enabledBy`

### 17.4 Endpoints ajoutés

```
# Plans (SA)
GET    /platform/plans
POST   /platform/plans
PATCH  /platform/plans/:id
DELETE /platform/plans/:id                   # soft si tenants rattachés, hard sinon
POST   /platform/plans/:id/modules           # attach module
DELETE /platform/plans/:id/modules/:moduleKey
GET    /platform/plans/catalog               # public aux tenants (perm data.tenant.plan.read.tenant)

# Billing (SA)
GET    /platform/billing/subscriptions
POST   /platform/billing/subscriptions
PATCH  /platform/billing/subscriptions/:id/plan
PATCH  /platform/billing/subscriptions/:id/status
GET    /platform/billing/invoices?tenantId=&status=
POST   /platform/billing/invoices
POST   /platform/billing/invoices/:id/issue
POST   /platform/billing/invoices/:id/mark-paid
POST   /platform/billing/invoices/:id/void

# Analytics (SA/L1/L2)
GET    /platform/analytics/growth
GET    /platform/analytics/adoption
GET    /platform/analytics/health
GET    /platform/analytics/tenant/:id

# Support tenant
POST   /support/tickets
GET    /support/tickets
GET    /support/tickets/:id
POST   /support/tickets/:id/messages

# Support plateforme
GET    /platform/support/tickets?status=&priority=&tenantId=&assignee=
GET    /platform/support/tickets/:id
PATCH  /platform/support/tickets/:id
POST   /platform/support/tickets/:id/messages

# Config (SA)
GET    /platform/config
PATCH  /platform/config
DELETE /platform/config/:key
```

### 17.5 Permissions ajoutées (9)

| Permission | SA | L1 | L2 | TENANT_ADMIN | Autres tenant |
|---|:-:|:-:|:-:|:-:|:-:|
| `control.platform.plans.manage.global` | ✓ | | | | |
| `control.platform.billing.manage.global` | ✓ | | | | |
| `data.platform.metrics.read.global` | ✓ | ✓ | ✓ | | |
| `control.platform.support.read.global` | ✓ | ✓ | ✓ | | |
| `control.platform.support.write.global` | ✓ | ✓ | ✓ | | |
| `control.platform.config.manage.global` | ✓ | | | | |
| `data.support.create.tenant` | | | | ✓ | ✓ |
| `data.support.read.tenant` | | | | ✓ | (AGENCY_MGR) |
| `data.tenant.plan.read.tenant` / `control.tenant.plan.change.tenant` | | | | ✓ | |

### 17.6 Crons ajoutés

| Nom | Cron | Service | Rôle |
|---|---|---|---|
| `runDailyActiveUsersJob` | `0 2 * * *` | `PlatformAnalyticsService` | Agrège `User.lastActiveAt` dans `DailyActiveUser` pour J-1 |
| `runTenantHealthScoreJob` | `30 2 * * *` | `PlatformAnalyticsService` | Calcule score santé 0-100 par tenant (poids: uptime 40% + support 20% + DLQ 20% + engagement 20%) |
| `runRenewalBatch` | `0 3 * * *` | `PlatformBillingService` | Génère factures DRAFT pour subscriptions arrivant à échéance + avance la période |

### 17.7 Frontend — `TenantScopeProvider`

Contexte React permettant au staff plateforme de scoper les pages tenant-scoped
(Trips, Fleet, Cashier, Incidents…) sur un tenant spécifique **sans impersonation**.

```tsx
// Usage dans une page tenant-scoped
import { useScopedTenantId } from '@/lib/platform-scope/TenantScopeProvider';
import { NoTenantScope } from '@/components/platform/TenantScopeSelector';

function PageTrips() {
  const tenantId = useScopedTenantId();
  if (!tenantId) return <NoTenantScope pageName="Trips" />;
  const { data } = useFetch(`/api/tenants/${tenantId}/trips`);
  // ...
}
```

- Pour un user tenant client : `useScopedTenantId()` retourne toujours `user.tenantId`
- Pour un SA : retourne le tenant sélectionné dans le bandeau sticky (ou `null`)
- Persistance `sessionStorage`

### 17.8 Frontend — Extensions

- `HomeRedirect` (`frontend/src/main.tsx`) : SA atterrit directement sur `/admin/platform/dashboard` au login.
- Bannière UX sur `PageIamUsers` et `PageIamRoles` qui oriente vers `/admin/platform/staff` quand le user est sur le tenant plateforme (pas de cache, juste orientation).
- 8 nouvelles pages sous `/admin/platform/*` + 1 côté tenant (`/admin/support`).

### 17.9 Configuration DB-driven (`PlatformConfig`)

Clefs initiales supportées (registre dans `platform-config.registry.ts`) :

| Clé | Type | Défaut | Bornes | Usage |
|---|---|---|---|---|
| `health.riskThreshold` | number | 60 | 0-100 | Seuil "tenant à risque" dans le dashboard |
| `health.thresholds.incidents` | number | 10 | 1-1000 | Nb d'incidents → uptime = 0 dans le score |
| `health.thresholds.tickets` | number | 5 | 1-1000 | Seuil tickets support |
| `health.thresholds.dlqEvents` | number | 5 | 1-1000 | Seuil DLQ |
| `billing.defaultInvoiceDueDays` | number | 7 | 0-365 | Délai échéance facture |
| `billing.defaultCustomCycleDays` | number | 30 | 1-3650 | Durée cycle plan CUSTOM |

Pattern d'ajout d'une clé :
1. Entrée dans `PLATFORM_CONFIG_REGISTRY` (label, help, default, validate)
2. Consommer via `config.getNumber('ma.cle').catch(() => DEFAULT)` — **ADR-43**
3. L'UI `/admin/platform/settings` l'affiche automatiquement (form auto-généré)

### 17.10 Nouvelles ADR (v7.0)

| ADR | Titre | Décision |
|---|---|---|
| ADR-37 | Plans SaaS DB-driven | `Plan` + `PlanModule` — zéro hardcoding. Le SA crée/édite via UI. |
| ADR-38 | Billing plateforme séparé de `Invoice` tenant | Modèles distincts pour séparer facturation SaaS (plateforme→tenant) de facturation client final (tenant→voyageur). |
| ADR-39 | SLA capping par plan + fallback const | `plan.sla.maxPriority` + `plan.sla.firstResponseMinByPriority` ; `DEFAULT_SLA_MINUTES` filet de sécurité. |
| ADR-40 | `PlatformConfig` KV store DB-driven | Seuils éditables sans redéploiement, cache in-memory 60s, fallback const si DB KO. |
| ADR-41 | `TenantScopeProvider` plutôt que cacher la nav | Restructuration UX propre : items restent visibles, scope tenant choisi explicitement. |
| ADR-42 | `lastActiveAt` throttlé 5 min dans SessionMiddleware | 1 update max / 5 min / user → DAU/MAU sans overhead. |
| ADR-43 | Fallback const obligatoire sur chaque `PlatformConfigService.getNumber()` | Zéro panique si DB KO — services continuent de fonctionner. |
| ADR-44 | Health score calculé en cron nocturne | Lecture O(1) depuis `TenantHealthScore` au lieu de calcul on-the-fly. |
| ADR-45 | Playwright `--host-resolver-rules` plutôt que /etc/hosts | Tests E2E sans sudo — mapping dynamique `*.translog.test` → 127.0.0.1. |

### 17.11 Stratégie de tests actualisée

| Type | Tests portail plateforme | Total projet |
|---|---|---|
| **Unit** (`jest.unit.config.ts`) | 56 | 56+ (platform) + existants |
| **Security** (`jest.security.config.ts`) | 13 nouveaux | **132** ✓ |
| **E2E API** (`jest.e2e.config.ts`) | 20 nouveaux | **149** (144 pass + 5 failures pré-existantes app.e2e) |
| **Playwright navigateur** (`playwright.config.ts`) | 37 | **37** ✓ |

Conventions Playwright :
- `*.sa.pw.spec.ts` → project `super-admin` (storageState pré-chargé)
- `*.tenant.pw.spec.ts` → project `tenant-admin`
- `*.public.pw.spec.ts` → project `public` (non-auth)
- `*.api.spec.ts` → project `api` (HTTP direct, pré-existant)

Pré-requis : `./scripts/dev.sh` up + `npx playwright install chromium`.

---

## 18. Self-service compte + MFA wire — v8.0 (2026-04-19)

### 18.1 Vue d'ensemble

Livré en une passe :

- **PageAccount** (`frontend/components/pages/PageAccount.tsx`) — 3 onglets
  Profil / Sécurité / Préférences accessibles à tous les rôles authentifiés.
- **`AuthService.changePassword` + `updateMyPreferences`** — self-service backend
  sans dépendre de `PasswordResetService` (pas de token).
- **`AuthService.signIn` câblé MFA** — branche `SignInResult.kind = 'mfaChallenge'`
  quand `user.mfaEnabled` ; le scaffold `MfaChallenge` existant est enfin utilisé.
- **`POST /platform/iam/users/:userId/reset-password`** — reset cross-tenant
  (modes `link` / `set`) via nouvelle méthode `initiateByPlatformAdmin` dans
  `PasswordResetService`.
- **UX plateforme** — Plans onRowClick, Tenants UUID copiable, NewSub combobox
  tenant avec auto-chargement du plan courant.

### 18.2 `SignInResult` — type discriminé pour la réponse de signIn

```ts
// src/modules/auth/auth.service.ts
export type SignInResult =
  | { kind: 'session';      token:          string; user:      AuthUserDto }
  | { kind: 'mfaChallenge'; challengeToken: string; expiresAt: Date };
```

Le `AuthController.signIn` dispatche sur `kind` :

- `'session'` → cookie `translog_session` (30j) + retour `AuthUserDto`
- `'mfaChallenge'` → cookie `translog_mfa_challenge` (5 min) + retour `{ mfaRequired: true, expiresAt }`

Le frontend `auth.context.tsx` projette la réponse dans un `LoginResult` également
discriminé pour que `LoginPage` puisse basculer sur l'écran code à 6 chiffres.

### 18.3 Flow MFA complet (séquence)

```
Client                  AuthController               AuthService               DB
  |                          |                           |                      |
  | POST /auth/sign-in       |                           |                      |
  |------------------------->|                           |                      |
  |                          | signIn(email, pwd)        |                      |
  |                          |-------------------------->|                      |
  |                          |                           | bcrypt compare       |
  |                          |                           | if user.mfaEnabled:  |
  |                          |                           |   issueMfaChallenge  |
  |                          |                           |--------------------->|
  |                          |                           |                      |
  |                          |<--{ kind:'mfaChallenge' } |                      |
  |                          | Set-Cookie: translog_mfa_challenge               |
  |<--{ mfaRequired: true }--|                           |                      |
  |                          |                           |                      |
  | POST /auth/mfa/verify    |                           |                      |
  | Cookie: translog_mfa...  |                           |                      |
  |------------------------->|                           |                      |
  |                          | verifyMfa(token, code)    |                      |
  |                          |-------------------------->|                      |
  |                          |                           | TOTP verify          |
  |                          |                           | create Session       |
  |                          |<--{ token, user }         |                      |
  |<--AuthUserDto, Set-Cookie: translog_session          |                      |
```

Invariants :
- Le cookie MFA (`translog_mfa_challenge`) est distinct du cookie session —
  `/auth/me` ne le lit jamais, donc aucun accès API pré-verify possible.
- `expectedTenantId` passé de `verifyMfa` côté controller (Host header) pour
  rejeter un challenge issu sur tenantA finalisé sur tenantB.
- 5 tentatives max par challenge (`MFA_MAX_ATTEMPTS`), TTL 5 min, IP binding.

### 18.4 `AuthUserDto` — champs ajoutés

```ts
interface AuthUserDto {
  // ...existants...
  locale:             string | null;   // depuis User.preferences
  timezone:           string | null;   // depuis User.preferences
  mfaEnabled:         boolean;         // depuis User.mfaEnabled
  mustChangePassword: boolean;         // depuis Account.forcePasswordChange
}
```

Remplissage dans `toDto` :
- `locale` et `timezone` lus dans `User.preferences` JSON — zéro nouvelle colonne.
- `mustChangePassword` lu dans `Account.forcePasswordChange` (colonne existante
  utilisée par le flow reset-password admin).
- `mfaEnabled` déjà dans le modèle `User`.

### 18.5 Cross-tenant password reset — méthode partagée privée

```ts
// src/modules/password-reset/password-reset.service.ts
async initiateByPlatformAdmin(params) {
  // self-check + resolve target.tenantId
  return this.initiateByAdminCrossTenant({ ...params, targetUserTenantId });
}

async initiateByAdmin(params) {
  // check actor.tenantId === target.tenantId
  return this.initiateByAdminCrossTenant({ ...params, targetUserTenantId: actorTenantId });
}

private async initiateByAdminCrossTenant(params) { /* logique partagée */ }
```

Rationale : la logique métier (génération de token sha256, purge sessions en
mode 'set', audit) est strictement identique — seul le check tenant change
selon la permission en amont (`USER_RESET_PASSWORD_TENANT` vs
`PLATFORM_USER_RESET_PWD_GLOBAL`). Le `PermissionGuard` HTTP fait autorité.

### 18.6 Route `/account` dans `main.tsx`

```tsx
<Route
  path="/account"
  element={
    <ProtectedRoute>
      <PageAccount />
    </ProtectedRoute>
  }
/>
```

Accessible pour TOUS les `userType` — pas de permission supplémentaire. La
`ProtectedRoute` vérifie uniquement la présence d'une session. Icône
`UserCircle2` dans la topbar `AdminDashboard` ; les autres dashboards
(customer/driver/agent/quai) pointent aussi sur `/account` via le lien
href simple (route top-level).

### 18.7 Nouvelles permissions

| Permission | Accordée à | Description |
|---|---|---|
| `control.platform.user.reset-password.global` | SUPER_ADMIN, SUPPORT_L2 | Reset mot de passe cross-tenant (modes link/set) |

Ajoutée dans `src/common/constants/permissions.ts` et seedée dans
`prisma/seeds/iam.seed.ts`. Relancer le seed après déploiement :
`npx ts-node prisma/seeds/iam.seed.ts`.

### 18.8 Nouvelles ADR (v8.0)

| ADR | Titre | Décision |
|---|---|---|
| **ADR-46** | Préférences user dans `User.preferences` JSON | Zéro migration, merge partiel, préservation des clés non-i18n. |
| **ADR-47** | `SignInResult` discriminée | Typage fort du retour de `signIn` ; le controller dispatche sur `kind` pour poser le bon cookie. |
| **ADR-48** | Reset cross-tenant = méthode privée partagée | `initiateByAdminCrossTenant` factorisée ; le check tenant reste côté caller public. |
| **ADR-49** | i18n fallback automatique vers `fr.ts` | Les 6 locales non-master (wo, ln, ktu, ar, pt, es) peuvent omettre des clés sans crasher. Permet des livraisons rapides sans passage traduction. |
| **ADR-50** | Migration hardcoded → `WorkflowEngine` full enforcement | 7 modules migrés (flight-deck Trip, shipment Parcel, invoice, staff + staffAssignment cascade, support, driver-profile, qhse). Toute transition d'état métier passe par l'engine (ADR-15/16 enforcement). Zéro `prisma.update({ status })` direct autorisé sur un état blueprint-driven. |
| **ADR-51** | Paliers de pénalité JSON N-tiers (annulation) | Remplacement du legacy 2-tiers par `TenantBusinessConfig.cancellationPenaltyTiers` (JSON `[{hoursBeforeDeparture, penaltyPct}]`). Priorité résolution : `Trip.cancellationPenaltyTiersOverride` > tenant JSON > legacy 2-tiers. Fallback legacy conservé pour rétro-compat. |
| **ADR-52** | `cancellationPenaltyAppliesTo` JSON acteurs | Liste `['CUSTOMER','AGENT','ADMIN','SYSTEM']` — si l'acteur n'est pas inclus, pénalité forcée à 0 %. Évite qu'un admin contourne silencieusement par oubli. `SYSTEM` reste hors pénalité par défaut (auto-cron). Perm `control.refund.waive_penalty.tenant` permet une dispense explicite tracée en audit. |
| **ADR-53** | No-show + TTL ticket configurables | `noShowGraceMinutes` (délai après départ avant marquage NO_SHOW) + `ticketTtlHours` (forfait automatique via scheduler au-delà). `noShowPenaltyEnabled/Pct/FlatAmount` additionnent à la pénalité d'annulation (max entre les deux — pas de double-dip). Overrides Trip nullables pour cas VIP / spéciaux. |
| **ADR-54** | Compensation incident modulable par paliers délai | `TenantBusinessConfig.incidentCompensationDelayTiers` (JSON `[{delayMinutes, compensationPct, snackBundle?}]`) + forme `MONETARY`/`VOUCHER`/`MIXED`/`SNACK` + override `Trip.compensationPolicyOverride` + `Trip.compensationFormOverride`. MIXED = split 50/50 refund+voucher. Déclenchement par action `DECLARE_MAJOR_DELAY` ou `CANCEL_IN_TRANSIT`. |
| **ADR-55** | Nouveaux aggregateTypes dans la whitelist du moteur | `Invoice`, `Staff`, `StaffAssignment`, `SupportTicket`, `DriverTraining`, `QhseExecution`, `Voucher`, `CompensationItem` ajoutés à `AGGREGATE_TABLE_MAP` ([live-workflow.io.ts](src/core/workflow/io/live-workflow.io.ts)) pour le `SELECT FOR UPDATE NOWAIT`. Anti-injection SQL via `Prisma.raw()` whitelist préservée. |
| **ADR-56** | `Voucher` one-shot signé tenant-préfixé | Code unique format `<TNT>-XXXX-YYYY` (randomBytes 8 hex), collision-retry 5×. Validité fixée à l'émission (`validityStart`/`validityEnd`), immutable. Redeem valide scope (`ANY_TRIP`/`SAME_ROUTE`/`SAME_COMPANY`) + anti-transfert (customerId ou phone match). Expiration scheduler batch. |
| **ADR-57** | `CompensationItem` audit non-monétaire | Snacks/repas tracés hors paiement pour reporting coûts. Workflow simple `OFFERED → DELIVERED | DECLINED` avec signature/photo en proof (`proofType`/`proofValue`). Émis automatiquement par IncidentCompensationService quand `tier.snackBundle` présent, indépendamment de la forme monétaire. |
| **ADR-58** | Whitelist Prisma raw queries | Toutes les nouvelles tables (`vouchers`, `compensation_items`) et colonnes (`version` sur staff, invoice, etc.) ajoutées au schema + migrations via `prisma db push` (pas de `migrate dev` — le projet fonctionne sans migrations historisées en dev). |

### 18.9 Stratégie de tests actualisée (v8.0)

| Type | Tests ajoutés v8.0 | Total |
|---|---|---|
| **Unit auth** (`test/unit/auth/`) | 16 (change-pwd 6 + mfa-signin 2 + prefs 3 + platform-reset 5) | **33/33 PASS** |
| **Security** | 6 (`platform-reset-password.spec.ts` — S1-S7) | **138/138 PASS** |
| **E2E API Playwright** | 3 (`account-self-service.api.spec.ts`) | exécution live sur :3000 requise |
| **Integration Testcontainers** | 0 — reporté prochaine itération | — |

TypeScript `tsc --noEmit -p tsconfig.json` clean (hors erreurs pré-existantes
`mobile/` / `server/poc/` hors scope).

---

*Fin du Dossier Technique TransLog Pro v8.0*
*Révision v2.0 : Avril 2026 — Architecture Validée*
*Révision v3.0 : Avril 2026 — Intégration PRD-ADD (CRM, Safety, Crew, PublicReporter, IAM DB-driven, RGPD, PostGIS optionnel)*
*Révision v4.0 : Avril 2026 — White Label · Profitabilité (ICostCalculator) · TenantBusinessConfig · Yield Management · ADR-23→27*
*Révision v5.0 : Avril 2026 — FleetDocs · DriverProfile · CrewBriefing · QHSE · SchedulingGuard · ModuleGuard · Frontend QHSE/HR · ADR-28→33*
*Révision v6.0 : Avril 2026 — Workflow Studio Frontend · API client centralisé · useFetch hook · Auth context · PageProfitability/PageBranding connectées · ADR-34→36*
*Révision v7.0 : Avril 2026 — Portail Plateforme SaaS · Plans · Billing · Analytics · Support · Config DB-driven · TenantScopeProvider · Playwright E2E · ADR-37→45*
*Révision v8.0 : 2026-04-19 — Self-service compte (PageAccount) · MFA wire dans signIn (SignInResult discriminée) · Reset-password cross-tenant · UX corrections plateforme (Plans onRowClick, UUID tenants, NewSub combobox) · ADR-46→49*
*Révision v9.0 : 2026-04-19 (PM) — Workflow-driven full enforcement · 7 modules hardcoded → engine · Nouveaux scénarios : Parcel hub (9 actions), Ticket no-show/rebook/forfeit, Incident en route (suspend/cancel/major-delay), Voucher + CompensationItem · N-tiers JSON (cancellation + compensation) + appliesTo + trip overrides + waive · UI web admin (Settings rules, Vouchers, TicketIncidentDialog, TripIncidentDialog, ParcelHubActionsDialog) · Portail voyageur (Mes bons + self-service rebook/refund) · Mobile driver (SUSPEND + DECLARE_MAJOR_DELAY) · Mobile quai (QuaiParcelActionsScreen) · ADR-50→58 · 583/583 unit tests PASS*
