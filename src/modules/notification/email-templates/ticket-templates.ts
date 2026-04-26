/**
 * Templates email Ticket — événements no-show / rebook / forfeit.
 *
 * 3 templates :
 *   1. ticket.no_show   — billet marqué no-show, options dispo (rebook/refund)
 *   2. ticket.rebooked  — replacement sur un nouveau trajet réussi
 *   3. ticket.forfeited — TTL dépassé, billet perdu
 *
 * i18n fr+en, anti-XSS.
 */

export type TicketTemplateId =
  | 'ticket.no_show'
  | 'ticket.rebooked'
  | 'ticket.forfeited';

type Lang = 'fr' | 'en';

interface RenderedTemplate { title: string; body: string; html: string; }

interface TemplateVars {
  passengerName:        string;
  ticketRef:            string;
  routeName:            string;
  origin:               string;
  destination:          string;
  scheduledDateLong:    string;   // trip d'origine
  newScheduledDateLong: string;   // nouveau trip (rebook)
  newScheduledHHMM:     string;   // nouveau trip (rebook)
  ttlHours:             string;   // ex: "48"
  rebookUrl:            string;   // lien self-service rebook (peut être vide)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<TicketTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. No-show ────────────────────────────────────────────────────────────
  'ticket.no_show': {
    fr: (v) => ({
      title: `Voyage manqué — ${v.routeName}`,
      body:  `Bonjour ${v.passengerName}, votre billet ${v.ticketRef} pour le trajet ${v.origin} → ${v.destination} du ${v.scheduledDateLong} a été marqué no-show. Vous avez ${v.ttlHours}h pour rebook ou demander un remboursement.`,
      html:  htmlWrap(
        `Voyage manqué`,
        `<p>Bonjour ${escape(v.passengerName)},</p>
         <p>Votre billet <strong>${escape(v.ticketRef)}</strong> pour le trajet <strong>${escape(v.origin)} → ${escape(v.destination)}</strong> du <strong>${escape(v.scheduledDateLong)}</strong> a été marqué <strong>no-show</strong>.</p>
         <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px">
           Vous disposez de <strong>${escape(v.ttlHours)}h</strong> pour :
           <ul style="margin:8px 0 0;padding-left:20px">
             <li>Replacer votre billet sur un autre trajet</li>
             <li>Demander un remboursement (selon politique)</li>
           </ul>
         </p>
         <p>Au-delà, le billet sera automatiquement forfaituré.</p>
         ${safeButton(v.rebookUrl, 'Replacer mon billet')}`,
      ),
    }),
    en: (v) => ({
      title: `Missed trip — ${v.routeName}`,
      body:  `Hello ${v.passengerName}, your ticket ${v.ticketRef} for ${v.origin} → ${v.destination} on ${v.scheduledDateLong} has been marked no-show. You have ${v.ttlHours}h to rebook or request a refund.`,
      html:  htmlWrap(
        `Missed trip`,
        `<p>Hello ${escape(v.passengerName)},</p>
         <p>Your ticket <strong>${escape(v.ticketRef)}</strong> for <strong>${escape(v.origin)} → ${escape(v.destination)}</strong> on <strong>${escape(v.scheduledDateLong)}</strong> has been marked <strong>no-show</strong>.</p>
         <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px">
           You have <strong>${escape(v.ttlHours)}h</strong> to:
           <ul style="margin:8px 0 0;padding-left:20px">
             <li>Rebook your ticket on another trip</li>
             <li>Request a refund (per policy)</li>
           </ul>
         </p>
         <p>After that, the ticket will be automatically forfeited.</p>
         ${safeButton(v.rebookUrl, 'Rebook my ticket')}`,
      ),
    }),
  },

