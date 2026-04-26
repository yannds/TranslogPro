/**
 * Templates email Parcel — cycle de vie d'un colis.
 *
 * 4 templates :
 *   1. parcel.registered       — colis pris en charge (tracking code)
 *   2. parcel.in_transit       — colis en route vers la destination
 *   3. parcel.ready_for_pickup — colis arrivé, prêt à être retiré
 *   4. parcel.delivered        — colis remis au destinataire
 *
 * i18n fr+en, anti-XSS.
 */

export type ParcelTemplateId =
  | 'parcel.registered'
  | 'parcel.in_transit'
  | 'parcel.ready_for_pickup'
  | 'parcel.delivered';

type Lang = 'fr' | 'en';

interface RenderedTemplate { title: string; body: string; html: string; }

interface TemplateVars {
  recipientName:    string;
  trackingCode:     string;
  destinationName:  string;
  pickupStation:    string;   // gare de retrait
  trackingUrl:      string;   // public tracking URL (peut être vide)
  recipientRole:    string;   // 'sender' | 'recipient' (pour personnaliser légèrement)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<ParcelTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. Colis enregistré ──────────────────────────────────────────────────
  'parcel.registered': {
    fr: (v) => ({
      title: `Colis enregistré — ${v.trackingCode}`,
      body:  `Bonjour ${v.recipientName}, votre colis a été enregistré sous le code de suivi ${v.trackingCode} (destination ${v.destinationName}). Vous pouvez le suivre en ligne.`,
      html:  htmlWrap(
        `Colis enregistré`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Votre colis a été pris en charge avec succès.</p>
         <p style="background:#f1f5f9;padding:12px;border-radius:6px;font-family:ui-monospace,monospace;font-size:18px;text-align:center;letter-spacing:1px">
           ${escape(v.trackingCode)}
         </p>
         <p><strong>Destination :</strong> ${escape(v.destinationName)}</p>
         ${safeButton(v.trackingUrl, 'Suivre mon colis')}`,
      ),
    }),
    en: (v) => ({
      title: `Parcel registered — ${v.trackingCode}`,
      body:  `Hello ${v.recipientName}, your parcel has been registered with tracking code ${v.trackingCode} (destination ${v.destinationName}). You can track it online.`,
      html:  htmlWrap(
        `Parcel registered`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>Your parcel has been successfully registered.</p>
         <p style="background:#f1f5f9;padding:12px;border-radius:6px;font-family:ui-monospace,monospace;font-size:18px;text-align:center;letter-spacing:1px">
           ${escape(v.trackingCode)}
         </p>
         <p><strong>Destination:</strong> ${escape(v.destinationName)}</p>
         ${safeButton(v.trackingUrl, 'Track my parcel')}`,
      ),
    }),
  },

  // ─── 2. Colis en transit ──────────────────────────────────────────────────
  'parcel.in_transit': {
    fr: (v) => ({
      title: `Colis en route — ${v.trackingCode}`,
      body:  `Bonjour ${v.recipientName}, votre colis ${v.trackingCode} est en route vers ${v.destinationName}.`,
      html:  htmlWrap(
        `Colis en route`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Votre colis <strong>${escape(v.trackingCode)}</strong> a quitté son lieu de prise en charge et se dirige vers <strong>${escape(v.destinationName)}</strong>.</p>
         ${safeButton(v.trackingUrl, 'Suivre mon colis')}`,
      ),
    }),
    en: (v) => ({
      title: `Parcel in transit — ${v.trackingCode}`,
      body:  `Hello ${v.recipientName}, your parcel ${v.trackingCode} is on its way to ${v.destinationName}.`,
      html:  htmlWrap(
        `Parcel in transit`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>Your parcel <strong>${escape(v.trackingCode)}</strong> has left the origin and is heading to <strong>${escape(v.destinationName)}</strong>.</p>
         ${safeButton(v.trackingUrl, 'Track my parcel')}`,
      ),
    }),
  },

  // ─── 3. Colis prêt à être retiré ──────────────────────────────────────────
  'parcel.ready_for_pickup': {
    fr: (v) => ({
      title: `Votre colis est prêt — ${v.trackingCode}`,
      body:  `Bonjour ${v.recipientName}, votre colis ${v.trackingCode} est arrivé et vous attend à ${v.pickupStation}. Munissez-vous d'une pièce d'identité pour le retirer.`,
      html:  htmlWrap(
        `Votre colis est prêt à être retiré`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Bonne nouvelle : votre colis <strong>${escape(v.trackingCode)}</strong> est <strong>arrivé</strong> et vous attend.</p>
         <p><strong>Lieu de retrait :</strong> ${escape(v.pickupStation)}</p>
         <p>Présentez-vous au comptoir avec une <strong>pièce d'identité</strong> pour récupérer votre colis.</p>
         ${safeButton(v.trackingUrl, 'Voir le suivi détaillé')}`,
      ),
    }),
    en: (v) => ({
      title: `Your parcel is ready — ${v.trackingCode}`,
      body:  `Hello ${v.recipientName}, your parcel ${v.trackingCode} has arrived and is waiting for you at ${v.pickupStation}. Bring an ID document to collect it.`,
      html:  htmlWrap(
        `Your parcel is ready for pickup`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>Good news: your parcel <strong>${escape(v.trackingCode)}</strong> has <strong>arrived</strong> and is waiting for you.</p>
         <p><strong>Pickup location:</strong> ${escape(v.pickupStation)}</p>
         <p>Bring an <strong>ID document</strong> to the counter to collect your parcel.</p>
         ${safeButton(v.trackingUrl, 'View detailed tracking')}`,
      ),
    }),
  },

  // ─── 4. Colis remis ───────────────────────────────────────────────────────
  'parcel.delivered': {
    fr: (v) => ({
      title: `Colis remis — ${v.trackingCode}`,
      body:  `Bonjour ${v.recipientName}, votre colis ${v.trackingCode} a été ${v.recipientRole === 'sender' ? 'remis au destinataire' : 'remis'}. Merci d'avoir choisi TransLog Pro.`,
      html:  htmlWrap(
        `Colis remis`,
        `<p>Bonjour ${escape(v.recipientName)},</p>
         <p>Votre colis <strong>${escape(v.trackingCode)}</strong> a bien été ${v.recipientRole === 'sender' ? '<strong>remis au destinataire</strong>' : '<strong>remis</strong>'}.</p>
         <p>Merci d'avoir choisi TransLog Pro pour votre envoi.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Parcel delivered — ${v.trackingCode}`,
      body:  `Hello ${v.recipientName}, your parcel ${v.trackingCode} has been ${v.recipientRole === 'sender' ? 'delivered to the recipient' : 'delivered'}. Thank you for choosing TransLog Pro.`,
      html:  htmlWrap(
        `Parcel delivered`,
        `<p>Hello ${escape(v.recipientName)},</p>
         <p>Your parcel <strong>${escape(v.trackingCode)}</strong> has been ${v.recipientRole === 'sender' ? '<strong>delivered to the recipient</strong>' : '<strong>delivered</strong>'}.</p>
         <p>Thank you for choosing TransLog Pro for your shipment.</p>`,
      ),
    }),
  },
};

export function renderParcelTemplate(
  templateId: ParcelTemplateId,
  lang:       Lang,
  vars:       TemplateVars,
): RenderedTemplate {
  const localeMap = TEMPLATES[templateId];
  return (localeMap[lang] ?? localeMap.fr)(vars);
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
