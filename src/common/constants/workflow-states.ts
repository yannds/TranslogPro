/**
 * États discrets des entités — RÉFÉRENCES COMPILE-TIME uniquement.
 * Aligné sur le PRD v3.0 §III.7 (workflows majeurs).
 *
 * RÈGLE : Les transitions valides sont définies dans WorkflowConfig(DB) par tenant.
 * Ces constantes servent uniquement comme références de chaînes type-safe dans le code.
 * La source de vérité runtime est la DB — jamais ces enums.
 * Même principe que les constantes de Permission.
 */

// ─── Trip ─────────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Trajet
export const TripState = {
  PLANNED:              'PLANNED',             // Trip créé, resources assignées
  OPEN:                 'OPEN',                // Ouverture boarding autorisée (checklist PRE_DEPARTURE OK)
  BOARDING:             'BOARDING',            // Passagers en cours d'embarquement
  IN_PROGRESS:          'IN_PROGRESS',         // Bus en route
  IN_PROGRESS_PAUSED:   'IN_PROGRESS_PAUSED',  // Pause technique (état discret)
  IN_PROGRESS_DELAYED:  'IN_PROGRESS_DELAYED', // Incident déclaré (état discret)
  SUSPENDED:            'SUSPENDED',           // Panne bus en route / incident majeur — attente décision (bus secours ? cancel ?)
  COMPLETED:            'COMPLETED',           // Arrivée confirmée
  CANCELLED:            'CANCELLED',           // Annulé avant départ
  CANCELLED_IN_TRANSIT: 'CANCELLED_IN_TRANSIT',// Annulé alors que le bus était déjà parti (prorata km + compensation)
} as const;
export type TripState = typeof TripState[keyof typeof TripState];

// Actions Trip (verbes de transition — passés au WorkflowEngine)
export const TripAction = {
  ACTIVATE:            'ACTIVATE',           // PLANNED
  START_BOARDING:      'START_BOARDING',     // OPEN
  BEGIN_BOARDING:      'BEGIN_BOARDING',     // BOARDING
  DEPART:              'DEPART',             // IN_PROGRESS
  PAUSE:               'PAUSE',              // IN_PROGRESS_PAUSED
  RESUME:              'RESUME',             // IN_PROGRESS (depuis PAUSED)
  REPORT_INCIDENT:     'REPORT_INCIDENT',    // IN_PROGRESS_DELAYED
  CLEAR_INCIDENT:      'CLEAR_INCIDENT',     // IN_PROGRESS (depuis DELAYED)
  SUSPEND:             'SUSPEND',            // IN_PROGRESS → SUSPENDED (panne majeure, attente décision)
  RESUME_FROM_SUSPEND: 'RESUME_FROM_SUSPEND',// SUSPENDED → IN_PROGRESS (bus secours dispo, réparation faite)
  CANCEL_IN_TRANSIT:   'CANCEL_IN_TRANSIT',  // IN_PROGRESS | IN_PROGRESS_DELAYED | SUSPENDED → CANCELLED_IN_TRANSIT
  DECLARE_MAJOR_DELAY: 'DECLARE_MAJOR_DELAY',// Déclenche compensation selon tiers délai (snack / voucher / %refund)
  END_TRIP:            'END_TRIP',           // COMPLETED
  CANCEL:              'CANCEL',             // CANCELLED (avant départ)
} as const;
export type TripAction = typeof TripAction[keyof typeof TripAction];

// ─── Ticket ───────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Billet (+ scénarios no-show / rebook / compensation 2026-04-19)
export const TicketState = {
  CREATED:          'CREATED',
  PENDING_PAYMENT:  'PENDING_PAYMENT',  // Timeout 15min (configurable par tenant)
  CONFIRMED:        'CONFIRMED',
  CHECKED_IN:       'CHECKED_IN',
  BOARDED:          'BOARDED',
  COMPLETED:        'COMPLETED',
  CANCELLED:        'CANCELLED',
  EXPIRED:          'EXPIRED',          // Timeout PENDING_PAYMENT dépassé
  // No-show / rebook (scénarios 2026-04-19)
  NO_SHOW:          'NO_SHOW',          // Passager n'a pas embarqué avant la période de grâce post-départ
  LATE_ARRIVED:     'LATE_ARRIVED',     // Passager arrive après départ mais avant TTL — éligible rebook
  REBOOKED:         'REBOOKED',         // Billet réémis sur un autre trajet (next available ou later)
  FORFEITED:        'FORFEITED',        // Billet perdu (TTL dépassé, aucune action prise)
  // Workflow remboursement
  REFUND_PENDING:   'REFUND_PENDING',
  REFUND_PROCESSING:'REFUND_PROCESSING',
  REFUNDED:         'REFUNDED',
  REFUND_FAILED:    'REFUND_FAILED',
} as const;
export type TicketState = typeof TicketState[keyof typeof TicketState];

