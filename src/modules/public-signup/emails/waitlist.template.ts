/**
 * Confirmation email envoyé après inscription à la waitlist.
 * Minimaliste — une ligne de remerciement, rappel du bonus 60j.
 */

import type { EmailAddress } from '../../../infrastructure/notification/interfaces/email.interface';
import type { SignupLocale } from './welcome.template';

export interface WaitlistEmailInput {
  to:     EmailAddress;
  locale: SignupLocale;
}

const L: Record<SignupLocale, { subject: string; intro: string; bonus: string; closing: string; sig: string }> = {
  fr: {
    subject:  "Merci — vous êtes sur la liste 🎉",
    intro:    "Merci de votre intérêt pour TransLog Pro. Nous vous écrirons dès que l'inscription ouvre.",
    bonus:    "En tant qu'inscrit early-access, vous aurez droit à 60 jours d'essai au lieu de 30.",
    closing:  "À très bientôt.",
    sig:      "L'équipe TransLog Pro",
  },
  en: {
    subject:  "Thanks — you're on the list 🎉",
    intro:    "Thanks for your interest in TransLog Pro. We'll reach out as soon as signup opens.",
    bonus:    "As an early-access signup, you'll get 60 trial days instead of 30.",
    closing:  "Talk soon.",
    sig:      "The TransLog Pro team",
  },
  es: {
    subject:  "¡Gracias! — está en la lista 🎉",
    intro:    "Gracias por su interés en TransLog Pro. Le escribiremos en cuanto se abran las inscripciones.",
    bonus:    "Como inscrito early-access, tendrá 60 días de prueba en vez de 30.",
    closing:  "Hasta pronto.",
    sig:      "El equipo TransLog Pro",
  },
  pt: {
    subject:  "Obrigado — você está na lista 🎉",
    intro:    "Obrigado pelo seu interesse na TransLog Pro. Escreveremos assim que as inscrições abrirem.",
    bonus:    "Como inscrito early-access, você terá 60 dias de avaliação em vez de 30.",
    closing:  "Até breve.",
    sig:      "A equipe TransLog Pro",
  },
  ar: {
    subject:  "شكرًا — أنت على القائمة 🎉",
    intro:    "شكرًا لاهتمامك بـ TransLog Pro. سنراسلك بمجرد فتح التسجيل.",
    bonus:    "كـمسجَّل early-access، ستحصل على ٦٠ يومًا تجريبيًا بدلًا من ٣٠.",
    closing:  "إلى اللقاء قريبًا.",
    sig:      "فريق TransLog Pro",
  },
  wo: {
    subject:  "Jërëjëf — nga ci liste bi 🎉",
    intro:    "Jërëjëf ci sa bëgg-bëggu TransLog Pro. Dinañu la bind su inscription bi ubbiku.",
    bonus:    "Nga bi bokk ci early-access, dina nga am 60 fan yi nga ñaan ci yor, lu-bu baax 30.",
    closing:  "Ba sax-sax.",
    sig:      "Mbooloo TransLog Pro",
  },
  ln: {
    subject:  "Matondi — ozali na liste 🎉",
    intro:    "Matondi mpo na mposa na yo ya TransLog Pro. Tokokomela yo tango inscription ekofungwama.",
    bonus:    "Lokola moto ya early-access, okozwa mikolo 60 ya komeka, na esika ya 30.",
    closing:  "Tokomonana noki.",
    sig:      "Équipe TransLog Pro",
  },
  ktu: {
    subject:  "Matondi — nge ke na liste 🎉",
    intro:    "Matondi mpo na mposa ya nge ya TransLog Pro. Beto ta komela nge ntangu inscription ta fungwama.",
    bonus:    "Nge ke muntu ya early-access, nge ta baka bilumbu 60 ya kumeka, na kisika ya 30.",
    closing:  "Beto ta monana nswa.",
    sig:      "Équipe TransLog Pro",
  },
};

export function buildWaitlistEmail(input: WaitlistEmailInput) {
  const b = L[input.locale] ?? L.fr;
  const dir = input.locale === 'ar' ? 'rtl' : 'ltr';

  const html = `<!doctype html>
<html lang="${input.locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TransLog Pro</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#14b8a6,#0f766e);"></span>
            <span style="font-size:15px;font-weight:700;">TransLog<span style="color:#0d9488;">Pro</span></span>
          </div>
        </td></tr>
        <tr><td style="padding:24px 28px;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px 0;">${escapeHtml(b.intro)}</p>
          <p style="margin:0 0 14px 0;color:#0f766e;font-weight:600;">🎁 ${escapeHtml(b.bonus)}</p>
          <p style="margin:0 0 4px 0;">${escapeHtml(b.closing)}</p>
          <p style="margin:12px 0 0 0;color:#475569;">${escapeHtml(b.sig)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [b.intro, '', b.bonus, '', b.closing, '', b.sig].join('\n');

  return { subject: b.subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
