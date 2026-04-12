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
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
