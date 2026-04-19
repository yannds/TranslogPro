# Workflows blueprint-driven — TransLog Pro

> Source de vérité runtime : table `workflow_configs` (`WorkflowConfig`), par tenant.
> Blueprint par défaut : `DEFAULT_WORKFLOW_CONFIGS` dans [prisma/seeds/iam.seed.ts](../prisma/seeds/iam.seed.ts).
> Chaque transition passe par `WorkflowEngine.transition()` — **aucun `update({ status: ... })` direct autorisé** sur un état métier (ADR-15 / ADR-16).

---

## Règles d'or

1. **Une entité métier en workflow** a : `id`, `status`, `tenantId`, `version` (lock optimiste) + entrée dans `AGGREGATE_TABLE_MAP` ([live-workflow.io.ts](../src/core/workflow/io/live-workflow.io.ts)).
2. **Une transition** = `(entityType, fromState, action)` → `toState` + `requiredPerm`. Résolue en DB par tenant.
3. **Guards et side-effects** sont optionnels. Les side-effects critiques DB passent par la persist callback (même transaction atomique). Les externes (notifications, webhooks) via Outbox/eventBus sideEffect (post-commit).
4. **Zéro magic number**. Tous les seuils, délais, pourcentages : `TenantBusinessConfig` (par tenant) ou `Trip.*Override` (ponctuel compagnie). Configurable via [/admin/settings/rules](../frontend/components/pages/PageTenantBusinessRules.tsx).

---

## Entités blueprint-driven (2026-04-19)

