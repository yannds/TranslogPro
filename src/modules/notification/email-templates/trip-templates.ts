/**
 * Templates email Trip ad-hoc — événements trajet hors lifecycle voyageur.
 *
 * 1 template : trip.cancelled — fan-out aux porteurs de billets actifs après
 * annulation d'un trajet (TRIP_CANCELLED). Les remboursements sont gérés en
 * parallèle par RefundTripListener ; ce mail prévient juste le voyageur que
 * son trajet n'aura pas lieu.
 *
 * i18n fr+en, anti-XSS.
 */

export type TripTemplateId = 'trip.cancelled';

type Lang = 'fr' | 'en';

interface RenderedTemplate { title: string; body: string; html: string; }

interface TemplateVars {
  passengerName:     string;
  routeName:         string;
  origin:            string;
  destination:       string;
  scheduledDateLong: string;
  scheduledHHMM:     string;
  reason:            string; // motif facultatif (annulation, panne, météo…)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<TripTemplateId, Record<Lang, RenderFn>> = {
  'trip.cancelled': {
    fr: (v) => ({
      title: `Trajet annulé — ${v.routeName} du ${v.scheduledDateLong}`,
      body:  `Bonjour ${v.passengerName}, nous sommes au regret de vous informer que le trajet ${v.origin} → ${v.destination} prévu le ${v.scheduledDateLong} à ${v.scheduledHHMM} a été annulé${v.reason ? ` (${v.reason})` : ''}. Le remboursement est en cours de traitement.`,
      html:  htmlWrap(
        `Trajet annulé`,
        `<p>Bonjour ${escape(v.passengerName)},</p>
         <p>Nous sommes au regret de vous informer que votre trajet a été <strong>annulé</strong>.</p>
         <p><strong>${escape(v.origin)} → ${escape(v.destination)}</strong><br>
            ${escape(v.scheduledDateLong)} à ${escape(v.scheduledHHMM)}</p>
         ${v.reason ? `<p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px"><strong>Motif :</strong> ${escape(v.reason)}</p>` : ''}
         <p>Le remboursement de votre billet est en cours de traitement automatique. Vous recevrez une confirmation séparée dès qu'il sera approuvé.</p>
         <p>Nous nous excusons pour la gêne occasionnée.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Trip cancelled — ${v.routeName} on ${v.scheduledDateLong}`,
      body:  `Hello ${v.passengerName}, we are sorry to inform you that the trip ${v.origin} → ${v.destination} scheduled for ${v.scheduledDateLong} at ${v.scheduledHHMM} has been cancelled${v.reason ? ` (${v.reason})` : ''}. A refund is being processed.`,
      html:  htmlWrap(
        `Trip cancelled`,
        `<p>Hello ${escape(v.passengerName)},</p>
         <p>We are sorry to inform you that your trip has been <strong>cancelled</strong>.</p>
         <p><strong>${escape(v.origin)} → ${escape(v.destination)}</strong><br>
            ${escape(v.scheduledDateLong)} at ${escape(v.scheduledHHMM)}</p>
         ${v.reason ? `<p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px"><strong>Reason:</strong> ${escape(v.reason)}</p>` : ''}
         <p>A refund of your ticket is being processed automatically. You will receive a separate confirmation once approved.</p>
         <p>We apologise for the inconvenience.</p>`,
      ),
    }),
  },
};

export function renderTripTemplate(
  templateId: TripTemplateId,
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
