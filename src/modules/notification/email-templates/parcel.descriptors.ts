import { renderParcelTemplate, ParcelTemplateId } from './parcel-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const PARCEL_SAMPLE_VARS = {
  recipientName:   '',
  trackingCode:    'PCL-2026-9F3K',
  destinationName: 'Pointe-Noire',
  pickupStation:   'Agence Pointe-Noire',
  trackingUrl:     'https://track.translog.pro/PCL-2026-9F3K',
  recipientRole:   'recipient',
} as const;

function adapt(id: ParcelTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...PARCEL_SAMPLE_VARS, ...vars };
  const out    = renderParcelTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const PARCEL_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'parcel.registered',
    group:            'parcel',
    labelFr:          'Colis enregistré',
    labelEn:          'Parcel registered',
    descriptionFr:    'Envoyé à l\'expéditeur et au destinataire à l\'enregistrement du colis avec son code de suivi.',
    descriptionEn:    'Sent to sender and recipient when the parcel is registered with its tracking code.',
    sampleVars:       { ...PARCEL_SAMPLE_VARS },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('parcel.registered', lang, vars),
  },
  {
    id:               'parcel.in_transit',
    group:            'parcel',
    labelFr:          'Colis en route',
    labelEn:          'Parcel in transit',
    descriptionFr:    'Notification quand le colis quitte le hub d\'origine ou un hub intermédiaire (transition vers IN_TRANSIT).',
    descriptionEn:    'Notification when the parcel leaves the origin or intermediate hub (transition to IN_TRANSIT).',
    sampleVars:       { ...PARCEL_SAMPLE_VARS },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('parcel.in_transit', lang, vars),
  },
  {
    id:               'parcel.ready_for_pickup',
    group:            'parcel',
    labelFr:          'Colis prêt à être retiré',
    labelEn:          'Parcel ready for pickup',
    descriptionFr:    'Envoyé au destinataire quand le colis est arrivé et disponible (transition vers AVAILABLE_FOR_PICKUP).',
    descriptionEn:    'Sent to the recipient when the parcel has arrived and is available (transition to AVAILABLE_FOR_PICKUP).',
    sampleVars:       { ...PARCEL_SAMPLE_VARS },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('parcel.ready_for_pickup', lang, vars),
  },
  {
    id:               'parcel.delivered',
    group:            'parcel',
    labelFr:          'Colis remis',
    labelEn:          'Parcel delivered',
    descriptionFr:    'Confirmation envoyée à l\'expéditeur ET au destinataire à la remise (transition vers DELIVERED).',
    descriptionEn:    'Confirmation sent to BOTH sender and recipient on delivery (transition to DELIVERED).',
    sampleVars:       { ...PARCEL_SAMPLE_VARS },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('parcel.delivered', lang, vars),
  },
];
