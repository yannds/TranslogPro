/**
 * Descripteurs Invoice pour le registre central.
 *
 * 4 templates : invoice.issued / invoice.paid / invoice.overdue / invoice.cancelled.
 * Chaque descripteur expose des `sampleVars` représentatifs (Brazzaville, XAF)
 * pour le testeur plateforme.
 *
 * `recipientNameVar = 'customerName'` — quand l'admin testeur saisit un nom,
 * il remplace la variable `customerName` du template (et pas `passengerName`
 * comme pour lifecycle).
 */

import { renderInvoiceTemplate, InvoiceTemplateId } from './invoice-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const INVOICE_SAMPLE_VARS = {
  invoiceNumber:   'INV-2026-00042',
  customerName:    '',
  formattedAmount: '12 500 XAF',
  issuedDate:      'lundi 27 avril 2026',
  dueDate:         'mardi 27 mai 2026',
  paidAt:          'lundi 27 avril 2026',
  paymentMethod:   'Mobile Money',
  daysOverdue:     '5',
  portalUrl:       'https://app.translog.pro/invoices/INV-2026-00042',
} as const;

function adapt(id: InvoiceTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...INVOICE_SAMPLE_VARS, ...vars };
  const out    = renderInvoiceTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const INVOICE_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'invoice.issued',
    group:            'invoice',
    labelFr:          'Nouvelle facture émise',
    labelEn:          'New invoice issued',
    descriptionFr:    'Envoyé au client lorsqu\'une facture passe de DRAFT à ISSUED — invite au règlement.',
    descriptionEn:    'Sent to the customer when an invoice moves from DRAFT to ISSUED — payment invitation.',
    sampleVars:       { ...INVOICE_SAMPLE_VARS },
    recipientNameVar: 'customerName',
    render:           (lang, vars) => adapt('invoice.issued', lang, vars),
  },
  {
    id:               'invoice.paid',
    group:            'invoice',
    labelFr:          'Paiement reçu — accusé de réception',
    labelEn:          'Payment received — acknowledgement',
    descriptionFr:    'Confirmation envoyée au client à la transition vers PAID (encaissement, reçu de caisse, fast-track).',
    descriptionEn:    'Confirmation sent to the customer on transition to PAID (payment, cashier receipt, fast-track).',
    sampleVars:       { ...INVOICE_SAMPLE_VARS },
    recipientNameVar: 'customerName',
    render:           (lang, vars) => adapt('invoice.paid', lang, vars),
  },
  {
    id:               'invoice.overdue',
    group:            'invoice',
    labelFr:          'Facture en retard de paiement (relance)',
    labelEn:          'Invoice overdue (reminder)',
    descriptionFr:    'Émis par le scheduler quand une facture ISSUED dépasse son échéance — relance unique par facture.',
    descriptionEn:    'Emitted by the scheduler when an ISSUED invoice exceeds its due date — single reminder per invoice.',
    sampleVars:       { ...INVOICE_SAMPLE_VARS },
    recipientNameVar: 'customerName',
    render:           (lang, vars) => adapt('invoice.overdue', lang, vars),
  },
  {
    id:               'invoice.cancelled',
    group:            'invoice',
    labelFr:          'Facture annulée',
    labelEn:          'Invoice cancelled',
    descriptionFr:    'Envoyé au client à l\'annulation d\'une facture déjà émise (pas de notif si annulation depuis DRAFT).',
    descriptionEn:    'Sent to the customer when a previously issued invoice is cancelled (no notif if cancelled from DRAFT).',
    sampleVars:       { ...INVOICE_SAMPLE_VARS },
    recipientNameVar: 'customerName',
    render:           (lang, vars) => adapt('invoice.cancelled', lang, vars),
  },
];
