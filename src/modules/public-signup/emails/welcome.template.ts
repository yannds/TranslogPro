/**
 * Template email de bienvenue — envoyé juste après la création d'un tenant
 * via `/api/public/signup`.
 *
 * Pas de moteur de templating externe : string-interpolation typée. Simple,
 * auditable, facile à migrer vers MJML/Handlebars si le besoin grandit.
 *
 * Les 8 locales supportées tombent en fallback sur 'fr' si la clé manque.
 */

import type { EmailAddress } from '../../../infrastructure/notification/interfaces/email.interface';

export type SignupLocale = 'fr' | 'en' | 'es' | 'pt' | 'wo' | 'ln' | 'ktu' | 'ar';

export interface WelcomeEmailInput {
  to:         EmailAddress;
  adminName:  string;
  tenantName: string;
  tenantUrl:  string;          // ex: https://acme.translogpro.com
  loginUrl:   string;          // ex: https://acme.translogpro.com/login
  trialDays:  number;          // 0 si pas de trial
  locale:     SignupLocale;
}

interface LocaleBundle {
  subject:      string;
  preheader:    string;
  greeting:     string;
  intro:        string;
  trial:        string;
  ctaLabel:     string;
  tipsTitle:    string;
  tip1:         string;
  tip2:         string;
  tip3:         string;
  closing:      string;
  signature:    string;
  support:      string;
  legalNote:    string;
}

