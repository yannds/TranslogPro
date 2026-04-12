# TransLog Pro — Statut des Tests

> Référence partagée entre les deux développeurs.
> Mise à jour après chaque session. Dernière mise à jour : 2026-04-12.

---

## Résumé rapide

| Niveau | Commande | Suites | Tests | Statut |
|--------|----------|--------|-------|--------|
| **Unit — Engine** (src/) | `npm test` | 1 | 14 | ✅ PASS |
| **Unit — Specs** (test/unit/) | `npx jest --config jest.unit.config.ts` | 10 | 123 | ✅ PASS |
| **E2E — Endpoints** (test/e2e/) | `npm run test:e2e` | 1 | 111 | ✅ PASS |
| **Integration** (test/integration/) | `npm run test:integration -- --runInBand` | 4 | 36 | ✅ PASS |

**Total validé : 284 tests / 0 failure**

---

## NIVEAU 1 — Unit : WorkflowEngine (src/)

**Config** : `package.json#jest` → `rootDir: src`, picks `src/**/*.spec.ts`
**Commande** : `npm test`

### src/core/workflow/__tests__/workflow.engine.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | Happy path — retourne toState=BOARDED et incrémente la version |
| 2 | Happy path — appelle persist() une seule fois |
| 3 | Happy path — crée un WorkflowTransition avec l'idempotencyKey |
| 4 | aggregateType inconnu — lève BadRequestException |
| 5 | Config manquante — lève BadRequestException si aucune WorkflowConfig active |
| 6 | Permission manquante — lève ForbiddenException si le rôle ne possède pas la permission |
| 7 | Permission manquante — lève ForbiddenException si scope=agency et agencyId absent |
| 8 | Guards — lève BadRequestException si un guard retourne false |
| 9 | Guards — passe si tous les guards retournent true |
| 10 | Guards — évalue les guards dans l'ordre |
| 11 | Idempotence — retourne l'état existant sans re-persister si clé déjà connue |
| 12 | Lock optimiste — lève ConflictException si version DB ≠ entity.version |
| 13 | Lock optimiste — lève ConflictException si l'entité n'existe plus en DB |
| 14 | Audit — appelle audit.record() avec les bons champs |

---

## NIVEAU 1 — Unit : State Graph Specs (test/unit/workflow/)

**Config** : `jest.unit.config.ts` → `test/unit/**/*.spec.ts`
**Commande** : `npx jest --config jest.unit.config.ts`

### test/unit/workflow/ticket-graph.spec.ts — 15 tests ✅

| # | Description |
|---|---|
| 1 | TicketState — chaque clé correspond à sa valeur string |
| 2 | TicketState — contient les 8 états obligatoires du PRD §III.7 |
| 3 | TicketAction — chaque action est une chaîne non vide |
| 4 | TicketAction — contient les 5 actions obligatoires du PRD §III.7 |
| 5 | PAY : PENDING_PAYMENT → CONFIRMED — retourne toState=CONFIRMED |
| 6 | PAY — appelle persist() exactement une fois |
| 7 | BOARD : CONFIRMED → BOARDED — retourne toState=BOARDED |
| 8 | CANCEL : CONFIRMED → CANCELLED — retourne toState=CANCELLED |
| 9 | Transition interdite — lève BadRequestException si aucune config active |
| 10 | Permission insuffisante — lève ForbiddenException |
| 11 | Guard expiry — lève BadRequestException si guard retourne false |

### test/unit/workflow/trip-graph.spec.ts — 15 tests ✅

