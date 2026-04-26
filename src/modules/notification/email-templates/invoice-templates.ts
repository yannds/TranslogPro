/**
 * Templates emails Invoice — facturation tenant.
 *
 * 4 templates clé du cycle de vie d'une facture :
 *   1. invoice.issued     — DRAFT → ISSUED   : nouvelle facture envoyée
 *   2. invoice.paid       — *     → PAID     : paiement reçu (reçu)
 *   3. invoice.overdue    — cron   ISSUED+dueDate<now : relance
 *   4. invoice.cancelled  — ISSUED → CANCELLED : annulation post-émission
 *
 * Format : `{ title, body, html }` cohérent avec lifecycle-templates.ts —
 * `title` devient le subject email, `body` le text/plain et SMS-friendly,
 * `html` le rendu riche.
 *
 * i18n fr (défaut) + en. Les 6 autres locales (wo, ln, ktu, ar, pt, es)
 * tombent sur 'fr' par fallback dans `renderInvoiceTemplate`.
 *
 * XSS : toutes les variables passent par `escape()` avant injection HTML.
 */

export type InvoiceTemplateId =
  | 'invoice.issued'
  | 'invoice.paid'
  | 'invoice.overdue'
  | 'invoice.cancelled';

type Lang = 'fr' | 'en';

interface RenderedTemplate {
  title: string;
  body:  string;
  html:  string;
}

interface TemplateVars {
  invoiceNumber:    string;
  customerName:     string;
  formattedAmount:  string;   // ex: "12 500 XAF" — déjà formaté côté caller
  issuedDate:       string;   // long format localisé
  dueDate:          string;   // long format ou '-'
  paidAt:           string;   // long format ou '-'
  paymentMethod:    string;   // ex: "Mobile Money", "Espèces"
  daysOverdue:      string;   // "5"
  portalUrl:        string;   // lien profond vers la facture (peut être vide)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<InvoiceTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. Nouvelle facture émise ─────────────────────────────────────────────
  'invoice.issued': {
    fr: (v) => ({
      title: `Nouvelle facture ${v.invoiceNumber} — ${v.formattedAmount}`,
      body:  `Bonjour ${v.customerName}, votre facture ${v.invoiceNumber} de ${v.formattedAmount} a été émise${v.dueDate && v.dueDate !== '-' ? ` (échéance ${v.dueDate})` : ''}. Merci de procéder au règlement.`,
      html:  htmlWrap(
        `Nouvelle facture émise`,
        `<p>Bonjour ${escape(v.customerName)},</p>
         <p>Votre facture <strong>${escape(v.invoiceNumber)}</strong> a été émise pour un montant de <strong>${escape(v.formattedAmount)}</strong>.</p>
         ${v.dueDate && v.dueDate !== '-' ? `<p>Échéance : <strong>${escape(v.dueDate)}</strong></p>` : ''}
         <p>Merci de procéder au règlement dans les meilleurs délais.</p>
         ${linkButtonFr(v.portalUrl, 'Consulter la facture')}`,
      ),
    }),
    en: (v) => ({
      title: `New invoice ${v.invoiceNumber} — ${v.formattedAmount}`,
      body:  `Hello ${v.customerName}, your invoice ${v.invoiceNumber} for ${v.formattedAmount} has been issued${v.dueDate && v.dueDate !== '-' ? ` (due ${v.dueDate})` : ''}. Please proceed with payment.`,
      html:  htmlWrap(
        `New invoice issued`,
        `<p>Hello ${escape(v.customerName)},</p>
         <p>Your invoice <strong>${escape(v.invoiceNumber)}</strong> has been issued for <strong>${escape(v.formattedAmount)}</strong>.</p>
         ${v.dueDate && v.dueDate !== '-' ? `<p>Due date: <strong>${escape(v.dueDate)}</strong></p>` : ''}
         <p>Please proceed with payment as soon as possible.</p>
         ${linkButtonEn(v.portalUrl, 'View invoice')}`,
      ),
    }),
  },

  // ─── 2. Paiement reçu ──────────────────────────────────────────────────────
  'invoice.paid': {
    fr: (v) => ({
      title: `Paiement reçu — facture ${v.invoiceNumber}`,
      body:  `Bonjour ${v.customerName}, nous avons bien reçu votre paiement de ${v.formattedAmount} pour la facture ${v.invoiceNumber}${v.paymentMethod && v.paymentMethod !== '-' ? ` (${v.paymentMethod})` : ''}. Merci.`,
      html:  htmlWrap(
        `Paiement bien reçu`,
        `<p>Bonjour ${escape(v.customerName)},</p>
         <p>Nous accusons bonne réception de votre paiement de <strong>${escape(v.formattedAmount)}</strong> pour la facture <strong>${escape(v.invoiceNumber)}</strong>.</p>
         ${v.paymentMethod && v.paymentMethod !== '-' ? `<p>Moyen de paiement : ${escape(v.paymentMethod)}</p>` : ''}
         ${v.paidAt && v.paidAt !== '-' ? `<p>Date de paiement : ${escape(v.paidAt)}</p>` : ''}
         <p>Merci pour votre confiance.</p>
         ${linkButtonFr(v.portalUrl, 'Télécharger le reçu')}`,
      ),
    }),
    en: (v) => ({
      title: `Payment received — invoice ${v.invoiceNumber}`,
      body:  `Hello ${v.customerName}, we received your payment of ${v.formattedAmount} for invoice ${v.invoiceNumber}${v.paymentMethod && v.paymentMethod !== '-' ? ` (${v.paymentMethod})` : ''}. Thank you.`,
      html:  htmlWrap(
        `Payment received`,
        `<p>Hello ${escape(v.customerName)},</p>
         <p>We confirm receipt of your payment of <strong>${escape(v.formattedAmount)}</strong> for invoice <strong>${escape(v.invoiceNumber)}</strong>.</p>
         ${v.paymentMethod && v.paymentMethod !== '-' ? `<p>Payment method: ${escape(v.paymentMethod)}</p>` : ''}
         ${v.paidAt && v.paidAt !== '-' ? `<p>Payment date: ${escape(v.paidAt)}</p>` : ''}
         <p>Thank you for your trust.</p>
         ${linkButtonEn(v.portalUrl, 'Download receipt')}`,
      ),
    }),
  },

