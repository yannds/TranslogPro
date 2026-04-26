/**
 * Descripteurs Refund pour le registre central — 3 templates.
 * recipientNameVar = 'recipientName' (nom du voyageur du ticket associé).
 */

import { renderRefundTemplate, RefundTemplateId } from './refund-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const REFUND_SAMPLE_VARS = {
  recipientName:   '',
  formattedAmount: '8 750 XAF',
  ticketRef:       'TKT-2026-DEMO-A1B2',
  reasonLabel:     'annulation client',
  policyPercent:   '75%',
  notes:           '',
  paymentMethod:   'Mobile Money',
} as const;

function adapt(id: RefundTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...REFUND_SAMPLE_VARS, ...vars };
  const out    = renderRefundTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const REFUND_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'refund.created',
    group:            'refund',
    labelFr:          'Demande de remboursement enregistrée',
    labelEn:          'Refund request received',
    descriptionFr:    'Accusé de réception envoyé au voyageur à la création de sa demande de remboursement.',
    descriptionEn:    'Acknowledgement sent to the passenger when a refund request is created.',
    sampleVars:       { ...REFUND_SAMPLE_VARS },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('refund.created', lang, vars),
  },
  {
    id:               'refund.approved',
    group:            'refund',
    labelFr:          'Remboursement approuvé',
    labelEn:          'Refund approved',
    descriptionFr:    'Confirmation que la demande a été approuvée (manuelle ou auto). Le virement suivra.',
    descriptionEn:    'Confirmation that the request was approved (manual or auto). Payment will follow.',
    sampleVars:       { ...REFUND_SAMPLE_VARS, notes: '' },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('refund.approved', lang, vars),
  },
  {
    id:               'refund.rejected',
    group:            'refund',
    labelFr:          'Demande de remboursement refusée',
    labelEn:          'Refund request declined',
    descriptionFr:    'Notification du refus de la demande, motif facultatif (champ notes).',
    descriptionEn:    'Notification that the request was declined, with optional reason (notes field).',
    sampleVars:       { ...REFUND_SAMPLE_VARS, notes: 'Le délai minimum avant départ n\'est pas respecté.' },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('refund.rejected', lang, vars),
  },
];
