/**
 * Descripteurs Voucher pour le registre central.
 *
 * 1 template : voucher.issued — envoyé au bénéficiaire à l'émission.
 * recipientNameVar = 'recipientName' — quand l'admin testeur saisit un nom,
 * il remplace la variable `recipientName` du template.
 */

import { renderVoucherTemplate, VoucherTemplateId } from './voucher-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const VOUCHER_SAMPLE_VARS = {
  recipientName:   '',
  voucherCode:     'VCHR-9F3K-2M1X',
  formattedAmount: '5 000 XAF',
  validityEnd:     'mardi 26 mai 2026',
  scopeLabel:      'sur tous nos trajets',
  originLabel:     'geste commercial',
  redeemUrl:       'https://app.translog.pro/vouchers/VCHR-9F3K-2M1X',
} as const;

function adapt(id: VoucherTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...VOUCHER_SAMPLE_VARS, ...vars };
  const out    = renderVoucherTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const VOUCHER_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'voucher.issued',
    group:            'voucher',
    labelFr:          'Bon d\'avoir émis',
    labelEn:          'Voucher issued',
    descriptionFr:    'Envoyé au bénéficiaire à l\'émission d\'un bon d\'avoir (incident, retard majeur, geste commercial, promo).',
    descriptionEn:    'Sent to the recipient when a voucher is issued (incident, major delay, commercial gesture, promo).',
    sampleVars:       { ...VOUCHER_SAMPLE_VARS },
    recipientNameVar: 'recipientName',
    render:           (lang, vars) => adapt('voucher.issued', lang, vars),
  },
];