  // ─── 3. Facture en retard ──────────────────────────────────────────────────
  'invoice.overdue': {
    fr: (v) => ({
      title: `Facture ${v.invoiceNumber} en retard de paiement`,
      body:  `Bonjour ${v.customerName}, votre facture ${v.invoiceNumber} de ${v.formattedAmount} est en retard de ${v.daysOverdue} jour(s). Merci de régulariser au plus vite.`,
      html:  htmlWrap(
        `Facture en retard de paiement`,
        `<p>Bonjour ${escape(v.customerName)},</p>
         <p>Votre facture <strong>${escape(v.invoiceNumber)}</strong> d'un montant de <strong>${escape(v.formattedAmount)}</strong> est en retard de <strong>${escape(v.daysOverdue)} jour(s)</strong>.</p>
         ${v.dueDate && v.dueDate !== '-' ? `<p>Échéance initiale : ${escape(v.dueDate)}</p>` : ''}
         <p>Merci de procéder au règlement rapidement pour éviter toute suspension de service.</p>
         ${linkButtonFr(v.portalUrl, 'Régler maintenant')}`,
      ),
    }),
    en: (v) => ({
      title: `Invoice ${v.invoiceNumber} overdue`,
      body:  `Hello ${v.customerName}, your invoice ${v.invoiceNumber} of ${v.formattedAmount} is ${v.daysOverdue} day(s) overdue. Please settle as soon as possible.`,
      html:  htmlWrap(
        `Invoice overdue`,
        `<p>Hello ${escape(v.customerName)},</p>
         <p>Your invoice <strong>${escape(v.invoiceNumber)}</strong> for <strong>${escape(v.formattedAmount)}</strong> is <strong>${escape(v.daysOverdue)} day(s) overdue</strong>.</p>
         ${v.dueDate && v.dueDate !== '-' ? `<p>Original due date: ${escape(v.dueDate)}</p>` : ''}
         <p>Please proceed with payment promptly to avoid any service suspension.</p>
         ${linkButtonEn(v.portalUrl, 'Pay now')}`,
      ),
    }),
  },

  // ─── 4. Facture annulée ────────────────────────────────────────────────────
  'invoice.cancelled': {
    fr: (v) => ({
      title: `Facture ${v.invoiceNumber} annulée`,
      body:  `Bonjour ${v.customerName}, la facture ${v.invoiceNumber} de ${v.formattedAmount} a été annulée. Aucun règlement n'est attendu.`,
      html:  htmlWrap(
        `Facture annulée`,
        `<p>Bonjour ${escape(v.customerName)},</p>
         <p>La facture <strong>${escape(v.invoiceNumber)}</strong> d'un montant de <strong>${escape(v.formattedAmount)}</strong> a été <strong>annulée</strong>.</p>
         <p>Aucun règlement n'est attendu de votre part. Pour toute question, n'hésitez pas à nous contacter.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Invoice ${v.invoiceNumber} cancelled`,
      body:  `Hello ${v.customerName}, invoice ${v.invoiceNumber} for ${v.formattedAmount} has been cancelled. No payment is expected.`,
      html:  htmlWrap(
        `Invoice cancelled`,
        `<p>Hello ${escape(v.customerName)},</p>
         <p>Invoice <strong>${escape(v.invoiceNumber)}</strong> for <strong>${escape(v.formattedAmount)}</strong> has been <strong>cancelled</strong>.</p>
         <p>No payment is expected. Please contact us if you have any questions.</p>`,
      ),
    }),
  },
};

/** Rendu d'un template Invoice — fallback fr si la langue n'est pas supportée. */
export function renderInvoiceTemplate(
  templateId: InvoiceTemplateId,
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

/** Bouton lien — n'affiche rien si url est vide ou non http(s) (anti-XSS basique). */
function linkButtonFr(url: string, label: string): string {
  return safeButton(url, label);
}
function linkButtonEn(url: string, label: string): string {
  return safeButton(url, label);
}

function safeButton(url: string, label: string): string {
  if (!url || !/^https?:\/\//.test(url)) return '';
  return `<p style="margin-top:20px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${escape(label)}</a></p>`;
}