  // ─── 2. Rebooked ───────────────────────────────────────────────────────────
  'ticket.rebooked': {
    fr: (v) => ({
      title: `Billet replacé — ${v.routeName}`,
      body:  `Bonjour ${v.passengerName}, votre billet ${v.ticketRef} a été replacé sur le trajet du ${v.newScheduledDateLong} à ${v.newScheduledHHMM}. Bon voyage !`,
      html:  htmlWrap(
        `Billet replacé avec succès`,
        `<p>Bonjour ${escape(v.passengerName)},</p>
         <p>Votre billet <strong>${escape(v.ticketRef)}</strong> a été <strong>replacé</strong> avec succès sur un nouveau trajet.</p>
         <p style="background:#ecfdf5;border-left:3px solid #10b981;padding:10px">
           <strong>Nouveau départ :</strong> ${escape(v.newScheduledDateLong)} à ${escape(v.newScheduledHHMM)}<br>
           <strong>Trajet :</strong> ${escape(v.origin)} → ${escape(v.destination)}
         </p>
         <p>Présentez-vous au comptoir au moins 30 min avant le départ avec votre pièce d'identité. Bon voyage !</p>`,
      ),
    }),
    en: (v) => ({
      title: `Ticket rebooked — ${v.routeName}`,
      body:  `Hello ${v.passengerName}, your ticket ${v.ticketRef} has been rebooked on the trip of ${v.newScheduledDateLong} at ${v.newScheduledHHMM}. Have a safe trip!`,
      html:  htmlWrap(
        `Ticket successfully rebooked`,
        `<p>Hello ${escape(v.passengerName)},</p>
         <p>Your ticket <strong>${escape(v.ticketRef)}</strong> has been <strong>successfully rebooked</strong> on a new trip.</p>
         <p style="background:#ecfdf5;border-left:3px solid #10b981;padding:10px">
           <strong>New departure:</strong> ${escape(v.newScheduledDateLong)} at ${escape(v.newScheduledHHMM)}<br>
           <strong>Trip:</strong> ${escape(v.origin)} → ${escape(v.destination)}
         </p>
         <p>Please arrive at the counter at least 30 min before departure with your ID. Have a safe trip!</p>`,
      ),
    }),
  },

  // ─── 3. Forfeited ──────────────────────────────────────────────────────────
  'ticket.forfeited': {
    fr: (v) => ({
      title: `Billet forfaituré — ${v.ticketRef}`,
      body:  `Bonjour ${v.passengerName}, le délai de validité de votre billet ${v.ticketRef} (trajet ${v.origin} → ${v.destination}) est dépassé. Aucun rebook ni remboursement n'est plus possible.`,
      html:  htmlWrap(
        `Billet forfaituré`,
        `<p>Bonjour ${escape(v.passengerName)},</p>
         <p>Le délai de validité de votre billet <strong>${escape(v.ticketRef)}</strong> est dépassé sans action de votre part.</p>
         <p><strong>${escape(v.origin)} → ${escape(v.destination)}</strong> du ${escape(v.scheduledDateLong)}</p>
         <p style="background:#fee2e2;border-left:3px solid #ef4444;padding:10px">
           Le billet est désormais <strong>forfaituré</strong>. Aucun rebook ni remboursement n'est plus possible.
         </p>
         <p>Pour toute question, contactez-nous via votre agence habituelle.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Ticket forfeited — ${v.ticketRef}`,
      body:  `Hello ${v.passengerName}, the validity period of your ticket ${v.ticketRef} (trip ${v.origin} → ${v.destination}) has expired. No rebook or refund is possible anymore.`,
      html:  htmlWrap(
        `Ticket forfeited`,
        `<p>Hello ${escape(v.passengerName)},</p>
         <p>The validity period of your ticket <strong>${escape(v.ticketRef)}</strong> has expired without action on your part.</p>
         <p><strong>${escape(v.origin)} → ${escape(v.destination)}</strong> on ${escape(v.scheduledDateLong)}</p>
         <p style="background:#fee2e2;border-left:3px solid #ef4444;padding:10px">
           The ticket is now <strong>forfeited</strong>. No rebook or refund is possible anymore.
         </p>
         <p>For any questions, please contact us via your usual agency.</p>`,
      ),
    }),
  },
};

export function renderTicketTemplate(
  templateId: TicketTemplateId,
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
