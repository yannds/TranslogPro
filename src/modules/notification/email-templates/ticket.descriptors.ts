import { renderTicketTemplate, TicketTemplateId } from './ticket-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const TICKET_SAMPLE_VARS = {
  passengerName:        '',
  ticketRef:            'TKT-2026-DEMO-A1B2',
  routeName:            'Brazzaville → Pointe-Noire',
  origin:               'Brazzaville',
  destination:          'Pointe-Noire',
  scheduledDateLong:    'lundi 27 avril 2026',
  newScheduledDateLong: 'mardi 28 avril 2026',
  newScheduledHHMM:     '14:30',
  ttlHours:             '48',
  rebookUrl:            'https://app.translog.pro/tickets/TKT-2026-DEMO-A1B2/rebook',
} as const;

function adapt(id: TicketTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...TICKET_SAMPLE_VARS, ...vars };
  const out    = renderTicketTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const TICKET_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'ticket.no_show',
    group:            'ticket',
    labelFr:          'Voyage manqué (no-show)',
    labelEn:          'Missed trip (no-show)',
    descriptionFr:    'Envoyé après marquage no-show — informe des options (rebook ou remboursement) pendant le TTL.',
    descriptionEn:    'Sent after no-show marking — informs about options (rebook or refund) during TTL.',
    sampleVars:       { ...TICKET_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('ticket.no_show', lang, vars),
  },
  {
    id:               'ticket.rebooked',
    group:            'ticket',
    labelFr:          'Billet replacé avec succès',
    labelEn:          'Ticket successfully rebooked',
    descriptionFr:    'Confirmation envoyée après replacement réussi sur un nouveau trajet (REBOOK_NEXT_AVAILABLE ou REBOOK_LATER).',
    descriptionEn:    'Confirmation sent after successful rebooking on a new trip (REBOOK_NEXT_AVAILABLE or REBOOK_LATER).',
    sampleVars:       { ...TICKET_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('ticket.rebooked', lang, vars),
  },
  {
    id:               'ticket.forfeited',
    group:            'ticket',
    labelFr:          'Billet forfaituré (TTL dépassé)',
    labelEn:          'Ticket forfeited (TTL exceeded)',
    descriptionFr:    'Notification envoyée par le scheduler quand le TTL post-départ est dépassé sans action — billet définitivement perdu.',
    descriptionEn:    'Notification sent by the scheduler when the post-departure TTL is exceeded without action — ticket definitively lost.',
    sampleVars:       { ...TICKET_SAMPLE_VARS },
    recipientNameVar: 'passengerName',
    render:           (lang, vars) => adapt('ticket.forfeited', lang, vars),
  },
];