export const TicketAction = {
  CREATE:                'CREATE',
  RESERVE:               'RESERVE',
  PAY:                   'PAY',
  EXPIRE:                'EXPIRE',                 // déclenché par scheduler (timeout paiement)
  CHECK_IN:              'CHECK_IN',
  BOARD:                 'BOARD',
  FINALIZE:              'FINALIZE',               // side effect de Trip.COMPLETED
  CANCEL:                'CANCEL',
  REFUND:                'REFUND',
  // Nouveaux (2026-04-19)
  MISS_BOARDING:         'MISS_BOARDING',          // CONFIRMED/CHECKED_IN → NO_SHOW (après grâce configurée)
  MARK_LATE_ARRIVED:     'MARK_LATE_ARRIVED',      // NO_SHOW → LATE_ARRIVED (le passager finit par se présenter)
  REBOOK_NEXT_AVAILABLE: 'REBOOK_NEXT_AVAILABLE',  // NO_SHOW/LATE_ARRIVED → REBOOKED (prochain trip même route/jour, place dispo)
  REBOOK_LATER:          'REBOOK_LATER',           // NO_SHOW/LATE_ARRIVED → REBOOKED (date future, guard TTL)
  REQUEST_REFUND:        'REQUEST_REFUND',         // NO_SHOW/LATE_ARRIVED/CONFIRMED → REFUND_PENDING
  FORFEIT:               'FORFEIT',                // Auto NO_SHOW/LATE_ARRIVED → FORFEITED (TTL dépassé)
  COMPENSATE:            'COMPENSATE',             // CONFIRMED/BOARDED → trigger compensation (voucher/refund/snack)
} as const;
export type TicketAction = typeof TicketAction[keyof typeof TicketAction];

// ─── Parcel ───────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Colis + hubs/entrepôts (2026-04-19)
// Étapes hub : un colis peut passer par un entrepôt intermédiaire avant livraison
// (bus-nodal), être mis en attente retrait à destination, retourné expéditeur, etc.
export const ParcelState = {
  CREATED:               'CREATED',               // Enregistrement initial
  AT_ORIGIN:             'AT_ORIGIN',             // Reçu physiquement à l'agence d'origine
  PACKED:                'PACKED',                // Ajouté à un Shipment
  LOADED:                'LOADED',                // Chargé dans le bus
  IN_TRANSIT:            'IN_TRANSIT',            // Bus en route (auto via side effect Trip.DEPART)
  AT_HUB_INBOUND:        'AT_HUB_INBOUND',        // Arrivé dans un hub intermédiaire (scan)
  STORED_AT_HUB:         'STORED_AT_HUB',         // Stocké dans l'entrepôt, en attente retransfert
  AT_HUB_OUTBOUND:       'AT_HUB_OUTBOUND',       // Chargé sur bus sortant du hub vers destination finale
  ARRIVED:               'ARRIVED',               // Arrivé à destination (scan)
  AVAILABLE_FOR_PICKUP:  'AVAILABLE_FOR_PICKUP',  // Prêt à être retiré par destinataire (notifié)
  DELIVERED:             'DELIVERED',             // Remis au destinataire
  DAMAGED:               'DAMAGED',               // Déclaré endommagé (déclenche SAV + WhatsApp)
  LOST:                  'LOST',                  // Déclaré perdu
  DISPUTED:              'DISPUTED',              // Contestation destinataire (SAV ouvert)
  RETURN_TO_SENDER:      'RETURN_TO_SENDER',      // En cours de retour vers expéditeur (pas retiré avant TTL)
  RETURNED:              'RETURNED',              // Retourné à l'expéditeur (final)
} as const;
export type ParcelState = typeof ParcelState[keyof typeof ParcelState];

