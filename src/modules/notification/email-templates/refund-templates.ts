/**
 * Templates email Refund — remboursements voyageur.
 *
 * 3 templates :
 *   1. refund.created  — demande enregistrée (en cours d'examen ou auto-approuvée)
 *   2. refund.approved — approuvée (manuel ou auto), virement à venir
 *   3. refund.rejected — refusée (avec motif facultatif)
 *
 * Format aligné lifecycle/invoice/voucher : { title, body, html }.
 * i18n fr+en (autres locales fallback fr).
 */

export type RefundTemplateId =
  | 'refund.created'
  | 'refund.approved'
  | 'refund.rejected';

type Lang = 'fr' | 'en';

interface RenderedTemplate {
  title: string;
  body:  string;
  html:  string;
}

interface TemplateVars {
  recipientName:   string;
  formattedAmount: string;   // ex: "8 750 XAF" — déjà formaté côté caller
  ticketRef:       string;   // ex: "TKT-2026-DEMO-A1B2"
  reasonLabel:     string;   // libellé localisé (annulation client, trajet annulé)
  policyPercent:   string;   // ex: "75%" (peut être vide)
  notes:           string;   // motif détaillé fourni par l'agent (rejet ou annulation)
  paymentMethod:   string;   // moyen de retour (cash / virement / mobile money)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<RefundTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. Demande enregistrée ────────────────────────────────────────────────
  'refund.created': {
    fr: (v) => ({
      title: `Demande de remboursement enregistrée — ${v.ticketRef}`,
      body:  `Bonjour ${v.recipientName}, votre demande de remboursement de ${v.formattedAmount} pour le billet ${v.ticketRef} est enregistrée. Vous serez notifié(e) dès qu'elle sera traitée.`,
      html:  htmlWrap(
        `Demande de remboursement enregistrée`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Nous avons bien enregistré votre demande de remboursement de <strong>${escape(v.formattedAmount)}</strong> pour le billet <strong>${escape(v.ticketRef)}</strong>.</p>
         ${v.reasonLabel ? `<p>Motif : ${escape(v.reasonLabel)}</p>` : ''}
         ${v.policyPercent ? `<p>Taux applicable selon notre politique d'annulation : <strong>${escape(v.policyPercent)}</strong></p>` : ''}
         <p>Notre équipe l'examinera et reviendra vers vous très prochainement.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Refund request received — ${v.ticketRef}`,
      body:  `Hello ${v.recipientName}, your refund request of ${v.formattedAmount} for ticket ${v.ticketRef} has been received. We will notify you once it is processed.`,
      html:  htmlWrap(
        `Refund request received`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>We have received your refund request of <strong>${escape(v.formattedAmount)}</strong> for ticket <strong>${escape(v.ticketRef)}</strong>.</p>
         ${v.reasonLabel ? `<p>Reason: ${escape(v.reasonLabel)}</p>` : ''}
         ${v.policyPercent ? `<p>Applicable rate per our cancellation policy: <strong>${escape(v.policyPercent)}</strong></p>` : ''}
         <p>Our team will review it and get back to you very soon.</p>`,
      ),
    }),
  },

  // ─── 2. Demande approuvée ──────────────────────────────────────────────────
  'refund.approved': {
    fr: (v) => ({
      title: `Remboursement approuvé — ${v.ticketRef}`,
      body:  `Bonjour ${v.recipientName}, votre remboursement de ${v.formattedAmount} pour le billet ${v.ticketRef} a été approuvé${v.paymentMethod && v.paymentMethod !== '-' ? ` (${v.paymentMethod})` : ''}. Le virement sera effectué sous peu.`,
      html:  htmlWrap(
        `Remboursement approuvé`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Bonne nouvelle : votre remboursement de <strong>${escape(v.formattedAmount)}</strong> pour le billet <strong>${escape(v.ticketRef)}</strong> a été <strong>approuvé</strong>.</p>
         ${v.paymentMethod && v.paymentMethod !== '-' ? `<p>Mode de remboursement : ${escape(v.paymentMethod)}</p>` : ''}
         <p>Le règlement sera effectué dans les meilleurs délais. En cas de question, contactez-nous.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Refund approved — ${v.ticketRef}`,
      body:  `Hello ${v.recipientName}, your refund of ${v.formattedAmount} for ticket ${v.ticketRef} has been approved${v.paymentMethod && v.paymentMethod !== '-' ? ` (${v.paymentMethod})` : ''}. The payment will be processed shortly.`,
      html:  htmlWrap(
        `Refund approved`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>Good news: your refund of <strong>${escape(v.formattedAmount)}</strong> for ticket <strong>${escape(v.ticketRef)}</strong> has been <strong>approved</strong>.</p>
         ${v.paymentMethod && v.paymentMethod !== '-' ? `<p>Refund method: ${escape(v.paymentMethod)}</p>` : ''}
         <p>The payment will be processed as soon as possible. Contact us if you have any questions.</p>`,
      ),
    }),
  },

  // ─── 3. Demande refusée ────────────────────────────────────────────────────
  'refund.rejected': {
    fr: (v) => ({
      title: `Demande de remboursement refusée — ${v.ticketRef}`,
      body:  `Bonjour ${v.recipientName}, votre demande de remboursement pour le billet ${v.ticketRef} n'a pas pu être acceptée${v.notes ? ` : ${v.notes}` : ''}. Vous pouvez nous contacter pour plus de détails.`,
      html:  htmlWrap(
        `Demande de remboursement refusée`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Nous sommes au regret de vous informer que votre demande de remboursement pour le billet <strong>${escape(v.ticketRef)}</strong> n'a pas pu être acceptée.</p>
         ${v.notes ? `<p style="background:#fef2f2;border-left:3px solid #ef4444;padding:10px"><strong>Motif :</strong> ${escape(v.notes)}</p>` : ''}
         <p>Si vous estimez qu'il s'agit d'une erreur ou souhaitez plus d'informations, n'hésitez pas à nous contacter directement.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Refund request declined — ${v.ticketRef}`,
      body:  `Hello ${v.recipientName}, your refund request for ticket ${v.ticketRef} could not be accepted${v.notes ? `: ${v.notes}` : ''}. You can contact us for more details.`,
      html:  htmlWrap(
        `Refund request declined`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>We are sorry to inform you that your refund request for ticket <strong>${escape(v.ticketRef)}</strong> could not be accepted.</p>
         ${v.notes ? `<p style="background:#fef2f2;border-left:3px solid #ef4444;padding:10px"><strong>Reason:</strong> ${escape(v.notes)}</p>` : ''}
         <p>If you believe this is an error or would like more information, please feel free to contact us directly.</p>`,
      ),
    }),
  },
};

export function renderRefundTemplate(
  templateId: RefundTemplateId,
  lang:       Lang,
  vars:       TemplateVars,
): RenderedTemplate {
  const localeMap = TEMPLATES[templateId];
  const renderer  = localeMap[lang] ?? localeMap.fr;
  return renderer(vars);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlWrap(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
<h2 style="color:#0f172a">${escape(title)}</h2>
${body}
<hr style="margin-top:24px;border:0;border-top:1px solid #e2e8f0">
<p style="color:#64748b;font-size:12px">TransLog Pro</p>
</body></html>`;
}
