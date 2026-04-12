# TransLog Pro — Product Requirements Document v2.0
**Édition Industrielle Révisée**

| Champ | Valeur |
|---|---|
| Version | 3.0 — Post-PRD-ADD Integration |
| Statut | Document de Référence (Single Source of Truth) |
| Objectif | Digitaliser l'intégralité de la chaîne de valeur du transport de passagers et de colis |
| Stack | NestJS · PostgreSQL RLS · Prisma · React Native · Next.js · Redis · MinIO · HashiCorp Vault |
| Modèle | SaaS Multi-Tenant (Architecture Hexagonale, Provider-Agnostic, Event-Driven) |
| Révisions v2.0 | WorkflowConfig formalisée · Schéma Prisma corrigé · Sécurité renforcée · Modules manquants ajoutés |
| Révisions v3.0 | IAM DB-driven (zéro hardcode) · Modules CRM/Safety/Crew/PublicReporter · RGPD · Voyageur=User · BaseEvent TripEvent/Incident · PostGIS optionnel |

---

## I. Vision & Acteurs

### I.1 Vision du Produit

TransLog Pro est une plateforme SaaS multi-tenant qui digitalise l'intégralité de la chaîne de valeur du transport de passagers et de colis. Elle couvre la réservation, la billetterie, la messagerie (colis), la gestion de flotte, la gestion du personnel, la caisse terrain, l'affichage dynamique en gare et sur bus, ainsi que le suivi GPS en temps réel.

Le système repose sur un **Unified Workflow Engine (UWE)** configurable permettant à chaque transporteur de définir ses propres règles de transition d'état. L'abstraction maximale est implémentée pour l'accès au stockage, aux secrets et à l'event bus via des interfaces — afin de permettre la permutation de fournisseurs sans toucher le code métier.

**Principe fondamental :** L'état d'aucune entité métier n'est jamais modifié directement. Toute mutation passe par le Workflow Engine. Les modules ne se parlent pas — ils réagissent à des événements.

### I.2 Profils Utilisateurs

| Acteur | Application | Interactions Clés |
|---|---|---|
| Voyageur | Web / Mobile App | Recherche trajet, Réservation, Paiement Mobile Money, Tracking temps réel, Notation post-trip, Signalement conduite |
| Agent de Gare | Tablette / Desktop | Vente comptoir, Caisse, Check-in (Scan QR), Enregistrement colis |
| Agent de Quai | Mobile (Scanner) | Chargement bus, Validation manifest, Scan colis arrivée, SAV |
| Chauffeur | App Mobile | Roadbook, Checklists, Incidents, Pauses, SOS, Journal d'équipage |
| Mécanicien | App Garage | Alertes pannes, Rapports intervention, Remise en service |
| Planificateur | Admin Web | Lignes, Routes, Affectation Flotte/Personnel, Yield Management, Affectation équipage |
| Administrateur Tenant | Admin Web | Workflow config, Audit financier, Permissions, Tarifs, CRM, Campagnes |
| Super-Admin | Control Plane | Onboarding tenants, Monitoring infra, Override workflows |
| Citoyen (anonyme) | Portail Public Web | Signalement de véhicule (immatriculation/numéro de parc) sans compte requis |

> **Règle User.userType :** Un `User` peut être soit un `VOYAGEUR` (passager) soit un `STAFF` (employé). Il n'existe pas d'entité `Customer` séparée. Le discriminateur `User.userType: VOYAGEUR | STAFF | ANONYMOUS` détermine les permissions disponibles et le contexte de session. Un non-voyageur peut accéder au portail public sans compte.

### I.3 Modules Fonctionnels

| Code | Module | Description |
|---|---|---|
| A | Billetterie & Passagers | Réservation multi-canal, QR, cycle de vie complet, bagages |
| B | Messagerie Colis | Parcel → Shipment → Trip, tracking scan-by-scan |
| C | Flotte & Personnel | Inventaire bus, plan de salle, affectation, disponibilité |
| D | Finance & Caisse | Paiements, sessions de caisse, audit immuable |
| E | Digital Signage | Écrans gare et bus, push WebSocket exclusif |
| F | Flight Deck | Checklists aviation, Roadbook, SOS, routage incidents |
| G | Garage & Maintenance | Alertes mécaniques, rapports, remise en service |
| H | SAV & Lost & Found | Objets trouvés, réclamations, remise signée |
| I | Analytics & BI | KPI temps réel, dashboards financiers et opérationnels |
| J | Manifeste 3.0 | Vue temps réel bus : voyageurs + colis + sièges + dropoff |
| K | Pricing & Yield | Calcul dynamique, yield activable par tenant |
| L | Notifications | SMS/WhatsApp/Push avec préférences par utilisateur |
| M | Scheduler | Récurrence des trajets, templates horaires |
| N | Quota Manager | Limites de ressources par tenant |
| O | Onboarding Orchestrator | Provisioning atomique des nouveaux tenants |
| P | Dead Letter Queue | Monitoring et replay des événements échoués |
| Q | CRM & Expérience Voyageur | Profil enrichi voyageur, réclamations, campagnes marketing |
| R | Safety & Feedback | Signalement conduite dangereuse, notation agrégée, alertes safety temps réel |
| S | Smart Bus Display | Jauge progression, ETA, météo destination, QR signalement à bord |
| T | Crew Operations | Affectation équipage, pre-trip meeting, checklist collaborative |
| U | Public Reporter | Portail public signalement citoyen sans compte, validation géo-temporelle |
| V | Analytics & BI Exécutif | Rentabilité par ligne, KPIs ponctualité, classement chauffeurs/agences |

---

## II. Architecture SaaS & Multi-Tenancy

### II.1 Stack Technologique

| Couche | Technologie | Rôle |
|---|---|---|
| Backend | NestJS (Modular Monolith) | Prêt pour migration microservices |
| Frontend Web | Next.js | Admin Panel, Portails Clients |
| Mobile | React Native | Apps Agents, Chauffeurs, Clients |
| Base de Données | PostgreSQL 16 + PostGIS | Multi-tenant RLS RESTRICTIVE |
| ORM | Prisma | Typage fort, migrations |
| Auth | Better Auth | Sessions httpOnly + JWT API |
| Temps Réel | Socket.io + Redis Adapter | WebSockets scalables horizontalement |
| Event Bus | Transactional Outbox (PostgreSQL) + Redis Pub/Sub | At-least-once delivery, portable |
| Secrets & PKI | HashiCorp Vault HA (Raft 3 nœuds) | Rotation secrets, certificats mTLS |
| Storage | MinIO (IStorageService) | S3-compatible, URLs signées avec TTL typés |
| Cache | Redis 7 | Cache L2, GPS buffer, Pub/Sub WS |
| Infra | Docker + Kubernetes | Orchestration |
| Notifications | Twilio / WhatsApp Business API | SMS et notifications push |
| Paiement | Flutterwave / Paystack | Mobile Money multi-devise |
| GPS / Geo | PostGIS | Coordonnées stations |
| APM | OpenTelemetry + Prometheus | Traces et métriques |

### II.2 Architecture Hexagonale & Provider Pattern

**Règle absolue :** Aucun import direct d'un SDK tiers dans le code métier. Toujours passer par une interface.

```
ISecretService    → HashiCorp Vault    (permutable : Azure Key Vault, AWS Secrets Manager)
IStorageService   → MinIO              (permutable : Azure Blob, AWS S3)
IEventBus         → Outbox + Redis     (permutable : NATS, Kafka, RabbitMQ)
IIdentityManager  → Better Auth        (permutable : Keycloak, Okta, Entra ID/SCIM)
```

**Règle de codage absolue :** Ne jamais utiliser `process.env`. Toujours appeler `secretService.getSecret(path, key)`. La seule variable d'environnement autorisée dans les Dockerfiles est `VAULT_ADDR`.

**Règle zéro-hardcode IAM :** Les rôles, permissions et mappings rôle↔permission ne sont **jamais** définis en dur dans le code TypeScript. Les constantes de permission (`P_TICKET_SCAN_AGENCY`) sont des références compile-time uniquement. La source de vérité runtime est la DB (`Role`, `RolePermission`). Un fichier seed (`prisma/seeds/iam.seed.ts`) initialise les rôles et permissions par défaut lors de chaque nouveau provisioning de tenant via l'Onboarding Orchestrator.

**PostGIS — optionnel :** Les coordonnées géographiques (`Station.coordinates`, `Waypoint.gpsZone`) utilisent PostGIS si activé. En l'absence de PostGIS (tests, dev), l'autocomplete sur les noms de stations/villes remplace la recherche spatiale : la saisie partielle ("Doua...") filtre les stations par `ILIKE '%doua%'` sur le champ `Station.name`. `ST_Distance` est utilisé pour la validation géo-temporelle du Public Reporter mais avec un fallback sur le calcul haversine côté applicatif si PostGIS indisponible.

### II.3 Multi-Tenancy & RLS

Chaque table critique possède une colonne `tenant_id`. L'isolation est garantie à trois niveaux :

