# TransLog Pro — Statut des Tests

> Référence partagée entre les deux développeurs.
> Mise à jour après chaque session. Dernière mise à jour : 2026-04-15.

### Ajouts 2026-04-15 — Invariant Agency + AgencyModule
- `test/unit/services/agency.service.spec.ts` — 13 tests (CRUD + invariant ≥1 agence par tenant)
- `test/unit/services/onboarding.service.spec.ts` — 5 tests (agence par défaut "Siège"/"Headquarters" créée AVANT l'admin, HMAC Vault, slug déjà pris)
- `test/integration/agency/agency-crud.spec.ts` — 4 tests (DB réelle : détachement users sur remove, FK station)
- `test/e2e/app.e2e-spec.ts` — +5 tests section `[AGENCY]` (403/200/201/400/409 dernière agence)
- Suite intégration complète : **40/40 passed** après ajout (aucune régression).

---

## Résumé rapide

| Niveau | Commande | Suites | Tests | Statut |
|--------|----------|--------|-------|--------|
| **Unit — Engine** (src/) | `npm test` | 11 | 129 | ⚠️ 127 PASS / 2 pre-existing failures (WorkflowEngine audit) |
| **Unit — Specs** (test/unit/) | `npx jest --config jest.unit.config.ts` | 12 | 172 | ✅ PASS |
| **E2E — Endpoints** (test/e2e/) | `npm run test:e2e` | 1 | 124 | ✅ PASS |
| **Integration** (test/integration/) | `npm run test:integration -- --runInBand` | 4 | 36 | ✅ PASS |

**Total validé (hors pre-existing) : 459 tests / 0 new failure**

> ⚠️ **2 failures pre-existing** dans `workflow.engine.spec.ts` (tests n°3 et 14 — WorkflowTransition idempotencyKey et audit.record) — présents avant cette session, non introduits par les changements v5.0 / v6.0.

### Ajouts v4.0 (Avril 2026)
- `src/modules/pricing/__tests__/cost-calculator.engine.spec.ts` — 25 tests (pure engine)
- `test/unit/services/profitability.service.spec.ts` — 14 tests
- `test/unit/services/white-label.service.spec.ts` — 16 tests
- `test/e2e/app.e2e-spec.ts` — +13 tests (sections 29 WHITE_LABEL + 30 PRICING)

### Ajouts v5.0 (Avril 2026)
- `src/modules/fleet-docs/__tests__/fleet-docs.service.spec.ts` — 14 tests (helpers _computeDocStatus, _computeConsumableStatus)
- `src/modules/scheduling-guard/__tests__/scheduling-guard.service.spec.ts` — 17 tests (checkAssignability : bus + driver + combiné)
- `src/modules/crew-briefing/__tests__/crew-briefing.service.spec.ts` — 13 tests (allEquipmentOk, erreurs)
- `src/modules/driver-profile/__tests__/driver-profile.service.spec.ts` — 13 tests (_computeLicenseStatus, checkRestCompliance, evaluateRemediationForDriver)
- `src/core/iam/guards/__tests__/module.guard.spec.ts` — 8 tests (cache hit/miss, DB active/inactive, invalidation)

### Ajouts v6.0 (Avril 2026 — Sprint 1 Workflow Studio + Sprint 2 Admin Panel)
- `src/modules/workflow-studio/__tests__/workflow-studio.service.spec.ts` — 13 tests (simulateWorkflow paths/blocages, createBlueprint validation/slug, getBlueprint/delete)
- `src/modules/analytics/__tests__/analytics.service.spec.ts` — 4 tests (getDashboard agrégats, scope agency, revenue null)
- `src/modules/pricing/__tests__/profitability.service.spec.ts` — 7 tests (getProfitabilitySummary agrégats/byTag/période vide, upsertCostProfile NotFoundException)
- `src/modules/white-label/__tests__/white-label.service.spec.ts` — 9 tests (getBrand cache hit/miss/défauts, upsert cache invalidation, remove NotFoundException, buildStyleTag CSS)

---

## NIVEAU 1 — Unit : WorkflowEngine + CostCalculatorEngine (src/)

**Config** : `package.json#jest` → `rootDir: src`, picks `src/**/*.spec.ts`
**Commande** : `npm test`

### src/modules/pricing/__tests__/cost-calculator.engine.spec.ts — 25 tests ✅

| # | Description |
|---|---|
| 1 | computeCosts() — fuelCost = (consumption/100) × distance × fuelPrice |
| 2 | computeCosts() — adBlueCost = fuelVolume × ratio × (adBluePrice/fuelPrice) |
| 3 | computeCosts() — maintenanceCost = maintenanceCostPerKm × distanceKm (km-based ADR-23) |
| 4 | computeCosts() — maintenanceCost = 0 si distance = 0 |
| 5 | computeCosts() — stationFee = stationFeePerDeparture (constant par départ) |
| 6 | computeCosts() — tollFees et driverAllowance = valeurs fixes |
| 7 | computeCosts() — totalVariableCost = somme des 6 coûts variables |
| 8 | computeCosts() — driverDailyCost = salary / avgTripsPerMonth |
| 9 | computeCosts() — insuranceDailyCost = annualInsurance / 365 |
| 10 | computeCosts() — depreciationDaily = (purchase-residual) / years / 365 |
| 11 | computeCosts() — totalCost = totalVariable + totalFixed |
| 12 | computeCosts() — avgTripsPerMonth=0 protégé contre division par zéro |
| 13 | computeCosts() — depreciationYears=0 protégé contre division par zéro |
| 14 | computeCosts() — adBlueCost=0 si adBlueRatioFuel=0 |
| 15 | computeMargins() — operationalMargin = totalRevenue - totalVariableCost |
| 16 | computeMargins() — agencyCommission = ticketRevenue × rate |
| 17 | computeMargins() — netTenantRevenue = totalRevenue - agencyCommission |
| 18 | computeMargins() — netMargin = netTenantRevenue - totalCost |
| 19 | computeMargins() — fillRate = bookedSeats / totalSeats |
| 20 | computeMargins() — fillRate = 0 si totalSeats = 0 |
| 21 | computeMargins() — breakEvenSeats = ceil(totalCost / avgTicketPrice) |
| 22 | computeMargins() — tag PROFITABLE si marge clairement positive |
| 23 | computeMargins() — tag DEFICIT si revenu = 0 |
| 24 | computeMargins() — tag BREAK_EVEN autour du seuil |
| 25 | DEFAULT_BUSINESS_CONSTANTS — valeurs attendues (365, 0.05, 0.03) |

### src/core/workflow/__tests__/workflow.engine.spec.ts — 14 tests ⚠️ (12 PASS / 2 pre-existing failures)

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

---

## NIVEAU 1 — Unit : Modules RH & Sécurité (src/ — v5.0)

### src/modules/fleet-docs/__tests__/fleet-docs.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | _computeDocStatus() — MISSING si expiresAt undefined |
| 2 | _computeDocStatus() — EXPIRED si date dans le passé |
| 3 | _computeDocStatus() — EXPIRING si dans la fenêtre d'alerte (15j restants, alert=30j) |
| 4 | _computeDocStatus() — VALID si hors fenêtre d'alerte (60j restants, alert=30j) |
| 5 | _computeDocStatus() — EXPIRING exactement à la limite d'alerte |
| 6 | _computeDocStatus() — VALID un jour avant la fenêtre d'alerte |
| 7 | _computeConsumableStatus() — ALERT si jamais remplacé (null) |
| 8 | _computeConsumableStatus() — OK si très loin du prochain remplacement |
| 9 | _computeConsumableStatus() — ALERT si dans la fenêtre d'alerte |
| 10 | _computeConsumableStatus() — OVERDUE si kilométrage nominal dépassé |
| 11 | _computeConsumableStatus() — OVERDUE exactement à nextDueKm |
| 12 | _computeConsumableStatus() — ALERT exactement à alertAtKm |
| 13 | _computeConsumableStatus() — OK un km avant la fenêtre d'alerte |
| 14 | _computeConsumableStatus() — OK si km actuel < lastReplacedKm (correction odomètre) |

### src/modules/scheduling-guard/__tests__/scheduling-guard.service.spec.ts — 17 tests ✅

| # | Description |
|---|---|
| 1 | Bus — bloque BUS_MAINTENANCE si status=MAINTENANCE_REQUIRED |
| 2 | Bus — bloque BUS_OUT_OF_SERVICE si status=OUT_OF_SERVICE |
| 3 | Bus — bloque BUS_OUT_OF_SERVICE si status=RETIRED |
| 4 | Bus — bloque BUS_OUT_OF_SERVICE si bus introuvable |
| 5 | Bus — bloque BUS_DOCUMENT_EXPIRED si doc obligatoire expiré |
| 6 | Bus — ne bloque pas si bus ACTIVE et aucun doc expiré |
| 7 | Driver — bloque DRIVER_REST_REQUIRED si période ouverte avec temps restant |
| 8 | Driver — ne bloque pas si période de repos terminée (temps écoulé >= minRest) |
| 9 | Driver — ne bloque pas le repos si aucune config tenant |
| 10 | Driver — bloque DRIVER_SUSPENDED si action PENDING |
| 11 | Driver — bloque DRIVER_LICENSE_EXPIRED si aucun permis D/EC/D+E trouvé |
| 12 | Driver — bloque DRIVER_LICENSE_EXPIRED si permis D expiré |
| 13 | Combiné — cumule BUS_MAINTENANCE + DRIVER_SUSPENDED |
| 14 | Combiné — canAssign=true si bus OK et driver OK |
| 15 | Cas vide — canAssign=true si ni busId ni staffId fournis |

### src/modules/crew-briefing/__tests__/crew-briefing.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | createBriefing() — allEquipmentOk=true si tous items OK avec bonne qté |
| 2 | createBriefing() — allEquipmentOk=false si un équipement obligatoire absent |
| 3 | createBriefing() — allEquipmentOk=false si un item est ok=false |
| 4 | createBriefing() — allEquipmentOk=false si qty insuffisante |
| 5 | createBriefing() — recense plusieurs manquants dans missingEquipmentCodes |
| 6 | createBriefing() — publie CREW_BRIEFING_COMPLETED si conforme |
| 7 | createBriefing() — publie CREW_BRIEFING_EQUIPMENT_MISSING si non conforme |
| 8 | createBriefing() — lève NotFoundException si assignment introuvable |
| 9 | createBriefing() — lève BadRequestException si briefing déjà existant |

### src/modules/driver-profile/__tests__/driver-profile.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | _computeLicenseStatus() — EXPIRED si date dans le passé |
| 2 | _computeLicenseStatus() — EXPIRING si dans la fenêtre d'alerte |
| 3 | _computeLicenseStatus() — VALID si hors fenêtre d'alerte |
| 4 | checkRestCompliance() — canDrive=false si période ouverte récente |
| 5 | checkRestCompliance() — canDrive=true si temps de repos déjà dépassé |
| 6 | checkRestCompliance() — canDrive=true si aucun historique (premier trajet) |
| 7 | checkRestCompliance() — canDrive=false si dernier repos trop ancien (> maxDrivingMinutes) |
| 8 | evaluateRemediationForDriver() — tableau vide si aucune règle |
| 9 | evaluateRemediationForDriver() — tableau vide si DB ne retourne aucune règle (seuil non atteint) |
| 10 | evaluateRemediationForDriver() — déclenche règle si score en dessous du seuil |
| 11 | evaluateRemediationForDriver() — ignore doublon (action PENDING existante) |

### src/core/iam/guards/__tests__/module.guard.spec.ts — 8 tests ✅

| # | Description |
|---|---|
| 1 | Laisse passer si @RequireModule absent |
| 2 | Laisse passer sur cache hit active (Redis = '1') |
| 3 | ForbiddenException sur cache hit inactive (Redis = '0') |
| 4 | Laisse passer si DB isActive=true (cache miss) + remplit cache |
| 5 | ForbiddenException si DB isActive=false + remplit cache '0' |
| 6 | ForbiddenException si module absent de la table |
| 7 | ForbiddenException si tenantId manquant sur la requête |
| 8 | invalidateModuleCache() — appelle redis.del avec la bonne clé |

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

### test/unit/services/profitability.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | upsertCostProfile() — appelle busCostProfile.upsert() avec les bons champs |
| 2 | upsertCostProfile() — lève NotFoundException si bus introuvable |
| 3 | upsertCostProfile() — applique les défauts adBlue et maintenanceCostPerKm |
| 4 | computeAndSnapshot() — retourne le snapshot existant sans recalculer (idempotence) |
| 5 | computeAndSnapshot() — lève NotFoundException si trip introuvable |
| 6 | computeAndSnapshot() — lève BadRequestException si pas de BusCostProfile |
| 7 | computeAndSnapshot() — crée snapshot avec profitabilityTag valide |
| 8 | computeAndSnapshot() — appelle ticket.aggregate et transaction.aggregate |
| 9 | computeAndSnapshot() — utilise DEFAULT_BUSINESS_CONSTANTS si TenantBusinessConfig null |
| 10 | computeAndSnapshot() — appelle tripCostSnapshot.create() une seule fois |
| 11 | getProfitabilitySummary() — retourne totalRevenue et totalCost agrégés |
| 12 | getProfitabilitySummary() — retourne byTag avec count par profitabilityTag |
| 13 | getProfitabilitySummary() — avgFillRate=0 si aucun snapshot |
| 14 | getProfitabilitySummary() — totalOperationalMargin présent dans le résumé |

### test/unit/services/white-label.service.spec.ts — 16 tests ✅

| # | Description |
|---|---|
| 1 | getBrand() — retourne le cache Redis si présent (cache-first) |
| 2 | getBrand() — lit la DB si cache vide |
| 3 | getBrand() — stocke en cache Redis TTL 300s après lecture DB |
| 4 | getBrand() — retourne null si aucune marque configurée |
| 5 | upsert() — appelle tenantBrand.upsert() avec les bons champs |
| 6 | upsert() — invalide le cache après upsert |
| 7 | remove() — supprime la marque et invalide le cache |
| 8 | buildStyleTag() — génère un bloc `<style data-tenant-brand>` valide |
| 9 | buildStyleTag() — inclut customCss si présent |
| 10 | buildStyleTag() — filtre @import dans customCss |
| 11 | buildStyleTag() — filtre url() dans customCss |
| 12 | buildStyleTag() — filtre javascript: dans customCss |
| 13 | buildThemeTokens() — retourne tokens CSS --color-primary et --color-bg |

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
| WHITE_LABEL | 6 | GET brand, GET style, GET tokens, PUT brand, DELETE brand |
| PRICING | 7 | GET cost-profile, PUT cost-profile, POST snapshot, GET snapshot, GET yield, GET summary |

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

## NIVEAU 1 — Ajouts v6.0 (Sprint 1 Workflow Studio + Sprint 2 Admin Panel)

### src/modules/workflow-studio/__tests__/workflow-studio.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | simulateWorkflow() — retourne le chemin complet quand toutes les transitions réussissent |
| 2 | simulateWorkflow() — stoppe au premier blocage de permission |
| 3 | simulateWorkflow() — retourne reachable=false pour une transition inexistante dans l'état courant |
| 4 | simulateWorkflow() — simule depuis un blueprint (blueprintId fourni) |
| 5 | simulateWorkflow() — lance NotFoundException si blueprintId fourni mais blueprint introuvable |
| 6 | createBlueprint() — crée un blueprint valide |
| 7 | createBlueprint() — lance BadRequestException si slug déjà existant pour ce tenant |
| 8 | createBlueprint() — lance BadRequestException si le graphe est invalide (graphe vide) |
| 9 | getBlueprint() — lance NotFoundException si le blueprint est introuvable |
| 10 | getBlueprint() — retourne le blueprint si accessible |
| 11 | deleteBlueprint() — lance ForbiddenException quand on tente de supprimer un blueprint système |
| 12 | deleteBlueprint() — supprime un blueprint non-système possédé par le tenant |
| 13 | listEntityTypes() — retourne les entityTypes distincts du tenant |

### src/modules/analytics/__tests__/analytics.service.spec.ts — 4 tests ✅

| # | Description |
|---|---|
| 1 | getDashboard() — retourne les agrégats corrects pour un tenant |
| 2 | getDashboard() — retourne revenue.total=0 quand transaction.aggregate retourne null |
| 3 | getDashboard() — filtre les tickets/transactions par agencyId quand le scope est agency |
| 4 | getDashboard() — ne filtre pas par agencyId quand l'agencyId n'est pas fourni |

### src/modules/pricing/__tests__/profitability.service.spec.ts — 7 tests ✅

| # | Description |
|---|---|
| 1 | getProfitabilitySummary() — retourne les agrégats corrects sur une période avec données |
| 2 | getProfitabilitySummary() — calcule globalNetMarginRate = totalNetMargin / totalCost |
| 3 | getProfitabilitySummary() — retourne globalNetMarginRate=0 quand totalCost=0 |
| 4 | getProfitabilitySummary() — agrège correctement les counts par tag |
| 5 | getProfitabilitySummary() — retourne zéros et byTag vide quand aucun snapshot sur la période |
| 6 | getProfitabilitySummary() — retourne la période passée en paramètre |
| 7 | upsertCostProfile() — lance NotFoundException si le bus est introuvable |

### src/modules/white-label/__tests__/white-label.service.spec.ts — 9 tests ✅

| # | Description |
|---|---|
| 1 | getBrand() — retourne le brand depuis le cache Redis si présent |
| 2 | getBrand() — charge depuis la DB si pas de cache et met en cache (TTL 300s) |
| 3 | getBrand() — retourne les valeurs par défaut si aucun TenantBrand en DB |
| 4 | upsert() — invalide le cache après mise à jour |
| 5 | upsert() — appelle prisma.tenantBrand.upsert avec les données du DTO |
| 6 | remove() — lance NotFoundException si aucune config de marque pour ce tenant |
| 7 | remove() — invalide le cache après suppression |
| 8 | buildStyleTag() — génère un bloc `<style>` avec les CSS custom properties |
| 9 | buildStyleTag() — injecte le customCss du tenant après les variables |

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
| **BREAK 7 — v4.0** | CostCalculatorEngine pure spec (25 tests) + ProfitabilityService spec (14) + WhiteLabelService spec (16) + e2e sections 29-30 (13 tests) | ✅ FAIT |
| **BREAK 8 — v5.0** | FleetDocsService spec (14) + SchedulingGuardService spec (17) + CrewBriefingService spec (13) + DriverProfileService spec (13) + ModuleGuard spec (8) = 65 nouveaux tests | ✅ FAIT |
| **BREAK 9 — v6.0** | WorkflowStudioService spec (13) + AnalyticsService spec (4) + ProfitabilityService spec (7) + WhiteLabelService spec (9) = 33 nouveaux tests | ✅ FAIT |