| # | Description |
|---|---|
| 1 | TripState — chaque clé = sa valeur string |
| 2 | TripState — contient les 8 états du PRD §III.7 |
| 3 | TripAction — contient les 9 actions du PRD §III.7 |
| 4 | ACTIVATE : PLANNED → OPEN |
| 5 | START_BOARDING : OPEN → BOARDING |
| 6 | DEPART : BOARDING → IN_PROGRESS |
| 7 | END_TRIP : IN_PROGRESS → COMPLETED |
| 8 | PAUSE : IN_PROGRESS → IN_PROGRESS_PAUSED |
| 9 | RESUME : IN_PROGRESS_PAUSED → IN_PROGRESS |
| 10 | REPORT_INCIDENT : IN_PROGRESS → IN_PROGRESS_DELAYED |
| 11 | CANCEL : PLANNED → CANCELLED |
| 12 | Transition interdite — BadRequestException si aucune config |

### test/unit/workflow/parcel-graph.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | ParcelState — chaque clé = sa valeur string |
| 2 | ParcelState — contient les 10 états du PRD §III.7 |
| 3 | ParcelAction — contient les 10 actions du PRD §III.7 |
| 4 | RECEIVE : CREATED → AT_ORIGIN (fromState vérifié) |
| 5 | ADD_TO_SHIPMENT : AT_ORIGIN → PACKED |
| 6 | ADD_TO_SHIPMENT — guard poids+destination peut bloquer |
| 7 | LOAD : PACKED → LOADED |
| 8 | DEPART : LOADED → IN_TRANSIT |
| 9 | ARRIVE : IN_TRANSIT → ARRIVED |
| 10 | DELIVER : ARRIVED → DELIVERED |
| 11 | DAMAGE depuis IN_TRANSIT → DAMAGED |
| 12 | DECLARE_LOST : IN_TRANSIT → LOST |
| 13 | RETURN : ARRIVED → RETURNED |
| 14 | Transition interdite (DELIVERED, RECEIVE) — BadRequestException |

### test/unit/workflow/bus-graph.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | BusState — chaque clé = sa valeur string |
| 2 | BusState — contient les 8 états PRD §III.7 |
| 3 | BusAction — contient les 6 actions PRD §III.7 |
| 4 | OPEN_BOARDING : IDLE → BOARDING |
| 5 | OPEN_BOARDING — guard checklist PRE_DEPARTURE peut bloquer |
| 6 | DEPART : BOARDING → DEPARTED |
| 7 | DEPART — guard manifest clos peut bloquer |
| 8 | ARRIVE : DEPARTED → ARRIVED |
| 9 | CLEAN : ARRIVED → CLOSED |
| 10 | INCIDENT_MECHANICAL depuis BOARDING → MAINTENANCE |
| 11 | INCIDENT_MECHANICAL depuis DEPARTED → MAINTENANCE |
| 12 | RESTORE : MAINTENANCE → AVAILABLE |
| 13 | Transition interdite (CLOSED, DEPART) — BadRequestException |

---

## NIVEAU 1 — Unit : Service Specs (test/unit/services/)

### test/unit/services/ticketing.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | issue() — appelle PricingEngine.calculate() avec les bons paramètres |
| 2 | issue() — crée le ticket avec status=PENDING_PAYMENT |
| 3 | issue() — retourne { ticket, pricing } avec le total calculé |
| 4 | issue() — publie un DomainEvent TICKET_ISSUED |
| 5 | confirm() — délègue au WorkflowEngine avec action=PAY |
| 6 | confirm() — génère un QR token avant la transition |
| 7 | confirm() — lève BadRequestException si ticket expiré |
| 8 | confirm() — lève NotFoundException si ticket absent |
| 9 | validate() — vérifie le QR token avant workflow.transition |
| 10 | validate() — lève BadRequestException si état non validatable |
| 11 | validate() — accepte CHECKED_IN comme état validatable |
| 12 | cancel() — délègue au WorkflowEngine avec action=CANCEL + reason |
| 13 | findOne() — retourne le ticket existant |
| 14 | findOne() — lève NotFoundException si absent |

### test/unit/services/trip.service.spec.ts — 10 tests ✅