1. **Niveau DB :** Politique RLS PostgreSQL **RESTRICTIVE** — si `app.tenant_id` n'est pas défini, zéro lignes retournées (jamais toutes les lignes)
2. **Niveau Applicatif :** Middleware NestJS extrait le `tenantId` de la **session Better Auth uniquement**. Le header `x-tenant-id` est ignoré pour les routes authentifiées.
3. **Niveau mTLS :** Certificats Vault PKI pour les communications inter-services

**Règle absolue :** Le `tenantId` est toujours extrait de la session. Pour les endpoints publics (écrans display), il est extrait du path param et validé — jamais depuis un header forgeable.

**PgBouncer :** Mode **SESSION** obligatoire (pas transaction pooling) pour préserver `SET LOCAL app.tenant_id` entre les requêtes.

### II.4 Event System — Transactional Outbox

Remplacement de NATS par une architecture portable en deux couches :

1. **PostgreSQL Outbox** (`OutboxEvent` table) — événements écrits atomiquement avec la mutation DB dans la même transaction. Un `OutboxPoller` lit les événements PENDING et les délivre. DLQ pour les échecs persistants.
2. **Redis Pub/Sub** — fan-out temps réel vers les WebSocket Gateways uniquement.

Cette architecture garantit :
- At-least-once delivery avec idempotence (table `WorkflowTransition`)
- Atomicité mutation + événement (même transaction DB)
- Zéro service supplémentaire (PostgreSQL + Redis déjà dans le stack)
- Portabilité totale (NATS/Kafka peuvent être pluggés via `IEventBus`)

---

## III. Unified Workflow Engine (UWE)

### III.1 Philosophie

L'UWE est **stateless**. Il lit la configuration depuis la DB, évalue les conditions, et exécute les transitions. Le code métier ne connaît pas les états — il ne connaît que le moteur via l'interface `IWorkflowEntity`.

Structure d'une transition :
```
State (Passif) + Action (Verbe) + Guards (Conditions JSON) + Permission → New State + AuditLog + OutboxEvent + SideEffects
```

### III.2 Table WorkflowConfig (Modèle Formalisé)

```prisma
model WorkflowConfig {
  id            String   @id @default(cuid())
  tenantId      String
  entityType    String   // TICKET | PARCEL | TRIP | BUS | TRAVELER | SHIPMENT
  fromState     String   // état source
  action        String   // verbe de transition
  toState       String   // état cible
  requiredPerm  String   // permission string exacte
  guards        Json     @default("[]")      // GuardDefinition[]
  sideEffects   Json     @default("[]")      // SideEffectDefinition[]
  version       Int      @default(1)
  effectiveFrom DateTime @default(now())
  isActive      Boolean  @default(true)
  tenant        Tenant   @relation(...)

  @@unique([tenantId, entityType, fromState, action, version])
  @@index([tenantId, entityType, isActive])
}
```

**Règle de versioning :** Quand un admin modifie un WorkflowConfig, la version précédente est désactivée (`isActive = false`) et une nouvelle version est créée avec `effectiveFrom = NOW()`. Les entités in-flight utilisent la config active au moment de leur transition, pas au moment de leur création.

### III.3 Algorithme d'Exécution (Séquentiel)

```
1. IDEMPOTENCE    → Vérifier WorkflowTransition par idempotencyKey → 409 si existe
2. LOCK           → SELECT FOR UPDATE NOWAIT sur l'entité → 423 si lock tenu
3. CONFIG         → Lire WorkflowConfig(tenantId, entityType, fromState, action) active
4. PERMISSION     → PermissionGuard.assert(userId, config.requiredPerm, tenantId)
5. GUARDS         → GuardEvaluator.evaluateAll(config.guards, entity, context)
6. TRANSACTION    → db.$transaction([
                      updateEntityState(toState, version+1),
                      createWorkflowTransition(idempotencyKey),
                      createAuditLog(delta JSON),
                      createOutboxEvent(eventType, payload)
                    ])
7. SIDE EFFECTS   → SideEffectDispatcher (sync: critique, async: via Outbox)
```

### III.4 Guard Definitions

```typescript
type GuardDefinition = {
  type: 'ENTITY_STATE' | 'CAPACITY' | 'FIELD_MATCH' | 'CHECKLIST_COMPLIANT' | 'RATE_LIMIT'
  entity?: string         // entité liée à vérifier (ex: "Trip")
  field?: string          // champ à évaluer (ex: "status")
  operator?: '==' | '>=' | '<=' | '!='
  value?: unknown         // valeur attendue
  refField?: string       // pour FIELD_MATCH : champ de l'entité source
  errorCode: string
  errorMessage: string
}
```

### III.5 Side Effect Definitions

```typescript
type SideEffectDefinition = {
  type: 'PUBLISH_EVENT' | 'TRIGGER_WORKFLOW' | 'UPDATE_RELATED' | 'NOTIFY'
  async: boolean          // true = via Outbox poller, false = synchrone critique
  event?: string          // nom de l'événement
  relatedEntity?: string
  relatedAction?: string
  notificationType?: 'SMS' | 'WHATSAPP' | 'PUSH'
  recipientField?: string // chemin JSON vers le destinataire (ex: "parcel.recipientInfo.phone")
  templateKey?: string
}
```

### III.6 Audit Trail ISO 27001

Chaque transition génère un `AuditLog` immuable :

```
plane        : "control" | "data"
level        : "info" | "warn" | "critical"
action       : permission exercée (ex: "data.ticket.board.agency")
resource     : entité concernée (ex: "Ticket:clx...")
oldValue     : état avant (JSONB delta)
newValue     : état après (JSONB delta)
userId       : acteur déclencheur
tenantId     : tenant concerné
ipAddress    : IP de la requête
createdAt    : horodatage précis
```

### III.7 Les 5 Workflows Majeurs

#### Workflow Colis (Parcel)

| État Initial | Action | Guards | Événement | Nouvel État |
|---|---|---|---|---|
| (new) | PACK | `data.parcel.create.agency` | `parcel.created` | CREATED |
| CREATED | RECEIVE | `data.parcel.scan.agency` | `parcel.received` | AT_ORIGIN |
| AT_ORIGIN | ADD_TO_SHIPMENT | Permission + `Shipment.destinationId == Parcel.destinationId` + `Shipment.remainingWeight >= Parcel.weight` | `parcel.assigned` | PACKED |
| PACKED | LOAD | Permission + Shipment lié au Trip | `parcel.loaded` | LOADED |
| LOADED | DEPART | Trip.status = IN_PROGRESS (auto via side effect) | `parcel.in_transit` | IN_TRANSIT |
| IN_TRANSIT | ARRIVE | `data.parcel.scan.agency` | `parcel.arrived` → SMS/WhatsApp | ARRIVED |
| ARRIVED | DELIVER | Permission + identité destinataire vérifiée | `parcel.delivered` | DELIVERED |
| * | DAMAGE | `data.parcel.report.agency` | `parcel.damaged` → SAV + WhatsApp | DAMAGED |

#### Workflow Ticket (Billet)

| État Initial | Action | Guards | Événement | Nouvel État |
|---|---|---|---|---|
| (new) | CREATE | Permission + siège disponible | `ticket.created` | CREATED |
| CREATED | RESERVE | Timeout 15min | `ticket.reserved` | PENDING_PAYMENT |
| PENDING_PAYMENT | PAY | Webhook paiement validé (idempotent) | `ticket.confirmed` | CONFIRMED |
| PENDING_PAYMENT | EXPIRE | Timeout atteint (scheduler) | `ticket.expired` → siège libéré | EXPIRED |
| CONFIRMED | CHECK_IN | Permission + Trip.status = BOARDING | `ticket.checked_in` | CHECKED_IN |
| CHECKED_IN | BOARD | Permission + QR HMAC valide | `ticket.boarded` → manifest update | BOARDED |
| BOARDED | FINALIZE | Trip.status = COMPLETED | `ticket.completed` | COMPLETED |
| CONFIRMED | CANCEL | Permission | `ticket.cancelled` → remboursement workflow | CANCELLED |

**Workflow Remboursement (nouveau) :** `CANCEL → REFUND_PENDING → REFUND_PROCESSING → REFUNDED | REFUND_FAILED`

#### Workflow Voyageur (Traveler)

| État Initial | Action | Guards | Événement | Nouvel État |
|---|---|---|---|---|
| (new) | VERIFY | Permission + pièce identité | `traveler.verified` | VERIFIED |
| VERIFIED | SCAN_IN | Ticket CONFIRMED | `traveler.checked_in` | CHECKED_IN |
| CHECKED_IN | SCAN_BOARD | Trip.status = BOARDING | `traveler.boarded` → seat_map | BOARDED |
| BOARDED | SCAN_OUT | Station déchargement = station actuelle | `traveler.arrived_station` | ARRIVED |
| ARRIVED | EXIT | Validation sortie physique | `traveler.exited` | EXITED |

#### Workflow Bus