export const ParcelAction = {
  PACK:                   'PACK',                   // → CREATED
  RECEIVE:                'RECEIVE',                // → AT_ORIGIN
  ADD_TO_SHIPMENT:        'ADD_TO_SHIPMENT',        // → PACKED (guard: poids + destination)
  LOAD:                   'LOAD',                   // → LOADED
  DEPART:                 'DEPART',                 // → IN_TRANSIT (side effect Trip.DEPART)
  ARRIVE:                 'ARRIVE',                 // → ARRIVED
  DELIVER:                'DELIVER',                // → DELIVERED
  DAMAGE:                 'DAMAGE',                 // → DAMAGED (any state)
  DECLARE_LOST:           'DECLARE_LOST',           // → LOST
  RETURN:                 'RETURN',                 // → RETURNED (final)
  // Hub / entrepôt (2026-04-19)
  ARRIVE_AT_HUB:          'ARRIVE_AT_HUB',          // IN_TRANSIT → AT_HUB_INBOUND
  STORE_AT_HUB:           'STORE_AT_HUB',           // AT_HUB_INBOUND → STORED_AT_HUB
  LOAD_OUTBOUND:          'LOAD_OUTBOUND',          // STORED_AT_HUB → AT_HUB_OUTBOUND
  DEPART_FROM_HUB:        'DEPART_FROM_HUB',        // AT_HUB_OUTBOUND → IN_TRANSIT (nouveau leg)
  NOTIFY_FOR_PICKUP:      'NOTIFY_FOR_PICKUP',      // ARRIVED → AVAILABLE_FOR_PICKUP (notification envoyée)
  PICKUP:                 'PICKUP',                 // AVAILABLE_FOR_PICKUP → DELIVERED (destinataire retire)
  DISPUTE:                'DISPUTE',                // DELIVERED/AVAILABLE_FOR_PICKUP → DISPUTED
  INITIATE_RETURN:        'INITIATE_RETURN',        // AVAILABLE_FOR_PICKUP → RETURN_TO_SENDER (TTL ou demande expéditeur)
  COMPLETE_RETURN:        'COMPLETE_RETURN',        // RETURN_TO_SENDER → RETURNED
} as const;
export type ParcelAction = typeof ParcelAction[keyof typeof ParcelAction];

// ─── Traveler ─────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Voyageur
export const TravelerState = {
  REGISTERED: 'REGISTERED',
  VERIFIED:   'VERIFIED',    // Identité vérifiée
  CHECKED_IN: 'CHECKED_IN', // Scan billet en gare
  BOARDED:    'BOARDED',    // Embarqué dans le bus
  ARRIVED:    'ARRIVED',    // Déchargé à station de destination
  EXITED:     'EXITED',     // Sortie physique validée
} as const;
export type TravelerState = typeof TravelerState[keyof typeof TravelerState];

export const TravelerAction = {
  VERIFY:      'VERIFY',
  SCAN_IN:     'SCAN_IN',
  SCAN_BOARD:  'SCAN_BOARD',
  SCAN_OUT:    'SCAN_OUT',
  EXIT:        'EXIT',
} as const;
export type TravelerAction = typeof TravelerAction[keyof typeof TravelerAction];

// ─── Bus ──────────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Bus
export const BusState = {
  AVAILABLE:   'AVAILABLE',
  IDLE:        'IDLE',
  BOARDING:    'BOARDING',
  DEPARTED:    'DEPARTED',
  ARRIVED:     'ARRIVED',
  CLOSED:      'CLOSED',       // Post-trip checklist terminée
  MAINTENANCE: 'MAINTENANCE',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
} as const;
export type BusState = typeof BusState[keyof typeof BusState];

export const BusAction = {
  OPEN_BOARDING:       'OPEN_BOARDING',       // IDLE → BOARDING (guards: checklist PRE_DEPARTURE)
  DEPART:              'DEPART',              // BOARDING → DEPARTED (guards: manifest clos)
  ARRIVE:              'ARRIVE',              // DEPARTED → ARRIVED
  CLEAN:               'CLEAN',              // ARRIVED → CLOSED (guards: POST_TRIP checklist)
  INCIDENT_MECHANICAL: 'INCIDENT_MECHANICAL',// * → MAINTENANCE
  RESTORE:             'RESTORE',            // MAINTENANCE → AVAILABLE (guard: approve)
} as const;
export type BusAction = typeof BusAction[keyof typeof BusAction];

// ─── Claim (SAV) — PRD §IV.12 workflow réclamation ───────────────────────────
export const ClaimState = {
  OPEN:                'OPEN',
  UNDER_INVESTIGATION: 'UNDER_INVESTIGATION',
  RESOLVED:            'RESOLVED',
  REJECTED:            'REJECTED',
  CLOSED:              'CLOSED',
} as const;
export type ClaimState = typeof ClaimState[keyof typeof ClaimState];

export const ClaimAction = {
  INVESTIGATE: 'INVESTIGATE',
  RESOLVE:     'RESOLVE',
  REJECT:      'REJECT',
  CLOSE:       'CLOSE',
} as const;
export type ClaimAction = typeof ClaimAction[keyof typeof ClaimAction];

