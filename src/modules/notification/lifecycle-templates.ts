/**
 * Templates de notifications cycle de vie voyageur.
 *
 * Volontairement isolés du LifecycleNotificationListener pour rester testables
 * et permettre un override par tenant à terme (TenantNotificationTemplate).
 *
 * Format :
 *   - title : court, < 80 caractères (push, email subject)
 *   - body  : multi-canal (SMS/WA/push/IN_APP) — < 280 caractères pour SMS
 *   - html  : optionnel, utilisé pour le canal EMAIL
 *
 * i18n : fr (défaut) + en. Les 7 autres locales (wo, ln, ktu, ar, pt, es)
 * sont documentées dans docs/TODO_i18n_propagation.md et tombent sur 'fr'
 * par fallback dans LifecycleNotificationListener.resolveLanguage().
 */

export type LifecycleTemplateId =
  | 'notif.ticket.purchased'
  | 'notif.trip.published'
  | 'notif.trip.boarding'
  | 'notif.trip.reminder'
  | 'notif.trip.arrived';

type Lang = 'fr' | 'en';

interface RenderedTemplate {
  title: string;
  body:  string;
  html:  string;
}

interface TemplateVars {
  routeName:         string;
  origin:            string;
  destination:       string;
  scheduledHHMM:     string;
  scheduledDateLong: string;
  passengerName?:    string;
  ticketId?:         string;
  price?:            string;
  hoursThreshold?:   string;
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<LifecycleTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. Achat billet ───────────────────────────────────────────────────
  'notif.ticket.purchased': {
    fr: (v) => ({
      title: `Billet confirmé — ${v.routeName}`,
      body:  `Votre billet est confirmé pour ${v.origin} → ${v.destination} le ${v.scheduledDateLong} à ${v.scheduledHHMM}. Référence : ${v.ticketId ?? ''}. Bon voyage !`,
      html:  htmlWrap(
        `Billet confirmé`,
        `<p>Bonjour ${escape(v.passengerName ?? '')},</p>
         <p>Votre billet est <strong>confirmé</strong> pour le trajet <strong>${escape(v.origin)} → ${escape(v.destination)}</strong>.</p>
         <p>Date : <strong>${escape(v.scheduledDateLong)}</strong> à <strong>${escape(v.scheduledHHMM)}</strong></p>
         <p>Référence : <code>${escape(v.ticketId ?? '')}</code></p>
         <p>Bon voyage !</p>`,
      ),
    }),
    en: (v) => ({
      title: `Ticket confirmed — ${v.routeName}`,
      body:  `Your ticket is confirmed for ${v.origin} → ${v.destination} on ${v.scheduledDateLong} at ${v.scheduledHHMM}. Reference: ${v.ticketId ?? ''}. Have a safe trip!`,
      html:  htmlWrap(
        `Ticket confirmed`,
        `<p>Hello ${escape(v.passengerName ?? '')},</p>
         <p>Your ticket is <strong>confirmed</strong> for <strong>${escape(v.origin)} → ${escape(v.destination)}</strong>.</p>
         <p>Date: <strong>${escape(v.scheduledDateLong)}</strong> at <strong>${escape(v.scheduledHHMM)}</strong></p>
         <p>Reference: <code>${escape(v.ticketId ?? '')}</code></p>
         <p>Have a safe trip!</p>`,
      ),
    }),
  },

  // ─── 2. Ouverture trajet (vente) — CRM-aware (FREQUENT/VIP) ──────────
  'notif.trip.published': {
    fr: (v) => ({
      title: `Nouveau trajet : ${v.routeName}`,
      body:  `Un nouveau trajet ${v.origin} → ${v.destination} est ouvert à la réservation pour le ${v.scheduledDateLong} à ${v.scheduledHHMM}. Réservez votre place dès maintenant.`,
      html:  htmlWrap(
        `Nouveau trajet ouvert`,
        `<p>Bonjour ${escape(v.passengerName ?? '')},</p>
         <p>Un nouveau trajet <strong>${escape(v.origin)} → ${escape(v.destination)}</strong> est ouvert à la réservation.</p>
         <p>Date : <strong>${escape(v.scheduledDateLong)}</strong> à <strong>${escape(v.scheduledHHMM)}</strong></p>
         <p>Réservez votre place dès maintenant.</p>`,
      ),
    }),
    en: (v) => ({
      title: `New trip: ${v.routeName}`,
      body:  `A new trip ${v.origin} → ${v.destination} is open for booking on ${v.scheduledDateLong} at ${v.scheduledHHMM}. Book your seat now.`,
      html:  htmlWrap(
        `New trip available`,
        `<p>Hello ${escape(v.passengerName ?? '')},</p>
         <p>A new trip <strong>${escape(v.origin)} → ${escape(v.destination)}</strong> is open for booking.</p>
         <p>Date: <strong>${escape(v.scheduledDateLong)}</strong> at <strong>${escape(v.scheduledHHMM)}</strong></p>
         <p>Book your seat now.</p>`,
      ),
    }),
  },