| État Initial | Action | Guards | Événement | Nouvel État |
|---|---|---|---|---|
| IDLE | OPEN_BOARDING | Permission + Bus AVAILABLE + Driver assigné + Checklist PRE_DEPARTURE compliant | `bus.boarding_opened` | BOARDING |
| BOARDING | DEPART | Permission + Manifest clos + Checklist BOARDING_READY compliant | `bus.departed` → ETA broadcast | DEPARTED |
| DEPARTED | ARRIVE | GPS = coordonnées destination | `bus.arrived` → POST_TRIP checklist | ARRIVED |
| ARRIVED | CLEAN | Checklist POST_TRIP compliant | `bus.cleaned` | CLOSED |
| * | INCIDENT_MECHANICAL | Permission | `bus.mechanical_failure` → App Garage | MAINTENANCE |
| MAINTENANCE | RESTORE | `data.maintenance.approve.tenant` | `bus.restored` | AVAILABLE |

#### Workflow Trajet (Trip)

| État Initial | Action | Guards | Événement | Nouvel État |
|---|---|---|---|---|
| (new) | ACTIVATE | Permission + Route + Bus + Driver assignés | `trip.planned` | PLANNED |
| PLANNED | START_BOARDING | Checklist PRE_DEPARTURE compliant + Bus AVAILABLE | `trip.boarding_started` → écrans | OPEN |
| OPEN | BEGIN_BOARDING | Heure départ - now < seuil | `trip.boarding_started` → écrans | BOARDING |
| BOARDING | DEPART | Manifest clos + Bagages sécurisés + Checklist BOARDING_READY | `trip.departed` → GPS start | IN_PROGRESS |
| IN_PROGRESS | PAUSE | Permission | `trip.paused` → recalcul ETA | IN_PROGRESS_PAUSED |
| IN_PROGRESS_PAUSED | RESUME | Permission | `trip.resumed` → ETA update | IN_PROGRESS |
| IN_PROGRESS | REPORT_INCIDENT | Permission | `trip.delayed` → routage alertes | IN_PROGRESS_DELAYED |
| IN_PROGRESS_DELAYED | CLEAR_INCIDENT | Permission | `trip.incident_cleared` | IN_PROGRESS |
| IN_PROGRESS | END_TRIP | GPS = destination + Checklist POST_TRIP compliant | `trip.completed` → manifests | COMPLETED |

> **Note v2.0 :** `IN_PROGRESS_PAUSED` et `IN_PROGRESS_DELAYED` sont des **états discrets** dans `WorkflowConfig`, pas des sous-états. Cette décision garantit la compatibilité avec le moteur stateless.

---

## IV. Modules Métiers — Détails Complets

### IV.1 Billetterie & Passagers

- Réservation multi-canal : App Mobile, Web, Kiosque physique
- QR Code = `HMAC-SHA256(ticketId:tripId:seatNumber, tenant_hmac_key_vault)` — pas un CUID
- Timeout de réservation : 15 minutes configurable par tenant (état `PENDING_PAYMENT` + scheduler)
- Gestion des sièges : `Bus.seatLayout` (JSONB) obligatoire avant toute vente numérotée
- Bagages : `count`, `weight`, `type` (CABIN/HOLD) — déduits de `Bus.luggageCapacityKg`
- No-show : Enregistré sur `Traveler`, siège non libéré (politique configurable par tenant)
- Manifeste voyageurs : vue temps réel `Ticket + Traveler + Baggage + Seat` par Trip

**Entités :** `Ticket`, `Traveler`, `Baggage`

### IV.2 Messagerie Colis & Expéditions

- `Parcel` : unité unitaire, QR étiquette, `destinationId` (FK Station — plus String libre)
- `Shipment` : groupement de N colis pour un Trip, `status` propre (OPEN/LOADED/IN_TRANSIT/ARRIVED/CLOSED)
- `Parcel.destinationId` et `Shipment.destinationId` sont des FK vers `Station.id`
- Guard d'ajout : `Shipment.destinationId == Parcel.destinationId` ET `Shipment.remainingWeight >= Parcel.weight`
- Transition `Parcel.DEPART` : déclenchée automatiquement (side effect de `Trip.DEPART`) — pas par scan humain
- `Parcel.history` (JSONB) : log immuable de chaque scan avec `{ timestamp, agentId, stationId, action }`
- SAV Colis : `data.parcel.report.agency` → Side effect : WhatsApp expéditeur + création Claim

**Entités :** `Parcel`, `Shipment`

### IV.3 Flotte & Personnel

- `Bus.seatLayout` (JSONB) : plan numéroté obligatoire avant vente — permission `control.fleet.layout.tenant`
- `Bus.version` : champ de lock optimiste pour les transitions workflow
- `Staff` ↔ `User` : relation bidirectionnelle (`Staff.userId @unique`, `User.staffProfile Staff?`)
- `Staff.totalDriveTimeToday` : suivi du temps de conduite pour conformité réglementaire
- Guard d'affectation chauffeur : `Staff.totalDriveTimeToday < maxDriveHoursPerDay` (configurable tenant)
- `Agency` : entité formalisée — `User.agencyId` FK obligatoire pour le scope `agency`

**Entités :** `Bus`, `Staff`, `Route`, `Waypoint`, `Station`, `Agency`

### IV.4 Garage & Maintenance

- `MaintenanceReport` : entité propre au module (manquante dans v1.0)
- Réception alertes → `data.maintenance.update.own` (mécanicien)
- Validation remise en service → `data.maintenance.approve.tenant` (responsable)
- Remise en service = side effect : `Bus.RESTORE` → `Bus.status = AVAILABLE`
- Stocks de pièces : `partsUsed` (JSONB) dans `MaintenanceReport`

**Entités :** `MaintenanceReport`

### IV.5 SAV & Objets Trouvés

- Déclaration Post-Trip → création automatique de ticket SAV avec tripId + photo (MinIO URL, TTL 30j)
- Remise physique : log de sortie avec signature numérique OU photo pièce d'identité
- URL signée photo pièce d'identité : TTL **15 minutes maximum** (donnée biométrique)
- `Claim` : entité pour les réclamations formelles (litiges colis, demandes de remboursement)

**Entités :** `LostFoundItem`, `Claim`

### IV.6 Alertes & Routage Intelligent (SOS)

| Type | Source | Destinataire | Action Système |
|---|---|---|---|
| Panne Mécanique | Chauffeur (checklist/incident) | App Garage | Bloque départ bus dans Workflow |
| Objet trouvé | Chauffeur (Post-Trip) | App SAV | Création ticket SAV avec photo |
| Incident voyage | Chauffeur (temps réel) | Admin + Écrans | Trip → IN_PROGRESS_DELAYED + ETA |
| SOS | Bouton SOS Chauffeur | Admin + Autorités | Push prioritaire + GPS temps réel |
| Colis endommagé | Agent de quai | SAV + Client | WhatsApp expéditeur automatique |

**Règle SOS :** Rate limiting 3 SOS/heure/userId + confirmation double-tap côté mobile. Toutes les notifications SOS vers des autorités extérieures sont loguées en `AuditLog` niveau `critical`.

### IV.7 Pricing & Yield Management

- Formule : `Prix Final = Base Route + Taxes État + Péages + Coût/km + Surplus Bagages + Yield (si actif)`
- Zéro hardcoding : tout dans `PricingRules.rules` (JSONB) par tenant_id et route_id
- `InstalledModule.YIELD_ENGINE` : feature flag — le Pricing Engine vérifie sa présence avant yield
- Yield Management : ajustement selon taux de remplissage (X% sièges vendus = +Y% prix) OU proximité départ
- **Prix garanti :** Le prix calculé à `PENDING_PAYMENT` est verrouillé dans `Ticket.pricePaid`. Le yield ne peut plus l'affecter après cette étape.
- Remboursement : workflow dédié `REFUND_PENDING → REFUND_PROCESSING → REFUNDED | REFUND_FAILED`

**Entités :** `PricingRules`, `InstalledModule`

### IV.8 Caisse Terrain

- Session de caisse : `OPEN → CLOSED` avec possible `DISCREPANCY`
- `CashRegister.agencyId` : FK vers `Agency` (scope de clôture par superviseur = agencyId correspondant)
- Superviseur peut clôturer la caisse d'un agent de **son agence uniquement** (scope `agency`)
- Audit immuable : chaque ouverture et fermeture loguée dans `AuditLog`
- Remboursement = `Transaction.type = REFUND` — crée une transaction négative en caisse

**Entités :** `CashRegister`, `Transaction`

### IV.9 Flight Deck (Sécurité Opérationnelle)

**Checklists (Guard bloquants) :**
- `PRE_DEPARTURE` : isCompliant = true → débloque transition Trip vers BOARDING
- `BOARDING_READY` : isCompliant = true → débloque départ du Trip
- `POST_TRIP` : déclenchée automatiquement (side effect Bus.ARRIVED)
- `MAINTENANCE` : remplie par le mécanicien lors d'une intervention

**Roadbook :** Stocké en JSONB **dans la DB** (champ `Trip.roadbook`) — pas dans MinIO. Cette décision permet de requêter les waypoints (ex: trouver tous les trips passant par une station).