// ─── Refund — PRD §IV.12 remboursements ──────────────────────────────────────
export const RefundState = {
  PENDING:   'PENDING',
  APPROVED:  'APPROVED',
  PROCESSED: 'PROCESSED',
  REJECTED:  'REJECTED',
} as const;
export type RefundState = typeof RefundState[keyof typeof RefundState];

export const RefundAction = {
  APPROVE:      'approve',
  REJECT:       'reject',
  PROCESS:      'process',
  AUTO_APPROVE: 'auto_approve',
} as const;
export type RefundAction = typeof RefundAction[keyof typeof RefundAction];

export const RefundReason = {
  CLIENT_CANCEL:          'CLIENT_CANCEL',
  TRIP_CANCELLED:         'TRIP_CANCELLED',
  CUSTOMER_SELF_SERVICE:  'CUSTOMER_SELF_SERVICE',
  NO_SHOW:                'NO_SHOW',                // Passager absent — refund éventuel selon config tenant
  INCIDENT_IN_TRANSIT:    'INCIDENT_IN_TRANSIT',    // Bus en panne / accident — refund prorata km
  MAJOR_DELAY:            'MAJOR_DELAY',            // Retard grand (> tier délai config) — compensation monétaire
  PARCEL_UNDELIVERED:     'PARCEL_UNDELIVERED',     // Colis perdu/endommagé/non livré
} as const;
export type RefundReason = typeof RefundReason[keyof typeof RefundReason];

// ─── Voucher (bon de réduction émis en compensation ou promotion) ─────────────
// Crée à l'émission (ISSUED), puis soit utilisé (REDEEMED), expiré (EXPIRED),
// soit annulé (CANCELLED — ex: incident résolu côté compagnie, refund alternatif).
export const VoucherState = {
  ISSUED:    'ISSUED',     // Émis, utilisable jusqu'à validityEnd
  REDEEMED:  'REDEEMED',   // Consommé sur un ticket/parcel (one-shot)
  EXPIRED:   'EXPIRED',    // validityEnd dépassé sans utilisation
  CANCELLED: 'CANCELLED',  // Invalidé par admin (avant usage)
} as const;
export type VoucherState = typeof VoucherState[keyof typeof VoucherState];

export const VoucherAction = {
  ISSUE:    'ISSUE',     // → ISSUED (création)
  REDEEM:   'REDEEM',    // ISSUED → REDEEMED (utilisation)
  RESTORE:  'RESTORE',   // REDEEMED → ISSUED (rollback si ticket linked annulé)
  EXPIRE:   'EXPIRE',    // ISSUED → EXPIRED (scheduler)
  CANCEL:   'CANCEL',    // ISSUED → CANCELLED (admin)
} as const;
export type VoucherAction = typeof VoucherAction[keyof typeof VoucherAction];

export const VoucherUsageScope = {
  ANY_TRIP:      'ANY_TRIP',      // Utilisable sur n'importe quel ticket futur
  SAME_ROUTE:    'SAME_ROUTE',    // Utilisable uniquement sur la même route
  SAME_COMPANY:  'SAME_COMPANY',  // Utilisable sur n'importe quel trip du tenant (défaut)
} as const;
export type VoucherUsageScope = typeof VoucherUsageScope[keyof typeof VoucherUsageScope];

// ─── CompensationItem (snack / repas / indemnité matérielle offerte au passager) ─
// Émis manuellement par staff (agent quai, hôtesse) lors d'un incident/retard.
// Trace pour audit et reporting coûts (ne passe pas par le paiement).
export const CompensationForm = {
  MONETARY:   'MONETARY',   // Remboursement partiel en argent (via Refund)
  VOUCHER:    'VOUCHER',    // Bon de réduction (via Voucher)
  SNACK:      'SNACK',      // Collation (via CompensationItem)
  MIXED:      'MIXED',      // Combinaison (ex : snack + voucher)
} as const;
export type CompensationForm = typeof CompensationForm[keyof typeof CompensationForm];

export const CompensationItemType = {
  SNACK_LIGHT:  'SNACK_LIGHT',   // Boisson + petit en-cas
  SNACK_FULL:   'SNACK_FULL',    // Boisson + sandwich / repas léger
  MEAL:         'MEAL',          // Repas complet
  CUSTOM:       'CUSTOM',        // Item ad hoc (taxi, hébergement, etc.)
} as const;
export type CompensationItemType = typeof CompensationItemType[keyof typeof CompensationItemType];

export const CompensationItemState = {
  OFFERED:   'OFFERED',    // Proposé au passager
  DELIVERED: 'DELIVERED',  // Remis physiquement (signature ou scan ticket)
  DECLINED:  'DECLINED',   // Refusé par le passager
} as const;
export type CompensationItemState = typeof CompensationItemState[keyof typeof CompensationItemState];