| # | Description |
|---|---|
| 1 | create() — crée avec status=PLANNED |
| 2 | create() — convertit departureTime en Date |
| 3 | create() — utilise departureTime comme arrivalScheduled si absent |
| 4 | findAll() — retourne la liste sans filtre |
| 5 | findAll() — filtre par status si fourni |
| 6 | findOne() — retourne le trip existant |
| 7 | findOne() — lève NotFoundException si absent |
| 8 | transition() — délègue au WorkflowEngine avec aggregateType=Trip |
| 9 | transition() — passe l'idempotencyKey au WorkflowEngine |
| 10 | transition() — persist() appelle trip.update() |

### test/unit/services/parcel.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | register() — crée un colis avec status=CREATED |
| 2 | register() — retourne le colis avec un trackingCode |
| 3 | register() — trackingCode inclut préfixe 4 chars du tenantId |
| 4 | register() — publie un event PARCEL_REGISTERED |
| 5 | findOne() — retourne le colis existant |
| 6 | findOne() — lève NotFoundException si absent |
| 7 | trackByCode() — retourne le colis avec destination |
| 8 | trackByCode() — lève NotFoundException si code inconnu |
| 9 | transition() — délègue au WorkflowEngine aggregateType=Parcel |
| 10 | transition() — persist() appelle parcel.update() |
| 11 | scan() — appelle transition() avec l'action fournie |
| 12 | reportDamage() — transition avec action=REPORT_DAMAGE |

### test/unit/services/cashier.service.spec.ts — 10 tests ✅

| # | Description |
|---|---|
| 1 | openRegister() — crée une caisse si aucune ouverte |
| 2 | openRegister() — ConflictException si l'agent a déjà une caisse ouverte |
| 3 | closeRegister() — calcule finalBalance = initial + sum(transactions) |
| 4 | closeRegister() — NotFoundException si caisse absente |
| 5 | closeRegister() — ForbiddenException si scope=agency hors agence |
| 6 | closeRegister() — accepte clôture si scope=agency correspond |
| 7 | closeRegister() — finalBalance = initial si sum=null (0 transactions) |
| 8 | recordTransaction() — crée avec les bons champs |
| 9 | recordTransaction() — crée sans externalRef si non fourni |
| 10 | getDailyReport() — filtre par agencyId et plage 00:00-23:59 |

### test/unit/services/manifest.service.spec.ts — 9 tests ✅

| # | Description |
|---|---|
| 1 | generate() — retourne passengerCount=3 et parcelCount=3 |
| 2 | generate() — retourne status=DRAFT et tripId |
| 3 | generate() — storageKey format tenantId/manifests/tripId/ts.pdf |
| 4 | generate() — appelle IStorageService.getUploadUrl |
| 5 | generate() — retourne uploadUrl du storage |
| 6 | generate() — lève NotFoundException si trip absent |
| 7 | generate() — parcelCount=0 si aucun shipment |
| 8 | sign() — retourne status=SIGNED avec signedById + signedAt |
| 9 | getDownloadUrl() — délègue à IStorageService |

### test/unit/services/geo-safety.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | reportAlert() avec GPS — appelle GeoSafetyProvider.computeTripGeoScore() |
| 2 | reportAlert() — status=VERIFIED si score ≥ seuil (0.8 ≥ 0.7) |
| 3 | reportAlert() — status=PENDING si score < seuil (0.5 < 0.7) |
| 4 | reportAlert() — publie DomainEvent safety.alert |
| 5 | reportAlert() sans GPS — ne calcule pas de score geo |
| 6 | reportAlert() sans GPS — verificationScore=0 |
| 7 | reportAlert() sans GPS — status=PENDING si score=0 |
| 8 | reportAlert() — lit seuil depuis TenantConfigService (zéro magic-number) |
| 9 | reportAlert() — source=IN_APP |
| 10 | listAlerts() — retourne les alertes du tenant |
| 11 | listAlerts() — filtre par status si fourni |
| 12 | listAlerts() — ne filtre pas par status si absent |
| 13 | dismiss() — met à jour status=DISMISSED |

---

## NIVEAU 2 — E2E : Endpoints (test/e2e/)