| Entité | États | Actions clés | Permission(s) principales |
|---|---|---|---|
| **Trip** | PLANNED → OPEN → BOARDING → IN_PROGRESS → COMPLETED (+ PAUSED, DELAYED, **SUSPENDED**, **CANCELLED_IN_TRANSIT**) | START_BOARDING, BEGIN_BOARDING, DEPART, PAUSE, RESUME, REPORT_INCIDENT, **SUSPEND**, **RESUME_FROM_SUSPEND**, **CANCEL_IN_TRANSIT**, **DECLARE_MAJOR_DELAY**, END_TRIP, CANCEL | `data.trip.update.agency`, `control.trip.suspend.agency`, `control.trip.cancel_in_transit.tenant`, `control.trip.declare_major_delay.agency` |
| **Ticket** | CREATED → PENDING_PAYMENT → CONFIRMED → CHECKED_IN → BOARDED → COMPLETED (+ CANCELLED, EXPIRED, **NO_SHOW**, **LATE_ARRIVED**, **REBOOKED**, **FORFEITED**, REFUND_*) | PAY, CHECK_IN, BOARD, CANCEL, **MISS_BOARDING**, **REBOOK_NEXT_AVAILABLE**, **REBOOK_LATER**, **REQUEST_REFUND**, **FORFEIT** | `data.ticket.create/cancel.agency`, `data.ticket.noshow_mark.agency`, `data.ticket.rebook.{agency,own,tenant}` |
| **Parcel** | CREATED → AT_ORIGIN → PACKED → LOADED → IN_TRANSIT → ARRIVED → DELIVERED (+ DAMAGED, LOST, RETURNED, **AT_HUB_INBOUND**, **STORED_AT_HUB**, **AT_HUB_OUTBOUND**, **AVAILABLE_FOR_PICKUP**, **DISPUTED**, **RETURN_TO_SENDER**) | ADD_TO_SHIPMENT, LOAD, DEPART, ARRIVE, DELIVER, **ARRIVE_AT_HUB**, **STORE_AT_HUB**, **LOAD_OUTBOUND**, **DEPART_FROM_HUB**, **NOTIFY_FOR_PICKUP**, **PICKUP**, **DISPUTE**, **INITIATE_RETURN**, **COMPLETE_RETURN** | `data.parcel.scan/update.agency`, `data.parcel.hub_move.agency`, `data.parcel.pickup.agency`, `data.parcel.dispute.own`, `control.parcel.return_init.tenant` |
| **Traveler** | REGISTERED → VERIFIED → CHECKED_IN → BOARDED → ARRIVED → EXITED | VERIFY, SCAN_IN, SCAN_BOARD, SCAN_OUT, EXIT | `data.traveler.verify.agency` |
| **Shipment** | OPEN → LOADED → IN_TRANSIT → ARRIVED → CLOSED | LOAD, DEPART, ARRIVE, CLOSE | `data.shipment.group.agency`, `data.trip.update.agency` |
| **Bus** | AVAILABLE/IDLE → BOARDING → DEPARTED → ARRIVED → CLOSED (+ MAINTENANCE, OUT_OF_SERVICE) | OPEN_BOARDING, DEPART, ARRIVE, CLEAN, INCIDENT_MECHANICAL, RESTORE | `data.trip.update.agency`, `data.maintenance.*` |
| **Checklist** | PENDING → TECH_CHECK → SAFETY_CHECK → DOCS_CHECK → APPROVED (+ BLOCKED) | start_tech, pass_tech, pass_safety, approve_all, fix_and_retry, complete (fast-track) | `data.maintenance.update.own`, `data.manifest.sign.agency` |
| **Manifest** | DRAFT → SUBMITTED → SIGNED → ARCHIVED (+ REJECTED) | submit, sign, reject, archive, revise | `data.manifest.generate/sign.agency` |
| **Refund** | PENDING → APPROVED → PROCESSED (+ REJECTED) | approve, auto_approve, process, reject | `data.refund.approve.{tenant,agency}`, `data.refund.process.tenant` |
| **Claim (SAV)** | OPEN → ASSIGNED → UNDER_INVESTIGATION → RESOLVED → CLOSED (+ REJECTED) | assign, investigate, resolve, reject, close | `data.sav.*` |
| **CashRegister** | CLOSED ↔ OPEN (+ DISCREPANCY) | open, close, flag, resolve | `data.cashier.open.own`, `data.cashier.close.agency` |
| **Incident** | OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED | assign, start_work, resolve, close, reopen | `data.trip.update.agency`, `data.trip.report.own` |
| **MaintenanceReport** | SCHEDULED → IN_PROGRESS → COMPLETED → APPROVED | start_work, complete, approve, reopen | `data.maintenance.*` |
| **CrewAssignment** | STANDBY → BRIEFING → ON_DUTY → DEBRIEFING → REST → STANDBY (+ SUSPENDED) | assign_briefing, start_duty, end_duty, start_rest, reinstate | `control.driver.manage.tenant`, `data.driver.rest.own` |
| **Driver** | AVAILABLE → ASSIGNED → ON_DUTY → REST_REQUIRED → RESTING → AVAILABLE (+ SUSPENDED) | assign, start_duty, end_shift, start_rest | `control.driver.manage.tenant` |
| **Invoice** ★ | DRAFT → ISSUED → PAID (+ CANCELLED) | issue, mark_paid, cancel | `data.invoice.create.agency`, `control.invoice.manage.tenant` |
| **Staff** ★ | ACTIVE ↔ SUSPENDED → ARCHIVED | suspend, reactivate, archive | `control.staff.manage.tenant` |
| **StaffAssignment** ★ | ACTIVE ↔ SUSPENDED → CLOSED | suspend, reactivate, close | `control.staff.manage.tenant` |
| **SupportTicket** ★ | OPEN → IN_PROGRESS ↔ WAITING_CUSTOMER → RESOLVED → CLOSED | start, await, resume, resolve, close, reopen | `control.platform.support.write.global` |
| **DriverTraining** ★ | PLANNED → IN_PROGRESS → COMPLETED (+ MISSED, CANCELLED) | start, complete, miss, cancel | `control.driver.manage.tenant` |
| **QhseExecution** ★ | IN_PROGRESS → COMPLETED (+ ABORTED) | complete, abort | `control.qhse.manage.tenant` |
| **Voucher** ✦ | ISSUED → REDEEMED \| EXPIRED \| CANCELLED | REDEEM, EXPIRE, CANCEL | `data.voucher.redeem.agency`, `control.voucher.cancel.tenant` |
| **CompensationItem** ✦ | OFFERED → DELIVERED \| DECLINED | DELIVER, DECLINE | `data.compensation.issue.agency` |

★ = migré de hardcoded → engine le 2026-04-19
✦ = nouveau blueprint créé le 2026-04-19

---

## Config tenant — `TenantBusinessConfig`

Champs pilotant les workflows :

### Annulation & remboursement
- `cancellationPenaltyTiers` (JSON) — array `[{hoursBeforeDeparture, penaltyPct}]`, ordre décroissant. Si vide, fallback legacy 2-tiers.
- `cancellationPenaltyAppliesTo` (JSON) — array de rôles (`CUSTOMER` | `AGENT` | `ADMIN` | `SYSTEM`). Hors liste → 0 %.
- `refundApprovalThreshold` (number) — seuil au-delà duquel seul `TENANT_ADMIN` peut approuver (vs `AGENCY_MANAGER`).
- `refundAutoApproveMax` (number) — auto-approve sous ce montant (0 = désactivé).
- `autoApproveTripCancelled` (bool) — Trip cancelled → refund 100 % auto-approuvé.
- Legacy : `cancellationFullRefundMinutes`, `cancellationPartialRefundMinutes`, `cancellationPartialRefundPct`.

### No-show / TTL billet
- `noShowGraceMinutes` — délai de grâce après heure de départ avant de pouvoir marquer NO_SHOW.
- `ticketTtlHours` — durée de validité post-départ (FORFEIT automatique après).
- `noShowPenaltyEnabled` / `noShowPenaltyPct` / `noShowPenaltyFlatAmount`.

