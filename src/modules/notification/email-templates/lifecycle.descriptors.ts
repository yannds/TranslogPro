/**
 * Descripteurs lifecycle pour le registre central.
 *
 * Adapte les 5 templates voyageur historiques (`lifecycle-templates.ts`)
 * au format `EmailTemplateDescriptor`. Aucune modification de la fonction
 * `renderLifecycleTemplate` consommée par `LifecycleNotificationListener`
 * — on délègue à elle, on traduit juste la forme de sortie
 * (`{title, body, html}` → `{subject, text, html}`).
 */

import { renderLifecycleTemplate, LifecycleTemplateId } from '../lifecycle-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

/** Variables types d'un voyage Brazzaville → Pointe-Noire utilisées par le testeur. */
const LIFECYCLE_SAMPLE_VARS = {
  routeName:         'Brazzaville → Pointe-Noire',
  origin:            'Brazzaville',
  destination:       'Pointe-Noire',
  scheduledHHMM:     '08:30',
  scheduledDateLong: 'lundi 27 avril 2026',
  passengerName:     '',
  ticketId:          'TKT-2026-DEMO-A1B2',
  price:             '12 500 XAF',
  hoursThreshold:    '6',
} as const;

/** Wrapper qui mappe `(title, body, html)` du lifecycle vers `RenderedEmail`. */
function adapt(id: LifecycleTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...LIFECYCLE_SAMPLE_VARS, ...vars };
  const out    = renderLifecycleTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const LIFECYCLE_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'notif.ticket.purchased',
    group:            'lifecycle',
    labelFr:          'Confirmation d\'achat de billet',
    labelEn:          'Ticket purchase confirmation',
    descriptionFr:    'Envoyé au voyageur à l\'émission d\'un billet (caisse, guichet, portail).',
    descriptionEn:    'Sent to the passenger when a ticket is issued (cashier, counter, portal).',
    sampleVars:       { ...LIFECYCLE_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('notif.ticket.purchased', lang, vars),
  },
  {
    id:               'notif.trip.published',
    group:            'lifecycle',
    labelFr:          'Nouveau trajet ouvert à la réservation',
    labelEn:          'New trip available for booking',
    descriptionFr:    'Diffusé aux clients fréquents/VIP du segment routier concerné lors de l\'ouverture des ventes.',
    descriptionEn:    'Broadcast to frequent/VIP customers when sales open for a new trip.',
    sampleVars:       { ...LIFECYCLE_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('notif.trip.published', lang, vars),
  },
  {
    id:               'notif.trip.boarding',
    group:            'lifecycle',
    labelFr:          'Embarquement ouvert',
    labelEn:          'Boarding open',
    descriptionFr:    'Envoyé aux porteurs de billets à l\'ouverture de l\'embarquement.',
    descriptionEn:    'Sent to ticket holders when boarding opens.',
    sampleVars:       { ...LIFECYCLE_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('notif.trip.boarding', lang, vars),
  },
  {
    id:               'notif.trip.reminder',
    group:            'lifecycle',
    labelFr:          'Rappel pré-voyage (J-1 / H-6 / H-1)',
    labelEn:          'Pre-trip reminder (D-1 / H-6 / H-1)',
    descriptionFr:    'Rappels automatiques selon les seuils PlatformConfig (par défaut 24h / 6h / 1h avant départ).',
    descriptionEn:    'Automatic reminders driven by PlatformConfig thresholds (default 24h / 6h / 1h before departure).',
    sampleVars:       { ...LIFECYCLE_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('notif.trip.reminder', lang, vars),
  },
  {
    id:               'notif.trip.arrived',
    group:            'lifecycle',
    labelFr:          'Arrivée à destination',
    labelEn:          'Arrived at destination',
    descriptionFr:    'Envoyé à l\'arrivée du trajet — message de remerciement et bon séjour.',
    descriptionEn:    'Sent on trip arrival — thank you and have a good stay message.',
    sampleVars:       { ...LIFECYCLE_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('notif.trip.arrived', lang, vars),
  },
];
