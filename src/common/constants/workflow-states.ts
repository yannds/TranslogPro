/**
 * États discrets des entités — source de vérité unique.
 * Aligné sur le PRD v2.0 §III.7 (5 workflows majeurs).
 *
 * RÈGLE : Tout état et toute transition doivent être enregistrés dans
 * WorkflowConfig(DB) par tenant. Ces constantes servent uniquement aux
 * vérifications de type et aux guards applicatifs — jamais à remplacer la DB.
 */

// ─── Trip ─────────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Trajet
export const TripState = {
  PLANNED:             'PLANNED',            // Trip créé, resources assignées
  OPEN:                'OPEN',               // Ouverture boarding autorisée (checklist PRE_DEPARTURE OK)
  BOARDING:            'BOARDING',           // Passagers en cours d'embarquement
  IN_PROGRESS:         'IN_PROGRESS',        // Bus en route
  IN_PROGRESS_PAUSED:  'IN_PROGRESS_PAUSED', // Pause technique (état discret)
  IN_PROGRESS_DELAYED: 'IN_PROGRESS_DELAYED',// Incident déclaré (état discret)
  COMPLETED:           'COMPLETED',          // Arrivée confirmée
  CANCELLED:           'CANCELLED',
} as const;
export type TripState = typeof TripState[keyof typeof TripState];

// Actions Trip (verbes de transition — passés au WorkflowEngine)
export const TripAction = {
  ACTIVATE:         'ACTIVATE',          // PLANNED
  START_BOARDING:   'START_BOARDING',    // OPEN
  BEGIN_BOARDING:   'BEGIN_BOARDING',    // BOARDING
  DEPART:           'DEPART',            // IN_PROGRESS
  PAUSE:            'PAUSE',             // IN_PROGRESS_PAUSED
  RESUME:           'RESUME',            // IN_PROGRESS (depuis PAUSED)
  REPORT_INCIDENT:  'REPORT_INCIDENT',   // IN_PROGRESS_DELAYED
  CLEAR_INCIDENT:   'CLEAR_INCIDENT',    // IN_PROGRESS (depuis DELAYED)
  END_TRIP:         'END_TRIP',          // COMPLETED
  CANCEL:           'CANCEL',            // CANCELLED
} as const;
export type TripAction = typeof TripAction[keyof typeof TripAction];

// ─── Ticket ───────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Billet
export const TicketState = {
  CREATED:          'CREATED',
  PENDING_PAYMENT:  'PENDING_PAYMENT',  // Timeout 15min (configurable par tenant)
  CONFIRMED:        'CONFIRMED',
  CHECKED_IN:       'CHECKED_IN',
  BOARDED:          'BOARDED',
  COMPLETED:        'COMPLETED',
  CANCELLED:        'CANCELLED',
  EXPIRED:          'EXPIRED',          // Timeout PENDING_PAYMENT dépassé
  // Workflow remboursement
  REFUND_PENDING:   'REFUND_PENDING',
  REFUND_PROCESSING:'REFUND_PROCESSING',
  REFUNDED:         'REFUNDED',
  REFUND_FAILED:    'REFUND_FAILED',
} as const;
export type TicketState = typeof TicketState[keyof typeof TicketState];

export const TicketAction = {
  CREATE:     'CREATE',
  RESERVE:    'RESERVE',
  PAY:        'PAY',
  EXPIRE:     'EXPIRE',       // déclenché par scheduler
  CHECK_IN:   'CHECK_IN',
  BOARD:      'BOARD',
  FINALIZE:   'FINALIZE',     // side effect de Trip.COMPLETED
  CANCEL:     'CANCEL',
  REFUND:     'REFUND',
} as const;
export type TicketAction = typeof TicketAction[keyof typeof TicketAction];

// ─── Parcel ───────────────────────────────────────────────────────────────────
// PRD §III.7 — Workflow Colis (8 états)
export const ParcelState = {
  CREATED:     'CREATED',      // Enregistrement initial
  AT_ORIGIN:   'AT_ORIGIN',    // Reçu physiquement à l'agence d'origine
  PACKED:      'PACKED',       // Ajouté à un Shipment
  LOADED:      'LOADED',       // Chargé dans le bus
  IN_TRANSIT:  'IN_TRANSIT',   // Bus en route (auto via side effect Trip.DEPART)
  ARRIVED:     'ARRIVED',      // Arrivé à destination (scan)
  DELIVERED:   'DELIVERED',    // Remis au destinataire
  DAMAGED:     'DAMAGED',      // Déclaré endommagé (déclenche SAV + WhatsApp)
  LOST:        'LOST',         // Déclaré perdu
  RETURNED:    'RETURNED',     // Retourné à l'expéditeur
} as const;
export type ParcelState = typeof ParcelState[keyof typeof ParcelState];

export const ParcelAction = {
  PACK:            'PACK',            // → CREATED
  RECEIVE:         'RECEIVE',         // → AT_ORIGIN
  ADD_TO_SHIPMENT: 'ADD_TO_SHIPMENT', // → PACKED (guard: poids + destination)
  LOAD:            'LOAD',            // → LOADED
  DEPART:          'DEPART',          // → IN_TRANSIT (side effect Trip.DEPART)
  ARRIVE:          'ARRIVE',          // → ARRIVED
  DELIVER:         'DELIVER',         // → DELIVERED
  DAMAGE:          'DAMAGE',          // → DAMAGED (any state)
  DECLARE_LOST:    'DECLARE_LOST',    // → LOST
  RETURN:          'RETURN',          // → RETURNED
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

// ─── Incident ─────────────────────────────────────────────────────────────────
export const IncidentState = {
  OPEN:        'OPEN',
  ASSIGNED:    'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED:    'RESOLVED',
  CLOSED:      'CLOSED',
} as const;
export type IncidentState = typeof IncidentState[keyof typeof IncidentState];

// ─── Claim (SAV) ──────────────────────────────────────────────────────────────
export const ClaimState = {
  SUBMITTED:    'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED:     'APPROVED',
  REJECTED:     'REJECTED',
  CLOSED:       'CLOSED',
} as const;
export type ClaimState = typeof ClaimState[keyof typeof ClaimState];

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
  DISCREPANCY: 'DISCREPANCY', // Écart à la clôture
} as const;
export type CashRegisterState = typeof CashRegisterState[keyof typeof CashRegisterState];