  // ─── 3. Ouverture embarquement ─────────────────────────────────────────
  'notif.trip.boarding': {
    fr: (v) => ({
      title: `Embarquement ouvert — ${v.routeName}`,
      body:  `L'embarquement est ouvert pour votre trajet ${v.origin} → ${v.destination} (départ ${v.scheduledHHMM}). Merci de rejoindre votre quai.`,
      html:  htmlWrap(
        `Embarquement ouvert`,
        `<p>Bonjour ${escape(v.passengerName ?? '')},</p>
         <p>L'embarquement est <strong>ouvert</strong> pour votre trajet <strong>${escape(v.origin)} → ${escape(v.destination)}</strong>.</p>
         <p>Départ prévu à <strong>${escape(v.scheduledHHMM)}</strong>. Merci de rejoindre votre quai.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Boarding open — ${v.routeName}`,
      body:  `Boarding is now open for your trip ${v.origin} → ${v.destination} (departure ${v.scheduledHHMM}). Please proceed to your platform.`,
      html:  htmlWrap(
        `Boarding open`,
        `<p>Hello ${escape(v.passengerName ?? '')},</p>
         <p>Boarding is now <strong>open</strong> for your trip <strong>${escape(v.origin)} → ${escape(v.destination)}</strong>.</p>
         <p>Departure at <strong>${escape(v.scheduledHHMM)}</strong>. Please proceed to your platform.</p>`,
      ),
    }),
  },

  // ─── 4. Rappel pré-voyage T-Xh ─────────────────────────────────────────
  'notif.trip.reminder': {
    fr: (v) => ({
      title: reminderTitleFr(v.hoursThreshold ?? '0', v.routeName),
      body:  `Rappel : votre trajet ${v.origin} → ${v.destination} est prévu le ${v.scheduledDateLong} à ${v.scheduledHHMM}. Préparez vos pièces d'identité et présentez-vous 30 min avant.`,
      html:  htmlWrap(
        `Rappel — départ approchant`,
        `<p>Bonjour ${escape(v.passengerName ?? '')},</p>
         <p>Petit rappel pour votre trajet <strong>${escape(v.origin)} → ${escape(v.destination)}</strong>.</p>
         <p>Départ : <strong>${escape(v.scheduledDateLong)}</strong> à <strong>${escape(v.scheduledHHMM)}</strong></p>
         <p>Pensez à vous présenter 30 min avant avec votre pièce d'identité.</p>`,
      ),
    }),
    en: (v) => ({
      title: reminderTitleEn(v.hoursThreshold ?? '0', v.routeName),
      body:  `Reminder: your trip ${v.origin} → ${v.destination} is scheduled for ${v.scheduledDateLong} at ${v.scheduledHHMM}. Bring your ID and arrive 30 min early.`,
      html:  htmlWrap(
        `Reminder — departure soon`,
        `<p>Hello ${escape(v.passengerName ?? '')},</p>
         <p>A reminder about your trip <strong>${escape(v.origin)} → ${escape(v.destination)}</strong>.</p>
         <p>Departure: <strong>${escape(v.scheduledDateLong)}</strong> at <strong>${escape(v.scheduledHHMM)}</strong></p>
         <p>Please arrive 30 min early with your ID.</p>`,
      ),
    }),
  },

  // ─── 5. Arrivée + bon séjour ───────────────────────────────────────────
  'notif.trip.arrived': {
    fr: (v) => ({
      title: `Arrivée — ${v.destination}`,
      body:  `Vous êtes arrivé(e) à ${v.destination}. Merci d'avoir voyagé avec nous, bon séjour !`,
      html:  htmlWrap(
        `Bon séjour à ${escape(v.destination)}`,
        `<p>Bonjour ${escape(v.passengerName ?? '')},</p>
         <p>Vous êtes arrivé(e) à <strong>${escape(v.destination)}</strong>.</p>
         <p>Merci d'avoir voyagé avec nous — nous espérons vous revoir bientôt. <strong>Bon séjour !</strong></p>`,
      ),
    }),
    en: (v) => ({
      title: `Arrived — ${v.destination}`,
      body:  `You have arrived in ${v.destination}. Thank you for travelling with us, enjoy your stay!`,
      html:  htmlWrap(
        `Enjoy your stay in ${escape(v.destination)}`,
        `<p>Hello ${escape(v.passengerName ?? '')},</p>
         <p>You have arrived in <strong>${escape(v.destination)}</strong>.</p>
         <p>Thank you for travelling with us. <strong>Enjoy your stay!</strong></p>`,
      ),
    }),
  },
};

export function renderLifecycleTemplate(
  templateId: LifecycleTemplateId,
  lang:       Lang,
  vars:       TemplateVars,
): RenderedTemplate {
  const localeMap = TEMPLATES[templateId];
  const renderer  = localeMap[lang] ?? localeMap.fr;
  return renderer(vars);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

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

function reminderTitleFr(hours: string, routeName: string): string {
  const h = Number(hours);
  if (h >= 24) return `Votre voyage demain — ${routeName}`;
  if (h >= 6)  return `Votre voyage dans ${h}h — ${routeName}`;
  return `Votre voyage approche — ${routeName}`;
}

function reminderTitleEn(hours: string, routeName: string): string {
  const h = Number(hours);
  if (h >= 24) return `Your trip tomorrow — ${routeName}`;
  if (h >= 6)  return `Your trip in ${h}h — ${routeName}`;
  return `Your trip is coming up — ${routeName}`;
}
