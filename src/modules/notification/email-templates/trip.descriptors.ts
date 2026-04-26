import { renderTripTemplate, TripTemplateId } from './trip-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const TRIP_SAMPLE_VARS = {
  passengerName:     '',
  routeName:         'Brazzaville → Pointe-Noire',
  origin:            'Brazzaville',
  destination:       'Pointe-Noire',
  scheduledDateLong: 'lundi 27 avril 2026',
  scheduledHHMM:     '08:30',
  reason:            'Panne mécanique du véhicule',
} as const;

function adapt(id: TripTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...TRIP_SAMPLE_VARS, ...vars };
  const out    = renderTripTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const TRIP_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'trip.cancelled',
    group:            'trip',
    labelFr:          'Trajet annulé (notification voyageur)',
    labelEn:          'Trip cancelled (passenger notification)',
    descriptionFr:    'Fan-out aux porteurs de billets actifs lors de l\'annulation d\'un trajet. Le remboursement est traité en parallèle.',
    descriptionEn:    'Fan-out to active ticket holders when a trip is cancelled. Refund is handled in parallel.',
    sampleVars:       { ...TRIP_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('trip.cancelled', lang, vars),
  },
];