**Config** : `jest.e2e.config.ts`
**Commande** : `npm run test:e2e`
**Infrastructure** : NestJS en mémoire, Prisma/Redis/Vault/EventBus mockés, TestAuthGuard

### test/e2e/app.e2e-spec.ts — 111 tests ✅

| Module | Tests | Endpoints couverts |
|--------|-------|--------------------|
| AUTH — PermissionGuard | 3 | 403 sans auth, 200 avec auth, route publique |
| TENANT | 5 | GET list, GET :id, POST create, PATCH suspend |
| TRIP | 5 | GET list, GET :id, GET ?status=, POST create |
| TICKETING | 7 | GET list, GET :id, POST issue, POST verify-qr, POST cancel, GET track/:code |
| FLEET | 7 | GET list, GET :id, POST create, PATCH seat-layout, PATCH status, GET display |
| PARCEL | 6 | POST register, GET :id, POST scan, POST report-damage, GET track/:code |
| CASHIER | 6 | POST open, GET :id, POST transaction, PATCH close, GET daily |
| MANIFEST | 5 | POST generate, PATCH sign, GET download, GET by-trip |
| CREW | 5 | GET list, POST assign, PATCH briefed, DELETE remove |
| FEEDBACK | 4 | POST submit, GET by-trip, GET ratings/DRIVER |
| SAFETY | 4 | POST alert, GET list, PATCH dismiss |
| INCIDENT | 6 | POST create, GET list, GET :id, PATCH assign, PATCH resolve |
| SAV | 6 | POST lost-found, POST claim, GET claims, PATCH process, POST deliver |
| NOTIFICATION | 3 | GET unread, PATCH read |
| ANALYTICS | 6 | GET dashboard, GET trips, GET revenue, GET occupancy, GET top-routes |
| CRM | 5 | GET customers, GET :id, POST campaign, GET campaigns |
| PUBLIC_REPORTER | 3 | POST report (public), GET list |
| IMPERSONATION | 4 | POST initiate, GET active, DELETE revoke |
| TRACKING | 3 | GET position, GET history |
| FLIGHT_DECK | 1 | GET schedule |
| GARAGE | 1 | GET reports |
| DLQ | 1 | GET events |
| STAFF | 1 | GET list |
| TRAVELER | 1 | GET by-trip |
| WORKFLOW | 2 | POST transition |
| DISPLAY | 1 | GET display (public) |
| VALIDATION | 2 | 400 corps invalides |
| RATE_LIMIT | 3 | Guards mockés passent en test |

---

## NIVEAU 3 — Integration : DB réelle Testcontainers

**Config** : `jest.integration.config.ts`
**Commande** : `npm run test:integration`
**Infrastructure** : PostgreSQL Testcontainers, Prisma réel, schema appliqué via `prisma db push`

| Fichier | Tests | Statut |
|---------|-------|--------|
| test/integration/workflow.engine.integration-spec.ts | 6 | ✅ PASS |
| test/integration/sequences/ticket-lifecycle.spec.ts | 9 | ✅ PASS |
| test/integration/sequences/trip-lifecycle.spec.ts | 12 | ✅ PASS |
| test/integration/sequences/parcel-lifecycle.spec.ts | 9 | ✅ PASS |

---

## Roadmap tests

| Break | Contenu | Statut |
|-------|---------|--------|
| BREAK 1 | Structure dossiers, jest.unit.config.ts | ✅ FAIT |
| BREAK 2 | 4 State Graph Specs (ticket, trip, parcel, bus) | ✅ FAIT |
| BREAK 3 | 6 Service Specs (ticketing, trip, parcel, cashier, manifest, safety) | ✅ FAIT |
| BREAK 4 | Setup integration : Testcontainers + seed + jest.integration.config.ts | ✅ FAIT |
| BREAK 5 | 4 Integration Specs : engine + 3 lifecycles | ✅ FAIT |
| BREAK 6 | Validation finale : unit + integration + e2e = 0 failure | ✅ FAIT |
