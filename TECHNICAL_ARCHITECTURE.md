# TransLog Pro — Architecture Technique Complète
**Dossier Technique de Référence v2.0**

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
│   │   │   └── permission.types.ts  # PermissionString type + enums
│   │   ├── decorators/
│   │   │   └── permission.decorator.ts
│   │   ├── guards/
│   │   │   └── permission.guard.ts  # Guard global NestJS
│   │   ├── middleware/
│   │   │   └── tenant.middleware.ts
│   │   ├── services/
│   │   │   └── rbac.service.ts
│   │   └── iam.module.ts
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
│   └── analytics/
│       ├── analytics.controller.ts
│       ├── analytics.service.ts
│       └── analytics.module.ts
│
└── common/
    ├── constants/
    │   ├── workflow-states.ts       # Enums d'états par entité
    │   └── permissions.ts           # Toutes les permissions string
    ├── types/
    │   ├── domain-event.type.ts     # DomainEvent interface
    │   └── api-response.type.ts     # Response envelopes
    ├── decorators/
    │   ├── tenant-id.decorator.ts   # @TenantId() param decorator
    │   └── current-user.decorator.ts # @CurrentUser()
    ├── filters/
    │   └── http-exception.filter.ts # RFC 7807
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
| Staff | Profil personnel | id, userId, role, totalDriveTimeToday |
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

### 8.5 mTLS Inter-Services

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

*Fin du Dossier Technique TransLog Pro v2.0*
*Révision : Avril 2026 — Architecture Validée*