const L: Record<SignupLocale, LocaleBundle> = {
  fr: {
    subject:    "Bienvenue sur TransLog Pro, {tenantName} 🎉",
    preheader:  "Votre espace est prêt. Voici comment commencer.",
    greeting:   "Bonjour {adminName},",
    intro:      "Votre espace <strong>{tenantName}</strong> est prêt sur TransLog Pro. Vous pouvez vous connecter dès maintenant.",
    trial:      "Vous bénéficiez de <strong>{trialDays} jours d'essai gratuit</strong>. Aucune carte bancaire requise.",
    ctaLabel:   "Accéder à mon espace",
    tipsTitle:  "Pour démarrer rapidement :",
    tip1:       "Configurez votre logo et vos couleurs",
    tip2:       "Créez votre premier trajet ou tarif colis",
    tip3:       "Invitez votre équipe (caissier, manager, chauffeur)",
    closing:    "Besoin d'aide ? Répondez à cet email — on vous répond en quelques heures.",
    signature:  "L'équipe TransLog Pro",
    support:    "Support : support@translogpro.com",
    legalNote:  "Cet email a été envoyé à {to} suite à votre inscription sur TransLog Pro.",
  },
  en: {
    subject:    "Welcome to TransLog Pro, {tenantName} 🎉",
    preheader:  "Your workspace is ready. Here's how to get started.",
    greeting:   "Hi {adminName},",
    intro:      "Your workspace <strong>{tenantName}</strong> is ready on TransLog Pro. You can sign in right now.",
    trial:      "You've got <strong>{trialDays} free trial days</strong>. No credit card required.",
    ctaLabel:   "Go to my workspace",
    tipsTitle:  "To get started quickly:",
    tip1:       "Set up your logo and brand colors",
    tip2:       "Create your first route or parcel pricing",
    tip3:       "Invite your team (cashier, manager, driver)",
    closing:    "Need help? Just reply to this email — we'll respond in a few hours.",
    signature:  "The TransLog Pro team",
    support:    "Support: support@translogpro.com",
    legalNote:  "This email was sent to {to} following your signup on TransLog Pro.",
  },
  es: {
    subject:    "Bienvenido a TransLog Pro, {tenantName} 🎉",
    preheader:  "Su espacio está listo. Así se empieza.",
    greeting:   "Hola {adminName},",
    intro:      "Su espacio <strong>{tenantName}</strong> está listo en TransLog Pro. Puede iniciar sesión ahora mismo.",
    trial:      "Dispone de <strong>{trialDays} días de prueba gratis</strong>. Sin tarjeta.",
    ctaLabel:   "Acceder a mi espacio",
    tipsTitle:  "Para empezar rápido:",
    tip1:       "Configure su logo y colores",
    tip2:       "Cree su primer trayecto o tarifa de paquetes",
    tip3:       "Invite a su equipo (cajero, manager, conductor)",
    closing:    "¿Necesita ayuda? Responda a este email — le contestamos en pocas horas.",
    signature:  "El equipo TransLog Pro",
    support:    "Soporte: support@translogpro.com",
    legalNote:  "Este email se envió a {to} tras su registro en TransLog Pro.",
  },
  pt: {
    subject:    "Bem-vindo à TransLog Pro, {tenantName} 🎉",
    preheader:  "Seu espaço está pronto. Veja como começar.",
    greeting:   "Olá {adminName},",
    intro:      "Seu espaço <strong>{tenantName}</strong> está pronto na TransLog Pro. Você pode entrar agora.",
    trial:      "Você tem <strong>{trialDays} dias de avaliação grátis</strong>. Sem cartão.",
    ctaLabel:   "Acessar meu espaço",
    tipsTitle:  "Para começar rápido:",
    tip1:       "Configure seu logo e cores",
    tip2:       "Crie seu primeiro trajeto ou tarifa de encomendas",
    tip3:       "Convide sua equipe (caixa, gerente, motorista)",
    closing:    "Precisa de ajuda? Responda a este email — respondemos em algumas horas.",
    signature:  "A equipe TransLog Pro",
    support:    "Suporte: support@translogpro.com",
    legalNote:  "Este email foi enviado para {to} após sua inscrição na TransLog Pro.",
  },
  ar: {
    subject:    "مرحبًا بك في TransLog Pro، {tenantName} 🎉",
    preheader:  "مساحتك جاهزة. إليك كيف تبدأ.",
    greeting:   "مرحبًا {adminName}،",
    intro:      "مساحتك <strong>{tenantName}</strong> جاهزة على TransLog Pro. يمكنك تسجيل الدخول الآن.",
    trial:      "لديك <strong>{trialDays} يومًا تجريبيًا مجانيًا</strong>. لا حاجة إلى بطاقة.",
    ctaLabel:   "الدخول إلى مساحتي",
    tipsTitle:  "للبدء بسرعة:",
    tip1:       "اضبط شعارك وألوان علامتك",
    tip2:       "أنشئ أول رحلة أو سعر طرد",
    tip3:       "ادعُ فريقك (محاسب، مدير، سائق)",
    closing:    "هل تحتاج مساعدة؟ ردّ على هذا البريد — نردّ في بضع ساعات.",
    signature:  "فريق TransLog Pro",
    support:    "الدعم: support@translogpro.com",
    legalNote:  "أُرسل هذا البريد إلى {to} بعد تسجيلك في TransLog Pro.",
  },
  wo: {
    subject:    "Dalal ak jàmm ci TransLog Pro, {tenantName} 🎉",
    preheader:  "Sa bopp jëmm na. Ngir tàmbali lu gaaw.",
    greeting:   "Asalaa maalekum {adminName},",
    intro:      "Sa bopp <strong>{tenantName}</strong> jëmm na ci TransLog Pro. Man nga duggu leegi.",
    trial:      "Am nga <strong>{trialDays} fan yi nga ñaan ci yor</strong>. Amul carte bancaire.",
    ctaLabel:   "Dugg ci sa bopp",
    tipsTitle:  "Ngir tàmbali lu gaaw :",
    tip1:       "Defar sa logo ak sa kuléer",
    tip2:       "Defar sa tall bu njëkk ak sa taxe colis",
    tip3:       "Woote sa mbooloo (caissier, manager, chauffeur)",
    closing:    "Soxla nga ndimbal ? Tontuwaal ci email bi — dinañu la tontu ci ay waxtu.",
    signature:  "Mbooloo TransLog Pro",
    support:    "Ndimbal : support@translogpro.com",
    legalNote:  "Email bii yónne nañu ko ci {to} ginnaaw bi nga bind ci TransLog Pro.",
  },
  ln: {
    subject:    "Boyei malamu na TransLog Pro, {tenantName} 🎉",
    preheader:  "Esika na yo ezali ya kosala. Talá boni kobanda.",
    greeting:   "Mbote {adminName},",
    intro:      "Esika na yo <strong>{tenantName}</strong> ezali ya kosala na TransLog Pro. Okoki kokota sikoyo.",
    trial:      "Ozali na <strong>mikolo {trialDays} ya komeka ya ofele</strong>. Carte bancaire te.",
    ctaLabel:   "Kokota na esika na ngai",
    tipsTitle:  "Mpo na kobanda noki :",
    tip1:       "Tia logo na yo mpe langi na yo",
    tip2:       "Sala mobembo ya yambo to ntalo ya bakolo",
    tip3:       "Benga équipe na yo (caissier, manager, chauffeur)",
    closing:    "Ozali na mposa ya lisalisi? Zongisa na email oyo — tokozongisa na bangonga moke.",
    signature:  "Équipe TransLog Pro",
    support:    "Lisalisi : support@translogpro.com",
    legalNote:  "Email oyo etindamaki na {to} sima ya bokotisi na yo na TransLog Pro.",
  },
  ktu: {
    subject:    "Beto kuyambula nge na TransLog Pro, {tenantName} 🎉",
    preheader:  "Esika ya nge ke ya kusadisa. Talá mutindu ya kubanda.",
    greeting:   "Mbote {adminName},",
    intro:      "Esika ya nge <strong>{tenantName}</strong> ke ya kusadisa na TransLog Pro. Nge lenda kota sika.",
    trial:      "Nge ke na <strong>bilumbu {trialDays} ya kumeka ya ofele</strong>. Carte bancaire ve.",
    ctaLabel:   "Kota na esika ya mu",
    tipsTitle:  "Mpo na kubanda nswa :",
    tip1:       "Tula logo ya nge mpe ndongo ya nge",
    tip2:       "Sala mobembo ya ntete to ntalo ya bakolo",
    tip3:       "Binga équipe ya nge (caissier, manager, chauffeur)",
    closing:    "Nge ke na mposa ya lisungi ? Vutula na email yayi — beto ta vutula na bangonga fioti.",
    signature:  "Équipe TransLog Pro",
    support:    "Lisungi : support@translogpro.com",
    legalNote:  "Email yayi tindaki na {to} na nima ya bokotisi ya nge na TransLog Pro.",
  },
};

