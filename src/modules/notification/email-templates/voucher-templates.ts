/**
 * Templates email Voucher — bons d'avoir CRM.
 *
 * 1 template clé : émission d'un voucher au bénéficiaire (Customer ou contact
 * libre). Le mail explique le code, le montant, la validité, la portée.
 *
 * Format aligné sur lifecycle/invoice : { title, body, html } — title devient
 * le subject email.
 *
 * i18n fr+en (les 6 autres locales tombent sur fr par fallback).
 *
 * Sécurité : escape() systématique sur toutes les variables avant injection HTML.
 */

export type VoucherTemplateId =
  | 'voucher.issued';

type Lang = 'fr' | 'en';

interface RenderedTemplate {
  title: string;
  body:  string;
  html:  string;
}

interface TemplateVars {
  recipientName:   string;
  voucherCode:     string;
  formattedAmount: string;   // ex: "5 000 XAF"
  validityEnd:     string;   // long format localisé
  scopeLabel:      string;   // "tous trajets" / "même compagnie" / "même route"
  originLabel:     string;   // "geste commercial" / "compensation incident" / "promo"
  redeemUrl:       string;   // lien portail d'utilisation (peut être vide)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<VoucherTemplateId, Record<Lang, RenderFn>> = {
  'voucher.issued': {
    fr: (v) => ({
      title: `Votre bon d'avoir ${v.voucherCode} — ${v.formattedAmount}`,
      body:  `Bonjour ${v.recipientName}, vous avez reçu un bon d'avoir de ${v.formattedAmount} (code ${v.voucherCode}). Valable jusqu'au ${v.validityEnd}, utilisable ${v.scopeLabel}.`,
      html:  htmlWrap(
        `Vous avez reçu un bon d'avoir`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Nous vous offrons un <strong>bon d'avoir de ${escape(v.formattedAmount)}</strong>${v.originLabel ? ` (${escape(v.originLabel)})` : ''}.</p>
         <p style="background:#f1f5f9;padding:12px;border-radius:6px;font-family:ui-monospace,monospace;font-size:18px;text-align:center;letter-spacing:1px">
           ${escape(v.voucherCode)}
         </p>
         <p><strong>Valable jusqu'au :</strong> ${escape(v.validityEnd)}<br>
            <strong>Utilisable :</strong> ${escape(v.scopeLabel)}</p>
         <p>Présentez ce code lors de votre prochain achat de billet.</p>
         ${safeButton(v.redeemUrl, 'Utiliser mon bon')}`,
      ),
    }),
    en: (v) => ({
      title: `Your voucher ${v.voucherCode} — ${v.formattedAmount}`,
      body:  `Hello ${v.recipientName}, you received a voucher worth ${v.formattedAmount} (code ${v.voucherCode}). Valid until ${v.validityEnd}, usable ${v.scopeLabel}.`,
      html:  htmlWrap(
        `You received a voucher`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>We are offering you a <strong>voucher worth ${escape(v.formattedAmount)}</strong>${v.originLabel ? ` (${escape(v.originLabel)})` : ''}.</p>
         <p style="background:#f1f5f9;padding:12px;border-radius:6px;font-family:ui-monospace,monospace;font-size:18px;text-align:center;letter-spacing:1px">
           ${escape(v.voucherCode)}
         </p>
         <p><strong>Valid until:</strong> ${escape(v.validityEnd)}<br>
            <strong>Usable:</strong> ${escape(v.scopeLabel)}</p>
         <p>Present this code at your next ticket purchase.</p>
         ${safeButton(v.redeemUrl, 'Use my voucher')}`,
      ),
    }),
  },
};

/** Rendu d'un template Voucher — fallback fr si la langue n'est pas supportée. */
export function renderVoucherTemplate(
  templateId: VoucherTemplateId,
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

function safeButton(url: string, label: string): string {
  if (!url || !/^https?:\/\//.test(url)) return '';
  return `<p style="margin-top:20px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${escape(label)}</a></p>`;
}