Structure Roadbook :
```json
{
  "waypoints": [
    { "stationId": "...", "order": 1, "isMandatoryStop": true, "estimatedWait": 15 },
    { "stationId": "...", "order": 2, "isAlertZone": true, "alertDescription": "Travaux N1" }
  ],
  "technicalBreaks": [
    { "location": "Aire de Bouaké", "plannedDuration": 30, "atWaypoint": 2 }
  ]
}
```

**Entités :** `Checklist`, `Incident`

### IV.10 Manifeste 3.0

Vue temps réel agrégée — pas d'entité propre. Agrégation de :
- `Ticket` (sièges, statut)
- `Traveler` (état embarquement, `dropOffStationId`)
- `Baggage` (positions soute)
- `Bus.seatLayout`

Fonction clé : `getStationDropOff(tripId, stationId)` — retourne la liste précise des voyageurs et colis à décharger à une station, avec numéros de sièges et positions en soute.

Index DB dédié : `@@index([tripId, dropOffStationId]) on Traveler WHERE status = 'BOARDED'`

### IV.11 TripEvent & Incident — Interface Primaire Partagée

`TripEvent` et `Incident` partagent une interface de base commune (`BaseEvent`). La distinction se fait par le champ `type` (discriminateur).

```typescript
// Interface partagée — jamais instanciée directement
interface BaseEvent {
  id:         string
  tenantId:   string
  tripId:     string
  type:       EventType       // discriminateur
  severity:   'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  reportedBy: string          // userId
  reportedAt: DateTime
  gpsLat?:    number
  gpsLng?:    number
  metadata:   Json            // champs spécifiques au type
}

// TripEvent — automatique/technique (pauses, checkpoints, ETA)
// type: 'PAUSE_START' | 'PAUSE_END' | 'CHECKPOINT_REACHED' | 'DELAY_DETECTED'
// Source: chauffeur (bouton pause) ou système (geofence checkpoint)

// Incident — humain/exceptionnel (SOS, panne, colis endommagé)
// type: 'SOS' | 'MECHANICAL' | 'ACCIDENT' | 'SECURITY' | 'CARGO_DAMAGED'
// Source: chauffeur ou agent — déclenche un workflow SAV / alerte Dispatch
// Attribut supplémentaire : workflow Claim (OPEN → UNDER_INVESTIGATION → RESOLVED → CLOSED)
```

**Règle de distinction :**
- `TripEvent` : événement opérationnel prévu dans le déroulement normal. Alimente les KPIs, journaux de bord, recalcul ETA. Pas de workflow SAV.
- `Incident` : événement exceptionnel nécessitant une réponse humaine. Déclenche routing alertes, workflow Claim, notifications. Loggé en AuditLog niveau `warn` ou `critical`.

**Entités DB :** Une seule table `TripEvent` avec colonne `type` comme discriminateur. Les incidents (`type IN ('SOS', 'MECHANICAL', 'ACCIDENT', 'SECURITY', 'CARGO_DAMAGED')`) ont une FK optionnelle vers `Claim`.

### IV.12 CRM & Expérience Voyageur

- **Profil Voyageur Enrichi :** Histogramme des trajets, préférences de siège et de gare (JSONB), cumul des bagages, indice de fidélité calculé
- **User.userType = VOYAGEUR :** Les voyageurs accèdent à leur profil via `data.crm.read.own`. Les admins tenant via `data.crm.read.tenant`
- **Réclamations SAV :** `Claim` workflow — `OPEN → UNDER_INVESTIGATION → RESOLVED → CLOSED`. Ouverture automatique si note voyageur < 2/5 (side effect de `trip.completed`)
- **Campagnes Marketing :** Entité `Campaign` — scoped tenant, lié aux groupes de voyageurs par critères. Permission `control.campaign.manage.tenant`
- **Anti-données-fantômes :** Un profil voyageur est créé uniquement à la première réservation — pas à la création de compte. `User.voyagerProfile` est nullable jusqu'à ce moment

**Entités :** `Campaign`, champs enrichis sur `User` (préférences JSONB, loyaltyScore, userType)

### IV.13 Safety & Feedback

- **Signalement Conduite Dangereux :** Bouton in-app Voyageur — émet `SafetyAlert` via `IEventBus`. Permission `data.feedback.submit.own`. Rate limit: 10 alertes/heure/userId.
- **Corrélation GPS anti-fraude :** Toute alerte safety est corrélée avec la position GPS du bus au même instant. Si distance > 2km, alerte marquée `LOW_CONFIDENCE`. Score de confiance stocké dans `SafetyAlert.verificationScore`
- **Système de Notation Agrégé :**
  - `Feedback` : note brute — lié à `userId`, `tripId`, `driverId?`, `busId?`, `agencyId?`, ratings JSONB `{ conduct, punctuality, comfort, baggage }`, commentaire libre
  - `Rating` : agrégat calculé — note moyenne par entité (`driverId`, `busId`, `agencyId`). Recalculé asynchroniquement via side effect `trip.completed`
  - Champs de notation : conduite, ponctualité, comportement (chauffeur) ; propreté, confort, clim (bus) ; accueil, temps d'attente, bagages (agence)
- **RGPD :** Le consentement explicite à la collecte de la note et du commentaire est enregistré dans `Feedback.rgpdConsentAt`. Un message permanent est affiché sur le formulaire de notation : *"Vos données sont utilisées pour améliorer le service. Elles ne sont pas revendues. Voir notre politique de confidentialité."*

**Entités :** `Feedback`, `Rating`, `SafetyAlert`

### IV.14 Smart Bus Display

- **Jauge de Progression :** Position bus entre gare A et B calculée depuis `Trip.currentLat/Lng` vs waypoints du roadbook
- **ETA Dynamique :** Recalculé à chaque checkpoint GPS validé — diffusé via `IEventBus` → Redis → WebSocket vers l'écran bus
- **Météo Destination :** Appel via `IWeatherService` (interface — fournisseur permutable). Affiché sur l'écran tableau de bord bus
- **QR Code Feedback :** QR affiché sur écran bus → URL portail public feedback `https://{tenantSlug}.translog.app/feedback/{tripId}` — pré-rempli avec tripId, aucun compte requis
- **Trip.displayNote** et **Trip.displayColor** : champs texte court + code couleur hexadécimal modifiables par agent gare avec permission `data.display.update.agency`. Propagés aux écrans via WebSocket.
- **Retard automatique :** Si `Trip.START_BOARDING` n'est pas déclenché à `scheduledDepartureAt + 5min`, le Scheduler positionne automatiquement `Trip.displayNote = "Retard"` et `Trip.displayColor = '#FF9800'`

**Entités :** `Trip.displayNote String?`, `Trip.displayColor String?`  
**Infrastructure :** `IWeatherService` interface, implémentation `OpenWeatherMapService` (permutable)

### IV.15 Crew Operations

- **CrewAssignment :** Lien entre `Trip` et les membres d'équipage (co-pilote, hôtesse, agent sécurité). Un `Staff` peut avoir un `crewRole` différent de son rôle principal pour un trajet donné
- **Pre-Trip Meeting :** Checklist partagée dans l'app Chauffeur — validée collaborativement par tous les membres de l'équipage avant l'ouverture du BOARDING. La checklist `PRE_TRIP_MEETING` doit avoir `isCompliant = true` pour que le guard `BEGIN_BOARDING` passe
- **Résolution sans effets de bord :** `CrewAssignment` est une entité indépendante avec FK vers `Trip` et `Staff`. Elle ne modifie pas les workflows existants — elle ajoute un guard optionnel `CREW_BRIEFED` sur la transition `OPEN → BOARDING`. Ce guard est configurable par tenant via `WorkflowConfig.guards`

**Entités :** `CrewAssignment (id, tripId, staffId, crewRole, briefedAt?)`  
**Permissions :** `data.crew.manage.tenant`

### IV.16 Public Reporter (Portail Citoyen)