export const CompensationItemAction = {
  OFFER:   'OFFER',
  DELIVER: 'DELIVER',
  DECLINE: 'DECLINE',
} as const;
export type CompensationItemAction = typeof CompensationItemAction[keyof typeof CompensationItemAction];

// ─── Penalty applies_to actors (qui doit s'acquitter d'une pénalité d'annulation) ─
export const PenaltyActor = {
  CUSTOMER: 'CUSTOMER',  // Annulation à l'initiative du voyageur
  AGENT:    'AGENT',     // Annulation par agent agence/caisse pour le compte du client
  ADMIN:    'ADMIN',     // Annulation par admin tenant (par défaut concerné pour éviter contournement)
  SYSTEM:   'SYSTEM',    // Annulation auto (ex : expiration) — en général pas de pénalité
} as const;
export type PenaltyActor = typeof PenaltyActor[keyof typeof PenaltyActor];

// ─── Shipment ─────────────────────────────────────────────────────────────────
export const ShipmentState = {
  OPEN:       'OPEN',       // Accepte des colis
  LOADED:     'LOADED',     // Chargé dans le bus
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED:    'ARRIVED',
  CLOSED:     'CLOSED',
} as const;
export type ShipmentState = typeof ShipmentState[keyof typeof ShipmentState];

// ─── CashRegister ─────────────────────────────────────────────────────────────
export const CashRegisterState = {
  OPEN:        'OPEN',
  CLOSED:      'CLOSED',
  DISCREPANCY: 'DISCREPANCY',
} as const;
export type CashRegisterState = typeof CashRegisterState[keyof typeof CashRegisterState];

// ─── TripEvent (PRD §IV.11 — événements opérationnels normaux) ────────────────
export const TripEventType = {
  PAUSE_START:        'PAUSE_START',
  PAUSE_END:          'PAUSE_END',
  CHECKPOINT_REACHED: 'CHECKPOINT_REACHED',
  DELAY_DECLARED:     'DELAY_DECLARED',
  DELAY_DETECTED:     'DELAY_DETECTED',      // levé par le système (scheduler)
  DEPARTURE_ANOMALY:  'DEPARTURE_ANOMALY',   // bus déclaré parti mais GPS ≤ 200m gare
  GEOFENCE_EXIT:      'GEOFENCE_EXIT',
} as const;
export type TripEventType = typeof TripEventType[keyof typeof TripEventType];

// ─── IncidentType (PRD §IV.11 — événements exceptionnels → workflow SAV) ──────
export const IncidentType = {
  MECHANICAL:    'MECHANICAL',
  SECURITY:      'SECURITY',
  HEALTH:        'HEALTH',
  LOST_OBJECT:   'LOST_OBJECT',
  SOS:           'SOS',
  ACCIDENT:      'ACCIDENT',
  CARGO_DAMAGED: 'CARGO_DAMAGED',
} as const;
export type IncidentType = typeof IncidentType[keyof typeof IncidentType];

export const IncidentState = {
  OPEN:        'OPEN',
  ASSIGNED:    'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED:    'RESOLVED',
  CLOSED:      'CLOSED',
} as const;
export type IncidentState = typeof IncidentState[keyof typeof IncidentState];

// ─── PublicReport ─────────────────────────────────────────────────────────────
export const PublicReportStatus = {
  PENDING:    'PENDING',
  VERIFIED:   'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  DISMISSED:  'DISMISSED',
} as const;
export type PublicReportStatus = typeof PublicReportStatus[keyof typeof PublicReportStatus];

// ─── SafetyAlert ─────────────────────────────────────────────────────────────
export const SafetyAlertStatus = {
  PENDING:    'PENDING',
  VERIFIED:   'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  DISMISSED:  'DISMISSED',
} as const;
export type SafetyAlertStatus = typeof SafetyAlertStatus[keyof typeof SafetyAlertStatus];

// ─── UserType ─────────────────────────────────────────────────────────────────
export const UserType = {
  STAFF:     'STAFF',
  CUSTOMER:  'CUSTOMER',
  ANONYMOUS: 'ANONYMOUS',
} as const;
export type UserType = typeof UserType[keyof typeof UserType];

// ─── CrewRole ─────────────────────────────────────────────────────────────────
export const CrewRole = {
  CO_PILOT:         'CO_PILOT',
  HOSTESS:          'HOSTESS',
  SECURITY:         'SECURITY',
  MECHANIC_ON_BOARD:'MECHANIC_ON_BOARD',
} as const;
export type CrewRole = typeof CrewRole[keyof typeof CrewRole];
