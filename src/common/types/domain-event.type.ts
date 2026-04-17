export interface DomainEventMetadata {
  requestId?: string;
  userId?:    string;
  agencyId?:  string;
}

export interface TypedDomainEvent<T = Record<string, unknown>> {
  id:            string;
  type:          string;
  tenantId:      string;
  aggregateId:   string;
  aggregateType: string;
  payload:       T;
  occurredAt:    Date;
  metadata?:     DomainEventMetadata;
}

// ─── Well-known event types ───────────────────────────────────────────────────

export const EventTypes = {
  // Trip
  TRIP_STARTED:           'trip.started',
  TRIP_PAUSED:            'trip.paused',
  TRIP_RESUMED:           'trip.resumed',
  TRIP_DELAYED:           'trip.delayed',
  TRIP_COMPLETED:         'trip.completed',
  TRIP_CANCELLED:         'trip.cancelled',

  // Ticket
  TICKET_ISSUED:          'ticket.issued',
  TICKET_CHECKED_IN:      'ticket.checked_in',
  TICKET_BOARDED:         'ticket.boarded',
  TICKET_CANCELLED:       'ticket.cancelled',
  TICKET_REFUNDED:        'ticket.refunded',
  TICKET_EXPIRED:         'ticket.expired',

  // Refund
  REFUND_CREATED:         'refund.created',
  REFUND_APPROVED:        'refund.approved',
  REFUND_PROCESSED:       'refund.processed',
  REFUND_REJECTED:        'refund.rejected',

  // Parcel
  PARCEL_REGISTERED:      'parcel.registered',
  PARCEL_DISPATCHED:      'parcel.dispatched',
  PARCEL_ARRIVED:         'parcel.arrived',
  PARCEL_DELIVERED:       'parcel.delivered',

  // Incident
  INCIDENT_CREATED:       'incident.created',
  INCIDENT_SOS:           'incident.sos',
  INCIDENT_RESOLVED:      'incident.resolved',

  // Cash register
  CASHREGISTER_OPENED:    'cashregister.opened',
  CASHREGISTER_CLOSED:    'cashregister.closed',

  // GPS
  GPS_UPDATED:            'gps.updated',

  // Fleet docs & consumables
  FLEET_DOCUMENT_ALERT:   'fleet.document.alert',
  FLEET_CONSUMABLE_ALERT: 'fleet.consumable.alert',

  // Driver & HR
  DRIVER_REST_STARTED:            'driver.rest.started',
  DRIVER_REST_ENDED:              'driver.rest.ended',
  DRIVER_REST_COMPLETED:          'driver.rest.completed',
  DRIVER_REST_VIOLATION:          'driver.rest.violation',
  DRIVER_REMEDIATION_TRIGGERED:   'driver.remediation.triggered',
  DRIVER_TRAINING_DUE:            'driver.training.due',
  DRIVER_LICENSE_EXPIRING:        'driver.license.expiring',

  // Crew briefing
  CREW_BRIEFING_COMPLETED:        'crew.briefing.completed',
  CREW_BRIEFING_EQUIPMENT_MISSING:'crew.briefing.equipment_missing',

  // QHSE & Accidents
  ACCIDENT_REPORTED:              'accident.reported',
  ACCIDENT_UPDATED:               'accident.updated',
  QHSE_PROCEDURE_STARTED:         'qhse.procedure.started',
  QHSE_PROCEDURE_COMPLETED:       'qhse.procedure.completed',
  DISPUTE_OPENED:                 'dispute.opened',
  DISPUTE_SETTLED:                'dispute.settled',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