- **Portail sans compte :** Endpoint public accessible via QR Code sur les bus ou URL directe. Aucun compte requis. `tenantId` extrait du path param uniquement (jamais d'un header)
- **Signalement :** Immatriculation **ou** numéro de parc + type d'incident + description libre + photo optionnelle (MinIO, TTL 24h)
- **Validation géo-temporelle :** GPS du déclarant (navigateur) comparé à la position du bus (Redis GPS buffer). Corrélation > 90% → `SafetyAlert.status = VERIFIED`. < 50% → `UNVERIFIED`. Sauvegardé dans `PublicReport.verificationScore`
- **RGPD :** Les coordonnées GPS du déclarant sont automatiquement supprimées après 24h (`PublicReport.reporterGpsExpireAt`). Un avertissement permanent est affiché sur le formulaire : *"Votre position GPS sera utilisée uniquement pour valider ce signalement et supprimée sous 24h."*
- **Rate limiting agressif par IP :** Sliding window Redis — 5 signalements/IP/heure (configurable par tenant). Dépassement → 429 avec message RGPD

**Endpoint :** `POST /public/{tenantSlug}/report` (pas sous `/api/v1/tenants/`)  
**Entités :** `PublicReport (id, tenantId, plateOrParkNumber, type, description, reporterGpsLat?, reporterGpsLng?, reporterGpsExpireAt, verificationScore, status, correlatedBusId?, photoUrl?)`

### IV.17 Gestion des Délais et Annulations

- `control.trip.delay.agency` : Agent ou chauffeur peut enregistrer un délai. Crée un `TripEvent` de type `DELAY_DECLARED` et met à jour `Trip.displayNote` automatiquement
- `control.trip.cancel.tenant` : Annulation complète du trajet. Side effects : notification SMS/WhatsApp/Push à tous les voyageurs `CONFIRMED`, remboursement déclenché automatiquement via workflow Ticket `CANCEL`
- **GPS Geofencing Départ :** `Trip.DEPART` déclenche un guard asynchrone — si le bus reste dans un rayon de 200m de la gare 10 min après la transition, un `TripEvent` de type `DEPARTURE_ANOMALY` est créé. Non bloquant pour la transition, mais déclenche alerte Dispatch. Nécessite PostGIS ou fallback haversine
- `control.trip.log_event.own` : Chauffeur peut enregistrer pauses, reprises, checkpoints. Chaque enregistrement crée un `TripEvent` et recalcule l'ETA

### IV.18 Modules Ajoutés (v2.0)

**Scheduler & Récurrence :** Templates de trajets récurrents. Génération automatique des `Trip` selon le calendrier. Gestion des exceptions (jours fériés, suspension).

**Notification Preferences :** `NotificationPreference` par userId — canaux activés (SMS/WhatsApp/Push/Email), opt-out par type d'événement. Les side effects Workflow consultent ce module avant d'envoyer.

**Quota Manager :** Limites par tenant : GPS updates/sec, WebSocket connections, events/min. Rate limiting applicatif avant que les requêtes n'atteignent les modules métier.

**Driver Hours Compliance :** `Staff.totalDriveTimeToday` — guard bloquant à l'affectation si dépassement réglementaire.

**Dead Letter Queue Manager :** Interface de monitoring et replay manuel des événements en `DeadLetterEvent`. Alerting si DLQ non vide depuis > 1 heure.

---

## V. Système de Permissions (IAM)

### V.1 Format de Permission

```
{plane}.{module}.{action}.{scope}
```

| Dimension | Valeurs |
|---|---|
| plane | `control` (modification règles/config) · `data` (manipulation données métier) |
| module | `iam` · `workflow` · `ticket` · `parcel` · `trip` · `fleet` · `pricing` · `cashier` · `sav` · `maintenance` · `manifest` · `traveler` · `luggage` · `shipment` · `session` · `user` · `integration` · `settings` · `module` · `route` · `bus` · `crm` · `campaign` · `feedback` · `safety` · `stats` · `crew` · `display` |
| action | `create` · `read` · `update` · `delete` · `scan` · `cancel` · `approve` · `report` · `check` · `open` · `close` · `transaction` · `deliver` · `claim` · `manage` · `config` · `override` · `install` · `revoke` · `verify` · `track` · `weigh` · `group` · `layout` · `yield` · `audit` · `setup` · `submit` · `monitor` · `delay` · `log_event` |
| scope | `own` · `agency` · `tenant` · `global` |

**Règle fondamentale :** Avoir le rôle ne suffit pas. Le Guard vérifie que l'utilisateur est dans le bon tenant ET dans la bonne agence (pour scope `agency`) pour exercer la permission. Toute route sans décorateur `@Permission()` = 500 en développement, 403 en production.

### V.2 Matrice Complète des Permissions

**IAM**
```
control.iam.manage.tenant       Créer/Modifier rôles et permissions
control.iam.audit.tenant        Consulter AuditLogs (lecture seule)
control.integration.setup.tenant Configurer Entra ID, SCIM, Vault
data.user.read.agency           Lister employés de son agence
data.session.revoke.own         Révoquer ses propres sessions
data.session.revoke.tenant      Révoquer sessions d'un utilisateur suspect
```

**Workflow & Configuration**
```
control.workflow.config.tenant  Définir états et transitions
control.workflow.override.global (SuperAdmin) Forcer une transition bloquée
control.module.install.tenant   Activer/Désactiver modules
control.settings.manage.tenant  Paramètres globaux
```

**Trajets & Planification**
```
control.route.manage.tenant     Créer itinéraires, prix de base, péages
data.trip.create.tenant         Planifier voyages
data.trip.read.own              (Chauffeur) Voir ses trajets assignés
data.trip.update.agency         Modifier départ depuis agence
data.trip.check.own             Soumettre checklists
data.trip.report.own            Déclarer incident / SOS / pause
```

**Billetterie**
```
data.ticket.create.agency       Vendre billet (génération QR)
data.ticket.cancel.agency       Annuler/Rembourser billet
data.ticket.scan.agency         Scanner billets (check-in + embarquement)
data.ticket.read.agency         Voir billets vendus dans son agence
data.ticket.read.tenant         Rapports financiers globaux
data.traveler.verify.agency     Valider identité passager
data.traveler.track.global      Localiser passager sur tout trajet
data.luggage.weigh.agency       Enregistrer bagages et surplus
```

**Logistique Colis**
```
data.parcel.create.agency       Enregistrer colis
data.parcel.scan.agency         Scanner chargement/déchargement
data.parcel.update.agency       Ajouter colis à Shipment
data.parcel.update.tenant       Modifier infos livraison
data.parcel.report.agency       Déclarer colis endommagé/perdu
data.parcel.track.global        Suivi complet inter-agences
data.shipment.group.agency      Créer Shipment
```

**Flotte & Maintenance**
```
control.fleet.manage.tenant     Créer profil bus, sièges, capacités
control.fleet.layout.tenant     Mapper plan de salle (prérequis vente)
control.bus.capacity.tenant     Définir limites sièges/soute
data.fleet.manage.tenant        Ajouter bus, cartes grises
data.fleet.status.agency        Modifier statut bus
data.maintenance.update.own     (Mécanicien) Remplir rapports
data.maintenance.approve.tenant Valider remise en service
data.manifest.read.own          (Chauffeur) Consulter manifest
```

**Finance**
```
control.pricing.manage.tenant   Configurer taxes, péages, prix/km
control.pricing.yield.tenant    Configurer Yield Management
data.pricing.read.agency        Consulter grille tarifaire
data.cashier.open.own           Ouvrir session caisse
data.cashier.transaction.own    Enregistrer flux cash
data.cashier.close.agency       Clôturer caisse d'agence
```

**SAV**
```
data.sav.report.own             Déclarer objet trouvé (chauffeur)
data.sav.report.agency          Enregistrer objet trouvé (agent)
data.sav.deliver.agency         Gérer remise objet au client
data.sav.claim.tenant           Gérer réclamations et litiges
```

**CRM & Campagnes**
```
data.crm.read.tenant            Voir profil complet et préférences voyageur
control.campaign.manage.tenant  Créer et analyser des campagnes
```

**Safety & Feedback**
```
data.feedback.submit.own        (Voyageur) Soumettre note ou signalement conduite
control.safety.monitor.global   (Dispatch) Voir alertes conduite dangereuse temps réel
```

**Analytics & Stats**
```
control.stats.read.tenant       Accéder aux rapports de rentabilité et performances
```

**Crew**
```
data.crew.manage.tenant         Assigner l'équipage aux trajets
```

**Délais & Affichage**
```
control.trip.delay.agency       Injecter un délai (agent/chauffeur)
control.trip.cancel.tenant      Annuler un trajet avec notifications automatiques
control.trip.log_event.own      (Chauffeur) Enregistrer pauses et checkpoints
data.display.update.agency      Modifier remarques sur écrans d'affichage gare
```

**Impersonation JIT (tenant 00000000-... uniquement)**
```
control.impersonation.switch.global   (SUPER_ADMIN, SUPPORT_L1+) Créer session JIT sur tenant client
control.impersonation.revoke.global   (SUPER_ADMIN, SUPPORT_L2) Révoquer session active
```

**Support — Lecture Data Plane globale (via impersonation uniquement)**
```
data.ticket.read.global         Lire tickets sur tout tenant (session JIT)
data.trip.read.global           Lire trajets sur tout tenant (session JIT)
data.parcel.read.global         Lire colis sur tout tenant (session JIT)
data.traveler.read.global       Lire voyageurs sur tout tenant (session JIT)
data.fleet.read.global          Lire flotte sur tout tenant (session JIT)
data.cashier.read.global        Lire opérations caisse sur tout tenant (session JIT)
data.manifest.read.global       Lire manifestes sur tout tenant (session JIT)
```

**Support L2 — Debug technique**
```
data.workflow.debug.global      Inspecter le state machine et les transitions (L2)
data.outbox.replay.global       Rejouer des événements outbox échoués (L2)
```

### V.3 IAM Zero-Hardcode — Architecture DB-Driven

**Principe :** Les rôles et leurs permissions ne sont **jamais** définis dans le code TypeScript en tant que source de vérité runtime. Les enums TypeScript (`P_TICKET_SCAN_AGENCY = 'data.ticket.scan.agency'`) sont des constantes compile-time pour éviter les chaînes magiques dans le code. La vérification runtime se fait toujours via la DB.

**Modèle DB :**
```prisma
model Role {
  id          String           @id @default(cuid())
  tenantId    String
  name        String           // 'DRIVER' | 'STATION_AGENT' | 'SUPERVISOR' | ...
  isSystem    Boolean          @default(false)  // rôles par défaut non supprimables
  permissions RolePermission[]
  users       User[]
  tenant      Tenant           @relation(...)

  @@unique([tenantId, name])
}

model RolePermission {
  id         String @id @default(cuid())
  roleId     String
  permission String // format: {plane}.{module}.{action}.{scope}
  role       Role   @relation(...)

  @@unique([roleId, permission])
  @@index([roleId])
}
```

**Guard runtime :** `PermissionGuard` vérifie `prisma.rolePermission.findFirst({ where: { roleId: user.roleId, permission: requiredPerm } })` avec cache Redis `iam:perm:{roleId}:{permission}` TTL 60s (invalidé sur `control.iam.manage.tenant`).

**Seed onboarding :** À chaque création de tenant, `OnboardingService` exécute `iam.seed.ts` qui insère les 8 rôles par défaut avec leurs permissions. L'admin tenant peut ensuite modifier via `control.iam.manage.tenant` — les rôles `isSystem = true` ne peuvent être supprimés mais leurs permissions peuvent être étendues.

**Rôles système — tenant plateforme `00000000-0000-0000-0000-000000000000` (bootstrapPlatform) :**
| Rôle | Profil | Permissions clés | Tenant |
|---|---|---|---|
| `SUPER_ADMIN` | Super-Admin | `*.global` — Control + Data complet + impersonation | `0000...` |
| `SUPPORT_L1` | Technicien Support | `data.*.read.global` + `control.impersonation.switch.global` | `0000...` |
| `SUPPORT_L2` | Tech Lead Support | L1 + `data.workflow.debug.global` + `data.outbox.replay.global` + revoke | `0000...` |

**Rôles par défaut seedés — par tenant client (seedTenantRoles) :**
| Rôle | Profil | Permissions clés |
|---|---|---|
| `TENANT_ADMIN` | Admin tenant | `control.*.tenant` + `data.*.tenant` + `control.iam.manage.tenant` |
| `AGENCY_MANAGER` | Manager agence | `data.ticket.*agency` + `data.cashier.*` + `data.parcel.*agency` |
| `CASHIER` | Caissier | `data.ticket.create.agency` + `data.cashier.*own` |
| `DRIVER` | Chauffeur | `data.trip.read.own` + `data.trip.report.own` + `data.trip.check.own` |
| `HOSTESS` | Hôtesse/Agent quai | `data.ticket.scan.agency` + `data.traveler.verify.agency` |
| `MECHANIC` | Mécanicien | `data.maintenance.*own` |
| `DISPATCHER` | Superviseur dispatch | `control.safety.monitor.global` + tracking global |
| `VOYAGEUR` | Passager | `data.feedback.submit.own` |
| `PUBLIC_REPORTER` | Citoyen anonyme | `data.feedback.submit.own` |

### V.4 Architecture IAM Transverse — Tenant Plateforme (§IV.12)

Le Super-Admin et les agents Support sont des **entités transverses**, absentes du flux d'onboarding client. Ils résident dans un tenant système dédié, jamais visible des clients.

#### V.4.1 Identifiant Système (UUID Canonique)

```
PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000"  (nil UUID RFC 4122)
Slug              : "__platform__"
```

Ce tenant est créé **une seule fois** au bootstrap plateforme (`bootstrapPlatform()`). Il n'est jamais retourné par l'Onboarding Orchestrator. Aucun user client ne peut y être assigné.

**Protection Guard :** `PermissionGuard` vérifie que tout user dont `tenantId === PLATFORM_TENANT_ID` possède au minimum `control.impersonation.switch.global`. Sans cette permission, la requête est rejetée `403` — cela empêche toute assignation accidentelle d'un user standard au tenant plateforme.

#### V.4.2 Rôles Système du Tenant Plateforme

| Rôle | Profil | Permissions clés | Control Plane | Data Plane |
|---|---|---|---|---|
| `SUPER_ADMIN` | Super-Admin | `*.global` — toutes permissions | Complet | Lecture + override |
| `SUPPORT_L1` | Technicien Support | `data.*.read.global` + switch JIT | **Aucun** | Lecture seule |
| `SUPPORT_L2` | Tech Lead Support | L1 + `data.workflow.debug.global` + `data.outbox.replay.global` + révocation | **Aucun** | Lecture + debug |

**Principe du moindre privilège :** Les agents Support n'ont **aucun** accès Control Plane (pas de gestion d'abonnements, pas de configuration de workflow, pas d'IAM tenant). Leur accès Data Plane est uniquement possible via le mécanisme JIT d'impersonation.

#### V.4.3 Mécanisme JIT — Switch de Session (Impersonation)

**Pourquoi :** Conserver le filtrage RLS existant (`SET LOCAL app.tenant_id`) sans réécrire les requêtes Prisma. L'acteur reste sur le tenant `0000...` mais génère un token éphémère portant le `tenant_id` du client ciblé.

**Flow complet :**

```
1. Agent SA/Support (tenant 0000...)
      │
      ▼
2. POST /iam/impersonate
   @RequirePermission("control.impersonation.switch.global")
      │
      ▼
3. ImpersonationService.switchSession(targetTenantId)
   ├─ Vérifie que targetTenantId ≠ PLATFORM_TENANT_ID
   ├─ Crée ImpersonationSession en DB (status=ACTIVE, exp=+15min)
   ├─ Génère token HMAC-SHA256 signé (clé Vault: platform/impersonation_key)
   └─ Retourne { token, sessionId, expiresAt }
      │
      ▼
4. Requêtes suivantes avec header:
   X-Impersonation-Token: <token>
      │
      ▼
5. ImpersonationGuard (avant PermissionGuard)
   ├─ Vérifie acteur ∈ PLATFORM_TENANT_ID
   ├─ Valide signature HMAC + TTL + statut DB
   └─ Injecte req.impersonation.targetTenantId
      │
      ▼
6. PermissionGuard
   ├─ Vérifie permission de l'acteur (roleId original)
   └─ ScopeContext.tenantId = targetTenantId (effectif)
      │
      ▼
7. RlsMiddleware → SET LOCAL app.tenant_id = targetTenantId
   Toutes les requêtes Prisma filtrent automatiquement sur le tenant client
      │
      ▼
8. Fin de session: DELETE /iam/impersonate/:sessionId
   ou expiration automatique à TTL
```

**Token :** Format `base64url(payload_json).hex(hmac-sha256)` — identique au QrService. Clé distincte par tenant. Non stocké en clair en DB (SHA-256 hash uniquement pour révocation).

**AuditLog :** Toute création/révocation est loggée `level=critical` dans le tenant plateforme avec `actorId`, `targetTenantId`, `sessionId`, `ipAddress`, `reason`. Ces logs ne peuvent être supprimés.

#### V.4.4 Modèle ImpersonationSession

```prisma
model ImpersonationSession {
  id             String    @id @default(uuid())
  actorId        String    // User.id de l'agent SA ou Support
  actorTenantId  String    // toujours "00000000-0000-0000-0000-000000000000"
  targetTenantId String    // tenant client ciblé
  token          String    @unique  // référence opaque (non en clair)
  tokenHash      String    @unique  // SHA-256(token) pour révocation
  status         String    @default("ACTIVE") // ACTIVE | EXPIRED | REVOKED
  reason         String?   // justification (audit)
  ipAddress      String?
  expiresAt      DateTime  // createdAt + 15 minutes
  revokedAt      DateTime?
  revokedBy      String?
  createdAt      DateTime  @default(now())
}
```

#### V.4.5 Endpoints IAM Transverse

| Méthode | Route | Permission requise | Description |
|---|---|---|---|
| `POST` | `/iam/impersonate` | `control.impersonation.switch.global` | Crée session JIT (SUPPORT_L1+) |
| `DELETE` | `/iam/impersonate/:sessionId` | `control.impersonation.revoke.global` | Révoque session (SUPPORT_L2+) |
| `GET` | `/iam/impersonate/:tenantId/active` | `control.impersonation.revoke.global` | Liste sessions actives (audit) |

### V.5 Règles d'Implémentation

1. `PermissionGuard` global intercepte CHAQUE requête
2. Source de vérité `tenantId` = session Better Auth uniquement (ou `targetTenantId` en impersonation JIT)
3. Scope `own`/`agency` → injection SQL dynamique dans requête Prisma
4. Rate limiting par `tenantId + userId + endpoint`
5. `control.workflow.override.global` loggé en niveau `critical` — toujours auditable
6. `control.impersonation.switch.global` loggé en niveau `critical` — non-négociable pour conformité
7. `seedTenantRoles()` lève une exception si appelé avec `PLATFORM_TENANT_ID` — protection anti-pollution

---

## VI. Spécifications Techniques

### VI.1 Schéma Prisma Complet (v2.0 — Corrigé et Augmenté)

> Voir fichier `prisma/schema.prisma` — source de vérité du schéma de données.

**Corrections v2.0 par rapport au schéma v1.0 :**
- `WorkflowConfig` : ajoutée (manquante dans v1.0)
- `WorkflowTransition` : ajoutée (idempotence)
- `OutboxEvent` : ajoutée (event bus)
- `DeadLetterEvent` : ajoutée (DLQ)
- `Agency` : ajoutée (manquante dans v1.0)
- `MaintenanceReport` : ajoutée (manquante dans v1.0)
- `NotificationPreference` : ajoutée
- `Claim` : ajoutée
- `Baggage` : ajoutée (entité propre, plus un champ de Ticket)
- `User.agencyId` : ajouté (FK Agency)
- `Staff.user` : relation inverse ajoutée
- `Staff.totalDriveTimeToday` : ajouté
- `Parcel.destinationId` : FK Station (était String libre)
- `Shipment.destinationId` : FK Station (était String libre)
- `Shipment.status` : ajouté
- `Bus.version` : ajouté (optimistic lock)
- `Trip.status` : états discrets IN_PROGRESS_PAUSED, IN_PROGRESS_DELAYED
- `Ticket.status` : ajout PENDING_PAYMENT, EXPIRED
- `Ticket.qrCode` : HMAC-SHA256 signé (documenté)
- `Traveler.dropOffStationId` : FK Station
- `AuditLog` : partitionnement mensuel (migration SQL brute)

**Corrections v3.0 (PRD-ADD Integration) :**
- `User.userType` : ajouté — discriminateur `VOYAGEUR | STAFF | ANONYMOUS`
- `User.preferences` : JSONB — siège préféré, gares favorites (voyageurs uniquement)
- `User.loyaltyScore` : Float calculé (voyageurs uniquement)
- `Role` : entité formelle avec `isSystem Boolean` — plus de hardcode TypeScript
- `RolePermission` : table de mapping rôle↔permission string — source de vérité runtime
- `TripEvent` : table unifiée pour pauses/checkpoints/délais/incidents avec discriminateur `type`
- `TripEvent.claimId` : FK optionnelle vers `Claim` (pour incidents déclenchant un SAV)
- `Feedback` : table liée à `userId`, `tripId`, `driverId?`, `busId?`, `agencyId?`
- `Rating` : agrégat calculé par entité (`driverId`/`busId`/`agencyId`), mis à jour asynchroniquement
- `SafetyAlert` : alerte de conduite dangereuse avec `verificationScore` et corrélation GPS
- `CrewAssignment` : équipage par trajet avec `crewRole` et `briefedAt`
- `PublicReport` : signalement citoyen avec `reporterGpsExpireAt` (RGPD 24h TTL)
- `Campaign` : scoped tenant, liée aux voyageurs par critères
- `Trip.displayNote` : champ texte court pour les écrans d'affichage
- `Trip.displayColor` : code couleur hexadécimal pour les écrans d'affichage
- `Waypoint.gpsZone` : colonne PostGIS optionnelle (Geometry POLYGON) pour geofencing
- `Incident` : devient un sous-type de `TripEvent` via discriminateur (FK vers `TripEvent` ou tables distinctes avec interface partagée)

### VI.2 API Endpoints (Complets, v3.0)

**Convention globale :**
```
Base URL:      /api/v1/tenants/{tenantId}/...
Auth:          Cookie httpOnly (Web) | Bearer token SecureStore (Mobile)
Idempotence:   Header Idempotency-Key: {uuid} — obligatoire sur tous les POST mutants
Versioning:    /api/v1/ — évolution via nouveau préfixe /api/v2/
Erreurs:       RFC 7807 (Problem Details for HTTP APIs)
Pagination:    Cursor-based (?cursor=xxx&limit=20)
```

**Workflow (unifié)**
```
POST /api/v1/tenants/{tid}/workflow/transition   (idempotent via header)
Body: { entityType, entityId, action, context }
```

**Ticketing**
```
POST   /api/v1/tenants/{tid}/tickets                    data.ticket.create.agency
GET    /api/v1/tenants/{tid}/tickets/{id}               data.ticket.read.agency
POST   /api/v1/tenants/{tid}/tickets/{id}/verify-qr     data.ticket.scan.agency
POST   /api/v1/tenants/{tid}/tickets/{id}/cancel        data.ticket.cancel.agency
GET    /api/v1/tenants/{tid}/trips/{id}/tickets          data.ticket.read.agency
```

**Parcels**
```
POST   /api/v1/tenants/{tid}/parcels                    data.parcel.create.agency
GET    /api/v1/tenants/{tid}/parcels/{id}               data.parcel.scan.agency
GET    /api/v1/tenants/{tid}/parcels/track/{code}       (public tenant-scoped)
POST   /api/v1/tenants/{tid}/shipments                  data.shipment.group.agency
POST   /api/v1/tenants/{tid}/shipments/{id}/parcels     data.parcel.update.agency
PATCH  /api/v1/tenants/{tid}/shipments/{id}/close       data.shipment.group.agency
```

**Trips**
```
GET    /api/v1/tenants/{tid}/trips                      data.trip.read.own
POST   /api/v1/tenants/{tid}/trips                      data.trip.create.tenant
GET    /api/v1/tenants/{tid}/trips/{id}/roadbook        data.trip.read.own
POST   /api/v1/tenants/{tid}/trips/{id}/checklists      data.trip.check.own
POST   /api/v1/tenants/{tid}/trips/{id}/incidents       data.trip.report.own
POST   /api/v1/tenants/{tid}/trips/{id}/sos             data.trip.report.own (rate: 3/h)
GET    /api/v1/tenants/{tid}/trips/{id}/manifest        data.manifest.read.own
GET    /api/v1/tenants/{tid}/trips/{id}/dropoff/{sid}   data.manifest.read.own
POST   /api/v1/tenants/{tid}/trips/{id}/gps             data.trip.report.own (throttled)
```

**Fleet**
```
GET    /api/v1/tenants/{tid}/buses                      data.fleet.manage.tenant
POST   /api/v1/tenants/{tid}/buses                      control.fleet.manage.tenant
PUT    /api/v1/tenants/{tid}/buses/{id}/layout          control.fleet.layout.tenant
GET    /api/v1/tenants/{tid}/buses/available            data.fleet.status.agency
POST   /api/v1/tenants/{tid}/staff                      data.fleet.manage.tenant
GET    /api/v1/tenants/{tid}/staff                      data.user.read.agency
```

**Finance**
```
POST   /api/v1/tenants/{tid}/payments/initiate          data.ticket.create.agency
POST   /api/v1/tenants/{tid}/payments/webhook           (IP allowlisted, idempotent)
POST   /api/v1/tenants/{tid}/cash/register/open         data.cashier.open.own
POST   /api/v1/tenants/{tid}/cash/register/close        data.cashier.close.agency
GET    /api/v1/tenants/{tid}/cash/transactions          data.cashier.transaction.own
```

**Display (Public)**
```
GET    /api/v1/tenants/{tid}/stations/{id}/display      (public, tenant from path)
GET    /api/v1/tenants/{tid}/buses/{id}/display         (public, tenant from path)
```

**Safety & Feedback**
```
POST   /api/v1/tenants/{tid}/feedback                       data.feedback.submit.own
GET    /api/v1/tenants/{tid}/ratings/drivers/{staffId}      control.stats.read.tenant
GET    /api/v1/tenants/{tid}/ratings/buses/{busId}          control.stats.read.tenant
GET    /api/v1/tenants/{tid}/ratings/agencies/{agencyId}    control.stats.read.tenant
GET    /api/v1/tenants/{tid}/safety/alerts                  control.safety.monitor.global
```

**CRM**
```
GET    /api/v1/tenants/{tid}/crm/voyageurs/{userId}         data.crm.read.tenant
GET    /api/v1/tenants/{tid}/crm/voyageurs/{userId}/trips   data.crm.read.tenant
POST   /api/v1/tenants/{tid}/campaigns                      control.campaign.manage.tenant
GET    /api/v1/tenants/{tid}/campaigns                      control.campaign.manage.tenant
```

**Crew**
```
POST   /api/v1/tenants/{tid}/trips/{id}/crew                data.crew.manage.tenant
GET    /api/v1/tenants/{tid}/trips/{id}/crew                data.trip.read.own
PATCH  /api/v1/tenants/{tid}/trips/{id}/crew/{assignId}/brief   data.crew.manage.tenant
```

**Display**
```
PATCH  /api/v1/tenants/{tid}/trips/{id}/display-note        data.display.update.agency
```

**Trip Events (pauses & checkpoints)**
```
POST   /api/v1/tenants/{tid}/trips/{id}/events              control.trip.log_event.own
GET    /api/v1/tenants/{tid}/trips/{id}/events              data.trip.read.own
```

**Delays & Cancellations**
```
POST   /api/v1/tenants/{tid}/trips/{id}/delay               control.trip.delay.agency
POST   /api/v1/tenants/{tid}/trips/{id}/cancel              control.trip.cancel.tenant
```

**IAM DB-driven**
```
GET    /api/v1/tenants/{tid}/roles                          control.iam.manage.tenant
POST   /api/v1/tenants/{tid}/roles                          control.iam.manage.tenant
PATCH  /api/v1/tenants/{tid}/roles/{roleId}/permissions     control.iam.manage.tenant
```

**Public Reporter (pas sous /api/v1/tenants/ — pas d'auth requise)**
```
POST   /public/{tenantSlug}/report                          (public — IP rate limit 5/h)
GET    /public/{tenantSlug}/report/{id}/status              (public — lecture statut seul)
```

**Analytics**
```
GET    /api/v1/tenants/{tid}/stats/revenue                  control.stats.read.tenant
GET    /api/v1/tenants/{tid}/stats/punctuality              control.stats.read.tenant
GET    /api/v1/tenants/{tid}/stats/fleet-health             control.stats.read.tenant
GET    /api/v1/tenants/{tid}/stats/driver-ranking           control.stats.read.tenant
```

**Control Plane**
```
POST   /api/v1/control/tenants                          control.tenant.provision.global
POST   /api/v1/control/tenants/{tid}/modules            control.module.install.tenant
GET    /api/v1/control/tenants/{tid}/dlq                control.platform.dlq.global
POST   /api/v1/control/tenants/{tid}/dlq/{id}/replay    control.platform.dlq.global
POST   /api/v1/control/workflow/override                control.workflow.override.global
```

---

## VII. Roadmap & Règles d'Or

### VII.1 Roadmap d'Implémentation

**Phase 0 — Infrastructure & Vault (Prérequis Absolu)**
- Setup Vault HA (Raft 3 nœuds), MinIO, Redis, PostgreSQL sous Docker
- Génération certificats mTLS via Vault PKI
- Configuration réseau interne sécurisé
- Plateforme de tests complète (Jest + Testcontainers)
- Migration SQL : RLS RESTRICTIVE, partitionnement AuditLog, index critiques

**Phase 1 — Fondations (Semaines 1-4)**
- Interfaces Provider : ISecretService, IStorageService, IEventBus, IIdentityManager
- Better Auth + système permissions `{plane}.{module}.{action}.{scope}`
- Tenant Engine : middleware RLS + injection tenant_id from session
- Workflow Engine Core : moteur stateless + table WorkflowConfig seed
- PermissionGuard global + AuditLog ISO 27001
- Outbox Poller + Redis Publisher

**Phase 2 — Cœur Opérationnel (Semaines 5-8)**
- Modules : Agency, Stations, Routes, Flotte & Personnel
- Trip Manager + Roadbook
- App Chauffeur MVP : trajet + checklists
- Incident Routing : SOS → Admin
- Modules métier Trip, Ticket, Parcel avec permissions granulaires

**Phase 3 — Commercial & Finance (Semaines 9-12)**
- Pricing Engine : calcul dynamique + Yield
- Ticketing & Parcels : vente, QR HMAC, suivi logistique
- Module Caisse : Ouverture/Clôture/Audit
- Paiements : Flutterwave/Paystack + workflow remboursement
- Timeout réservation (scheduler)

**Phase 4 — Real-time & Terrain (Semaines 13-16)**
- WebSockets : GPS live + écrans de gare (Redis Adapter)
- Digital Signage : interfaces écrans départs/arrivées
- App Garage & SAV
- Intégration Entra ID/SCIM

**Phase 5 — Intelligence & Scale (Semaines 17+)**
- Analytics : dashboards financiers + opérationnels + KPI remplissage
- Notifications : moteur SMS/WhatsApp/Push + préférences
- Optimisation : cache Redis, partitionnement AuditLog, index avancés
- Monitoring centralisé : OpenTelemetry + Prometheus + alerting DLQ
- Quota Manager par tenant

### VII.2 Règles d'Or (Absolues)

**Sécurité**
- ZÉRO `process.env` dans le code — tout passe par `ISecretService`
- mTLS obligatoire pour communications inter-services (Vault PKI)
- Cookies httpOnly uniquement pour sessions web. SecureStore pour mobile.
- QR codes = HMAC-SHA256 signé avec clé Vault, jamais un CUID
- TTL des URLs signées MinIO : 15min pour données biométriques, 2h pour tickets, 24h pour étiquettes colis

**Architecture**
- Typage TypeScript strict — Enums, Types, Interfaces partout
- Zéro hardcoding des statuts, workflows, prix, taxes — tout en DB
- Provider Pattern obligatoire — aucun import SDK tiers dans le code métier
- Concurrence : `SELECT FOR UPDATE NOWAIT` + champ `version` sur entités workflow

**Permissions**
- Chaque endpoint décoré `@Permission()` obligatoirement
- `tenantId` toujours depuis la session — jamais depuis un header pour routes authentifiées
- RLS PostgreSQL en mode RESTRICTIVE — fail-closed si contexte absent
- PgBouncer en mode SESSION obligatoire

**Qualité Production**
- Idempotency-Key obligatoire sur tous les POST de mutation
- DLQ monitorée — alerte si non-vide depuis > 1 heure
- AuditLog immuable sur chaque transition ET chaque tentative d'accès refusée
- Tests d'intégration avec vraie DB (pas de mocks DB) — Testcontainers

---

## VIII. Décisions Architecturales (ADR)

| # | Décision | Choix | Raison |
|---|---|---|---|
| ADR-01 | Message Queue | Outbox PostgreSQL + Redis Pub/Sub | Portabilité, atomicité, zéro service supplémentaire, portable via IEventBus |
| ADR-02 | RLS Mode | RESTRICTIVE | Fail-closed — 0 ligne si contexte absent, jamais toutes les lignes |
| ADR-03 | Connection Pooling | PgBouncer SESSION mode | Compatible SET LOCAL pour RLS. Transaction mode casse le RLS silencieusement. |
| ADR-04 | QR Codes | HMAC-SHA256 Vault-signed | Infalsifiables, vérifiables sans DB, clé rotatable |
| ADR-05 | Sub-états Trip | États discrets dans WorkflowConfig | Compatible avec moteur stateless. IN_PROGRESS_PAUSED ≠ flag booléen. |
| ADR-06 | tenant_id source | Session uniquement | Supprime tenant-hopping via header forgé |
| ADR-07 | GPS Updates | Redis buffer + DB batch 10s | Protège DB contre write storm (N bus × 1/sec = N writes/sec) |
| ADR-08 | AuditLog | Partitionnement RANGE mensuel | Performance sur 2M+ lignes/mois. Full scan sans partition = catastrophe. |
| ADR-09 | Vault HA | Raft 3 nœuds obligatoire | Supprime le SPOF. Vault down = plateforme down. |
| ADR-10 | WebSocket Scale | Redis Pub/Sub Adapter Socket.io | Scalabilité horizontale pods. In-process adapter = non-scalable. |
| ADR-11 | Idempotence | Table WorkflowTransition + header | Double protection webhook + double-scan terrain |
| ADR-12 | Roadbook storage | JSONB en DB (pas MinIO) | Requêtable (filtrer trips par waypoint). MinIO = opaque. |
| ADR-13 | Parcel.destination | FK Station (pas String) | Guard FIELD_MATCH robuste. String libre = fragile. |
| ADR-14 | Traveler entité | Conservée séparée de Ticket | Ticket = record financier immuable. Traveler = état opérationnel mutable. |
| ADR-15 | WorkflowConfig versioning | effectiveFrom + isActive | Entités in-flight suivent config active au moment de la transition |
| ADR-16 | IAM runtime source | DB (RolePermission) + Redis cache 60s | Zéro hardcode. Permissions modifiables sans redéploiement. Cache invalide sur iam.manage. |
| ADR-17 | User.userType discriminateur | VOYAGEUR / STAFF / ANONYMOUS | Pas d'entité Customer séparée. Simplifie RLS et joins. Profile voyageur nullable jusqu'à réservation. |
| ADR-18 | TripEvent/Incident fusion | Table unique + discriminateur `type` | Interface partagée BaseEvent. Évite duplication colonnes. Claim FK optionnelle pour incidents SAV. |
| ADR-19 | PostGIS optionnel | ST_Distance si disponible, sinon haversine applicatif | Développement sans PostGIS possible. Production = PostGIS activé. Interface `IGeoService` permutable. |
| ADR-20 | PublicReport GPS TTL | reporterGpsExpireAt 24h + pg_cron delete | RGPD : données GPS collectées sans opt-in permanent — durée minimale de rétention. |
| ADR-21 | Public Reporter isolation | /public/{slug}/... séparé de /api/v1/tenants/ | Pas d'auth, rate limit IP agressif. Isolation claire des endpoints authentifiés vs publics. |
| ADR-22 | IWeatherService | Interface permutable (OpenWeatherMap default) | Smart Bus Display météo — fournisseur non critique, permutable sans modification code métier. |

---

*Fin du PRD TransLog Pro v3.0*
*Révision v2.0 : Critique architecturale complète — Avril 2026*
*Révision v3.0 : Intégration PRD-ADD (CRM, Safety, Crew, Public Reporter, IAM DB-driven) — Avril 2026*