### Incident en route & compensation
- `incidentCompensationEnabled` (bool).
- `incidentCompensationDelayTiers` (JSON) — array `[{delayMinutes, compensationPct, snackBundle?}]`.
- `incidentCompensationFormDefault` — `MONETARY` | `VOUCHER` | `MIXED` | `SNACK`.
- `incidentVoucherValidityDays` — validité des bons émis en compensation (fixée à l'émission).
- `incidentVoucherUsageScope` — `ANY_TRIP` | `SAME_ROUTE` | `SAME_COMPANY`.
- `incidentRefundProrataEnabled` — prorata km parcourus sur refund cancel in-transit.

### Colis hub / retrait
- `parcelHubMaxStorageDays` — durée max en hub (alerte + réassignation).
- `parcelPickupMaxDaysBeforeReturn` — durée max avant retour auto expéditeur.
- `parcelPickupNoShowAction` — `return` | `dispose` | `hold`.

---

## Overrides ponctuels par Trip

Permission requise : `control.trip.override_policy.tenant`. Nullables — fallback auto sur `TenantBusinessConfig`.

- `Trip.noShowPenaltyEnabledOverride` / `...PctOverride` / `...FlatAmountOverride`
- `Trip.cancellationPenaltyTiersOverride` (JSON)
- `Trip.compensationPolicyOverride` (JSON — override complet des tiers)
- `Trip.compensationFormOverride`

---

## Flow exemple : passager no-show

1. Heure `departureScheduled` atteinte + `noShowGraceMinutes` expirés.
2. Agent quai (ou scheduler) → `POST /tickets/:id/no-show` (action `MISS_BOARDING`) → engine → `NO_SHOW`. Stamp `noShowMarkedAt`, `noShowMarkedById`.
3. Passager se présente en retard → choix :
   - `POST /tickets/:id/rebook/next-available` → chercher prochain trip même route, vérifier capacité (`bus.capacity` - tickets CONFIRMED/CHECKED_IN/BOARDED). Transition `REBOOK_NEXT_AVAILABLE` → nouveau ticket CONFIRMED + ancien `REBOOKED`.
   - `POST /tickets/:id/rebook/later { newTripId }` → même garde TTL + capacité + même route.
   - `POST /tickets/:id/refund-request { reason: 'NO_SHOW' }` → calcul via `CancellationPolicyService` + pénalité no-show éventuelle → `Refund` créé + `REQUEST_REFUND` → `REFUND_PENDING`.
4. Scheduler périodique → `TicketingService.forfeitExpiredTickets` → `FORFEIT` auto si `now > departureScheduled + ticketTtlHours`.

## Flow exemple : bus en panne en route

1. Chauffeur mobile → `POST /trips/:id/incident/suspend { reason }` (perm `control.trip.suspend.agency`) → Trip → `SUSPENDED`.
2. Bus secours ou réparation → `POST /trips/:id/incident/resume` → `IN_PROGRESS`.
3. Sinon admin → `POST /trips/:id/incident/cancel-in-transit { distanceTraveledKm, totalDistanceKm, reason }` →
   - Trip → `CANCELLED_IN_TRANSIT`
   - Fan-out : pour chaque ticket actif, `Refund` créé via `RefundService.createRefund` (prorata ou 100 % selon `incidentRefundProrataEnabled`).
4. Ou retard majeur : admin → `POST /trips/:id/incident/declare-major-delay { delayMinutes }` →
   - Sélection palier dans `incidentCompensationDelayTiers`
   - Selon `incidentCompensationFormDefault` (ou override trip) : `Refund` (MONETARY), `Voucher` (VOUCHER), les deux à 50 % (MIXED), `CompensationItem` (SNACK).

---

## Invariants à respecter

- Tout nouveau blueprint → ajouter à `DEFAULT_WORKFLOW_CONFIGS` + entry dans `AGGREGATE_TABLE_MAP` + run `npx prisma migrate dev` si nouvelle table + run backfill `backfillDefaultWorkflows` pour les tenants existants.
- Toute nouvelle permission → ajouter dans [permissions.ts](../src/common/constants/permissions.ts) (const + Permission enum) + assigner aux rôles par défaut dans [iam.seed.ts](../prisma/seeds/iam.seed.ts).
- Tout état métier stocké comme `status String` dans Prisma doit avoir sa constante dans [workflow-states.ts](../src/common/constants/workflow-states.ts) (référence compile-time, jamais source de vérité runtime).
- Tests obligatoires :
  - Unit : happy path + guards échecs + cascades (ex : staff → staffAssignment).
  - Security : tentative cross-tenant, tentative de contournement appliesTo / waiver.
  - Integration Testcontainers : flows bout-en-bout (no-show → rebook, panne → refund prorata, parcel hub → pickup → return).
