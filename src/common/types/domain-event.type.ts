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
  TRIP_PUBLISHED:         'trip.published',         // créé / mis en vente
  TRIP_BOARDING_OPENED:   'trip.boarding.opened',   // entrée en BOARDING (notif passagers)
  TRIP_STARTED:           'trip.started',           // départ effectif (IN_PROGRESS)
  TRIP_PAUSED:            'trip.paused',
  TRIP_RESUMED:           'trip.resumed',
  TRIP_DELAYED:           'trip.delayed',
  TRIP_REMINDER_DUE:      'trip.reminder.due',      // émis par TripReminderScheduler (T-Xh)
  TRIP_COMPLETED:         'trip.completed',         // arrivée destination → bon séjour
  TRIP_CANCELLED:         'trip.cancelled',

  // Ticket
  TICKET_ISSUED:          'ticket.issued',
  TICKET_CHECKED_IN:      'ticket.checked_in',
  TICKET_BOARDED:         'ticket.boarded',
  TICKET_CANCELLED:       'ticket.cancelled',
  TICKET_REFUNDED:        'ticket.refunded',
  TICKET_EXPIRED:         'ticket.expired',

  // Ticket no-show / rebook / forfeit (Tier 2.2 chantier email 2026-04-26)
  // payload : { ticketId, tripId, passengerName, ticketRef?, newTripId?, newTicketId? }
  TICKET_NO_SHOW:         'ticket.no_show',
  TICKET_REBOOKED:        'ticket.rebooked',
  TICKET_FORFEITED:       'ticket.forfeited',

  // Invoice (facturation tenant — émis par InvoiceService transitions + InvoiceOverdueScheduler)
  // payload : { invoiceId, invoiceNumber, totalAmount, currency, dueDate?, paidAt?, paymentMethod?, daysOverdue? }
  INVOICE_ISSUED:         'invoice.issued',         // DRAFT → ISSUED : nouvelle facture envoyée au client
  INVOICE_PAID:           'invoice.paid',           // ISSUED|DRAFT → PAID : paiement reçu
  INVOICE_OVERDUE:        'invoice.overdue',        // cron : ISSUED + dueDate < now (idempotent par invoice)
  INVOICE_CANCELLED:      'invoice.cancelled',      // ISSUED → CANCELLED : annulation après émission

  // Voucher (bons d'avoir CRM — émis manuellement ou via incidents/delays)
  // payload : { voucherId, code, amount, currency, validityEnd, origin, sourceTripId?, sourceTicketId? }
  VOUCHER_ISSUED:         'voucher.issued',

  // User (invitation par admin tenant — différent du colleague invite onboarding)
  // payload : { userId, email, name, tenantName, tenantSlug, roleName?, agencyName?, resetUrl }
  USER_INVITED:           'user.invited',

  // Auth — sécurité (Tier 3 chantier email 2026-04-26)
  // password reset link  : payload { userId, email, tenantName, resetUrl, expiresAt, source: 'self' | 'admin' | 'platform' }
  // password reset done  : payload { userId, email, tenantName, completedAt, ipAddress }
  // mfa enabled          : payload { userId, email, tenantName, enabledAt, factor: 'TOTP' }
  // mfa disabled         : payload { userId, email, tenantName, disabledAt, by: 'self' | 'admin' }
  // email verified       : payload { userId, email, tenantName, verifiedAt }
  AUTH_PASSWORD_RESET_LINK:        'auth.password_reset.link',
  AUTH_PASSWORD_RESET_COMPLETED:   'auth.password_reset.completed',
  AUTH_EMAIL_VERIFICATION_SENT:    'auth.email_verification.sent',
  AUTH_EMAIL_VERIFIED:             'auth.email_verified',
  AUTH_MFA_ENABLED:                'auth.mfa.enabled',
  AUTH_MFA_DISABLED:               'auth.mfa.disabled',
  // Suggestion MFA (Vague Onboarding-2 2026-04-27) :
  // émis 1 fois par staff tenant non-MFA à sa 1re connexion réussie.
  // Idempotence garantie par User.mfaSuggestionSentAt — pas de spam.
  // payload { userId, email, tenantName, setupUrl }
  AUTH_MFA_SUGGESTED:              'auth.mfa.suggested',

  // Subscription (Tier 4 chantier email 2026-04-26)
  // payload : { subscriptionId, tenantId, planName, price, currency, trialEndsAt?, cancelledAt?, reason? }
  SUBSCRIPTION_CREATED:        'subscription.created',
  SUBSCRIPTION_CANCELLED:      'subscription.cancelled',
  SUBSCRIPTION_TRIAL_EXPIRING: 'subscription.trial_expiring',

  // Refund
  REFUND_CREATED:         'refund.created',
  REFUND_APPROVED:        'refund.approved',
  REFUND_AUTO_APPROVED:   'refund.auto_approved',
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

  // Crew briefing (legacy — checklist matériel seule)
  CREW_BRIEFING_COMPLETED:        'crew.briefing.completed',
  CREW_BRIEFING_EQUIPMENT_MISSING:'crew.briefing.equipment_missing',

  // Briefing QHSE v2 (refonte 2026-04-24, multi-chapitres + double signature)
  BRIEFING_SIGNED:                'briefing.signed',
  BRIEFING_OVERRIDE_APPLIED:      'briefing.override.applied',

  // Trip safety alerts (émis par briefing, incidents, compliance)
  TRIP_SAFETY_ALERT_RAISED:       'trip.safety_alert.raised',
  TRIP_SAFETY_ALERT_RESOLVED:     'trip.safety_alert.resolved',

  // QHSE & Accidents
  ACCIDENT_REPORTED:              'accident.reported',
  ACCIDENT_UPDATED:               'accident.updated',
  QHSE_PROCEDURE_STARTED:         'qhse.procedure.started',
  QHSE_PROCEDURE_COMPLETED:       'qhse.procedure.completed',
  DISPUTE_OPENED:                 'dispute.opened',
  DISPUTE_SETTLED:                'dispute.settled',

  // Announcement (diffusion temps réel — écrans gare, portail voyageur)
  // payload : { announcementId, stationId?, citySlug?, tripId?, type, priority,
  //            title, message, startsAt, endsAt?, source }
  ANNOUNCEMENT_CREATED:           'announcement.created',
  ANNOUNCEMENT_UPDATED:           'announcement.updated',
  ANNOUNCEMENT_DELETED:           'announcement.deleted',

  // Payment (PaymentOrchestrator → webhook success / failure)
  // payload : { tenantId, intentId, entityType, entityId, amount, currency,
  //            metadata } — voir PaymentOrchestrator.emitIntentTerminalEvent
  PAYMENT_INTENT_SUCCEEDED:       'payment.intent.succeeded',
  PAYMENT_INTENT_FAILED:          'payment.intent.failed',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