function fill(tmpl: string, vars: Record<string, string | number>): string {
  return tmpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function resolve(locale: SignupLocale): LocaleBundle {
  return L[locale] ?? L.fr;
}

export function buildWelcomeEmail(input: WelcomeEmailInput) {
  const bundle = resolve(input.locale);
  const vars = {
    adminName:  input.adminName,
    tenantName: input.tenantName,
    tenantUrl:  input.tenantUrl,
    loginUrl:   input.loginUrl,
    trialDays:  input.trialDays,
    to:         input.to.email,
  };

  const subject    = fill(bundle.subject,    vars);
  const preheader  = fill(bundle.preheader,  vars);
  const intro      = fill(bundle.intro,      vars);
  const trialLine  = input.trialDays > 0 ? fill(bundle.trial, vars) : '';
  const greeting   = fill(bundle.greeting,   vars);
  const legalNote  = fill(bundle.legalNote,  vars);

  const dir = input.locale === 'ar' ? 'rtl' : 'ltr';

  const html = renderHtml({
    dir,
    locale: input.locale,
    preheader,
    greeting,
    intro,
    trialLine,
    tipsTitle: bundle.tipsTitle,
    tips: [bundle.tip1, bundle.tip2, bundle.tip3],
    ctaLabel: bundle.ctaLabel,
    ctaUrl:   input.loginUrl,
    closing:  bundle.closing,
    signature: bundle.signature,
    support:  bundle.support,
    legalNote,
  });

  const text = [
    greeting,
    '',
    stripHtml(intro),
    ...(trialLine ? ['', stripHtml(trialLine)] : []),
    '',
    `${bundle.tipsTitle}`,
    `  • ${bundle.tip1}`,
    `  • ${bundle.tip2}`,
    `  • ${bundle.tip3}`,
    '',
    `${bundle.ctaLabel}: ${input.loginUrl}`,
    '',
    bundle.closing,
    '',
    bundle.signature,
    bundle.support,
    '',
    '—',
    legalNote,
  ].join('\n');

  return { subject, html, text };
}

// ─── Layout HTML transactionnel ──────────────────────────────────────────────

interface RenderArgs {
  dir:       'ltr' | 'rtl';
  locale:    string;
  preheader: string;
  greeting:  string;
  intro:     string;
  trialLine: string;
  tipsTitle: string;
  tips:      string[];
  ctaLabel:  string;
  ctaUrl:    string;
  closing:   string;
  signature: string;
  support:   string;
  legalNote: string;
}

function renderHtml(a: RenderArgs): string {
  // Mise en page email robuste : tables imbriquées, inline CSS (Gmail, Outlook,
  // Apple Mail, mobile). Aucune ressource externe (images, fonts CDN).
  return `<!doctype html>
<html lang="${a.locale}" dir="${a.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TransLog Pro</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <span style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(a.preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#14b8a6,#0f766e);"></span>
                <span style="font-size:17px;font-weight:700;letter-spacing:-0.01em;">TransLog<span style="color:#0d9488;">Pro</span></span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">${escapeHtml(a.greeting)}</p>
              <p style="margin:0 0 16px 0;">${a.intro}</p>
              ${a.trialLine ? `<p style="margin:0 0 16px 0;color:#0f766e;">${a.trialLine}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 20px 28px;">
              <a href="${escapeAttr(a.ctaUrl)}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
                ${escapeHtml(a.ctaLabel)} →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 24px 28px;font-size:14px;line-height:1.6;color:#334155;">
              <p style="margin:0 0 10px 0;font-weight:600;color:#0f172a;">${escapeHtml(a.tipsTitle)}</p>
              <ul style="margin:0;padding-${a.dir === 'rtl' ? 'right' : 'left'}:18px;">
                ${a.tips.map(tip => `<li style="margin:4px 0;">${escapeHtml(tip)}</li>`).join('\n')}
              </ul>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px 28px;font-size:14px;line-height:1.6;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px 0;">${escapeHtml(a.closing)}</p>
              <p style="margin:12px 0 4px 0;color:#475569;">${escapeHtml(a.signature)}</p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">${escapeHtml(a.support)}</p>
            </td>
          </tr>
        </table>
        <p style="max-width:560px;margin:12px auto 0 auto;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
          ${escapeHtml(a.legalNote)}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
