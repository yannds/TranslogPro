/**
 * Templates des 3 emails d'activation (drip post-signup).
 *
 * Déclenchement (cron daily, voir ActivationEmailService) :
 *   day1 — 24h après signup, si onboarding pas terminé → rappel de finaliser
 *   day3 — 72h après signup, si aucun user invité → pousse à inviter l'équipe
 *   day7 — 7 jours, si aucun ticket vendu ni colis enregistré → offre démo live
 *
 * Un tenant ne reçoit AU MAXIMUM que 3 emails d'activation — jamais plus.
 * Chaque envoi est loggé en DB via ActivationEmailLog pour idempotence.
 */

import type { EmailAddress } from '../../../infrastructure/notification/interfaces/email.interface';

export type ActivationLocale = 'fr' | 'en' | 'es' | 'pt' | 'wo' | 'ln' | 'ktu' | 'ar';

export type ActivationDay = 'day1' | 'day3' | 'day7';

export interface ActivationEmailInput {
  to:         EmailAddress;
  adminName:  string;
  tenantName: string;
  tenantSlug: string;
  loginUrl:   string;   // ex: https://acme.translogpro.com/login
  onboardingUrl: string; // ex: https://acme.translogpro.com/onboarding
  locale:     ActivationLocale;
}

interface LocalizedBundle {
  subject: string;
  body:    string;  // Plain text (les fallback HTML sont générés automatiquement)
  cta:     string;
  ctaUrl?: 'login' | 'onboarding'; // résolu à la construction
}

// ─── Libellés par locale ────────────────────────────────────────────────────

const MESSAGES: Record<ActivationDay, Record<ActivationLocale, LocalizedBundle>> = {
  day1: {
    fr: {
      subject: 'Votre espace est prêt — 2 minutes pour le configurer',
      body:    "Bonjour {adminName},\n\nVotre espace {tenantName} est créé — il ne reste que 2 minutes pour le configurer et vendre votre premier billet.\n\nTout ce qu'il vous faut : votre logo, le nom de votre premier point de vente, et un premier trajet.",
      cta:     "Terminer la configuration",
      ctaUrl:  'onboarding',
    },
    en: {
      subject: 'Your workspace is ready — 2 minutes to set it up',
      body:    "Hi {adminName},\n\nYour workspace {tenantName} is created — it only takes 2 more minutes to set it up and sell your first ticket.\n\nAll you need: your logo, the name of your first point of sale, and a first route.",
      cta:     "Finish setup",
      ctaUrl:  'onboarding',
    },
    es: {
      subject: 'Su espacio está listo — 2 minutos para configurarlo',
      body:    "Hola {adminName},\n\nSu espacio {tenantName} está creado — solo faltan 2 minutos para configurarlo y vender su primer billete.\n\nTodo lo que necesita: su logo, el nombre de su primer punto de venta y un primer trayecto.",
      cta:     "Terminar configuración",
      ctaUrl:  'onboarding',
    },
    pt: {
      subject: 'Seu espaço está pronto — 2 minutos para configurar',
      body:    "Olá {adminName},\n\nSeu espaço {tenantName} está criado — faltam apenas 2 minutos para configurá-lo e vender seu primeiro bilhete.\n\nTudo o que precisa: seu logo, o nome do seu primeiro ponto de venda e um primeiro trajeto.",
      cta:     "Terminar configuração",
      ctaUrl:  'onboarding',
    },
    ar: {
      subject: 'مساحتك جاهزة — دقيقتان لإعدادها',
      body:    "مرحبًا {adminName}،\n\nمساحتك {tenantName} أُنشئت — تحتاج فقط إلى دقيقتين لإعدادها وبيع تذكرتك الأولى.\n\nكل ما تحتاجه: شعارك، اسم أول نقطة بيع، وأول رحلة.",
      cta:     "إنهاء الإعداد",
      ctaUrl:  'onboarding',
    },
    wo: {
      subject: 'Sa bopp jëmm na — 2 minutes ngir defar ko',
      body:    "Asalaa maalekum {adminName},\n\nSa bopp {tenantName} defaraangoon na — des na ñaari minut ngir defar ko te jaay sa billet bu njëkk.\n\nLu mu laaj : sa logo, tur ya sa point de vente bu njëkk, ak benn trajet.",
      cta:     "Matal configuration bi",
      ctaUrl:  'onboarding',
    },
    ln: {
      subject: 'Esika na yo ezali ya kosala — miniti 2 mpo na kosilisa',
      body:    "Mbote {adminName},\n\nEsika na yo {tenantName} esilisaki kosalema — etikali kaka miniti mibale mpo na kosilisa mpe koteka billet na yo ya liboso.\n\nOzali kosengela : logo na yo, nkombo ya point de vente na yo ya liboso, mpe mobembo moko.",
      cta:     "Kosilisa configuration",
      ctaUrl:  'onboarding',
    },
    ktu: {
      subject: 'Esika ya nge ke ya kusadisa — miniti 2 mpo na kusilisa',
      body:    "Mbote {adminName},\n\nEsika ya nge {tenantName} silisaki kusalama — etikala kaka miniti zole mpo na kusilisa mpe kuteka billet ya ntete.\n\nNge ke na mposa ya : logo ya nge, zina ya point de vente ya ntete, mpe mobembo mosi.",
      cta:     "Kusilisa configuration",
      ctaUrl:  'onboarding',
    },
  },
  day3: {
    fr: {
      subject: 'Vos équipes vous attendent — invitez-les en 1 minute',
      body:    "Bonjour {adminName},\n\nVotre espace {tenantName} est configuré, mais vous êtes encore seul dessus.\n\nLes compagnies qui invitent au moins un collègue dès la première semaine atteignent leur vitesse de croisière 3× plus vite. Envoyez un email à votre caissier ou votre chef d'agence dès maintenant — ça prend 30 secondes.",
      cta:     "Inviter mon équipe",
      ctaUrl:  'login',
    },
    en: {
      subject: 'Your team is waiting — invite them in 1 minute',
      body:    "Hi {adminName},\n\nYour workspace {tenantName} is set up, but you're still alone on it.\n\nCompanies that invite at least one colleague in the first week reach their cruising speed 3× faster. Send an email to your cashier or branch manager right now — it takes 30 seconds.",
      cta:     "Invite my team",
      ctaUrl:  'login',
    },
    es: {
      subject: 'Su equipo le espera — invítelos en 1 minuto',
      body:    "Hola {adminName},\n\nSu espacio {tenantName} está configurado, pero sigue usted solo.\n\nLas compañías que invitan al menos a un colega en la primera semana alcanzan su velocidad de crucero 3× más rápido. Envíe un email a su cajero o responsable de agencia ahora — son 30 segundos.",
      cta:     "Invitar a mi equipo",
      ctaUrl:  'login',
    },
    pt: {
      subject: 'Sua equipe está à espera — convide-a em 1 minuto',
      body:    "Olá {adminName},\n\nSeu espaço {tenantName} está configurado, mas você ainda está sozinho nele.\n\nEmpresas que convidam pelo menos um colega na primeira semana atingem sua velocidade de cruzeiro 3× mais rápido. Envie um email ao seu caixa ou gerente de agência agora — leva 30 segundos.",
      cta:     "Convidar minha equipe",
      ctaUrl:  'login',
    },
    ar: {
      subject: 'فريقك ينتظرك — ادعه في دقيقة واحدة',
      body:    "مرحبًا {adminName}،\n\nمساحتك {tenantName} جاهزة، لكنّك ما زلت وحدك.\n\nالشركات التي تدعو زميلًا واحدًا على الأقل في الأسبوع الأول تصل إلى سرعة سيرها ٣× أسرع. أرسل بريدًا إلى محاسبك أو مسؤول فرعك الآن — ٣٠ ثانية تكفي.",
      cta:     "دعوة فريقي",
      ctaUrl:  'login',
    },
    wo: {
      subject: 'Sa mbooloo di la xaar — woote leen ci 1 minute',
      body:    "Asalaa maalekum {adminName},\n\nSa bopp {tenantName} defaraangoon na, waaye yaa doon rekk nekk ci kaw.\n\nCompagnies yi woote ci lu naat kenn ci jataayu yi bu njëkk, ñu agsi ci seen vitesse ba 3× gën gaaw. Yónnee email ci sa caissier walla sa chef d'agence leegi — 30 secondes doy na.",
      cta:     "Woote sama mbooloo",
      ctaUrl:  'login',
    },
    ln: {
      subject: 'Équipe na yo ezali kozela yo — benga bango na miniti moko',
      body:    "Mbote {adminName},\n\nEsika na yo {tenantName} ezali ya kosala, kasi ozali kaka yo moko.\n\nBisika oyo bibengaka moninga na yambo na pɔsɔ ya yambo bakokaki kokoma mbangu na bango 3× noki. Tinda email na caissier to chef d'agence sikoyo — ezali na segɔndɛ 30.",
      cta:     "Benga équipe na ngai",
      ctaUrl:  'login',
    },
    ktu: {
      subject: 'Équipe ya nge ke kuzela nge — benga yau na miniti mosi',
      body:    "Mbote {adminName},\n\nEsika ya nge {tenantName} ke ya kusalama, kasi nge ke kaka nge mosi.\n\nBisika yina ke kubenga muntu mosi mpamba na pɔsɔ ya ntete ke kukoka kukoma na nswa ya bau 3× noki. Tinda email na caissier to chef d'agence sika — ezali na sekondɛ 30.",
      cta:     "Benga équipe ya mu",
      ctaUrl:  'login',
    },
  },
  day7: {
    fr: {
      subject: 'On vous montre le produit en 15 minutes ?',
      body:    "Bonjour {adminName},\n\nCa fait une semaine que vous avez créé {tenantName}, et on remarque que vous n'avez pas encore effectué votre première transaction.\n\nC'est courant : vendre un premier billet sur une nouvelle plateforme demande souvent un coup de main. On vous propose une démo personnalisée de 15 minutes — vous nous montrez votre opérations, on vous montre comment les répliquer dans TransLog Pro.",
      cta:     "Réserver une démo",
      ctaUrl:  'login',
    },
    en: {
      subject: 'Want a 15-minute product walkthrough?',
      body:    "Hi {adminName},\n\nIt's been a week since you created {tenantName}, and we notice you haven't run your first transaction yet.\n\nThat's common — selling a first ticket on a new platform often needs a guiding hand. We offer a personalized 15-minute demo: you show us your operations, we show you how to replicate them in TransLog Pro.",
      cta:     "Book a demo",
      ctaUrl:  'login',
    },
    es: {
      subject: '¿Le mostramos el producto en 15 minutos?',
      body:    "Hola {adminName},\n\nHace una semana que creó {tenantName} y observamos que aún no ha realizado su primera transacción.\n\nEs normal: vender el primer billete en una nueva plataforma suele necesitar un empujón. Le ofrecemos una demo personalizada de 15 minutos — usted nos muestra sus operaciones, nosotros le mostramos cómo replicarlas en TransLog Pro.",
      cta:     "Reservar una demo",
      ctaUrl:  'login',
    },
    pt: {
      subject: 'Quer uma demo do produto em 15 minutos?',
      body:    "Olá {adminName},\n\nFaz uma semana que você criou {tenantName} e notamos que ainda não fez sua primeira transação.\n\nÉ comum — vender o primeiro bilhete numa nova plataforma geralmente precisa de um empurrão. Oferecemos uma demo personalizada de 15 minutos: você nos mostra suas operações, nós mostramos como replicá-las no TransLog Pro.",
      cta:     "Reservar uma demo",
      ctaUrl:  'login',
    },
    ar: {
      subject: 'هل نعرض لك المنتج في 15 دقيقة؟',
      body:    "مرحبًا {adminName}،\n\nمرّ أسبوع منذ أنشأت {tenantName}، ونلاحظ أنك لم تُجرِ أول معاملة بعد.\n\nهذا أمر شائع — بيع أول تذكرة على منصة جديدة يحتاج غالبًا إلى مساعدة. نعرض عليك عرضًا مخصصًا مدته ١٥ دقيقة: تعرض لنا عملياتك، ونعرض لك كيف نكررها في TransLog Pro.",
      cta:     "حجز عرض توضيحي",
      ctaUrl:  'login',
    },
    wo: {
      subject: 'Danoo la won app bi ci 15 minutes ?',
      body:    "Asalaa maalekum {adminName},\n\nJuróom-benn fan la ñu am ba nga sos {tenantName}, te gisunu nga def sa premier transaction bi.\n\nLi baax la — jaay premier billet ci benn plateforme bu bees dañuy soxla lu soriyaanu. Danuy la jox démo bu personnalisé bu am 15 minutes — yaa di nu won sa opérations yi, nun dinañu la won ni ngay defar leen ci TransLog Pro.",
      cta:     "Reservé démo bi",
      ctaUrl:  'login',
    },
    ln: {
      subject: 'Tolakisa yo produit na miniti 15 ?',
      body:    "Mbote {adminName},\n\nEsali pɔsɔ na nini osalaki {tenantName}, mpe tomonaka ete osali naino transaction ya liboso te.\n\nEzali likambo ya kozangisa te — koteka billet ya liboso na plateforme ya sika esengaka mbala mingi lisalisi. Topesi yo démo ya personnalisée ya miniti 15 — okolakisa biso opération na yo, biso tokolakisa yo ndenge ya kosala yango na TransLog Pro.",
      cta:     "Reservé démo",
      ctaUrl:  'login',
    },
    ktu: {
      subject: 'Beto lakisa nge produit na miniti 15 ?',
      body:    "Mbote {adminName},\n\nPɔsɔ yina sosaki nge {tenantName}, mpe beto monaka ti nge salaki ntete transaction ve.\n\nEzali diambu ya kuzanga ve — kuteka billet ya ntete na plateforme ya sika ke kulomba mingi lisungi. Beto ke kupesa nge démo ya personnalisée ya miniti 15 — nge ta lakisa beto opération ya nge, beto ta lakisa nge mutindu ya kusala yau na TransLog Pro.",
      cta:     "Reservé démo",
      ctaUrl:  'login',
    },
  },
};

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildActivationEmail(day: ActivationDay, input: ActivationEmailInput) {
  const bundle = MESSAGES[day][input.locale] ?? MESSAGES[day].fr;
  const subject = fill(bundle.subject, { adminName: input.adminName, tenantName: input.tenantName });
  const bodyTxt = fill(bundle.body,    { adminName: input.adminName, tenantName: input.tenantName });
  const ctaUrl  = bundle.ctaUrl === 'onboarding' ? input.onboardingUrl : input.loginUrl;
  const dir     = input.locale === 'ar' ? 'rtl' : 'ltr';

  const html = renderHtml({ dir, locale: input.locale, body: bodyTxt, cta: bundle.cta, ctaUrl });
  const text = `${bodyTxt}\n\n${bundle.cta}: ${ctaUrl}\n\n— TransLog Pro`;

  return { subject, html, text };
}

function fill(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
}

function renderHtml({
  dir, locale, body, cta, ctaUrl,
}: { dir: 'ltr' | 'rtl'; locale: string; body: string; cta: string; ctaUrl: string }): string {
  const paragraphs = body.split('\n\n').map(p => `<p style="margin:0 0 14px 0;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TransLog Pro</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#14b8a6,#0f766e);"></span>
            <span style="font-size:17px;font-weight:700;letter-spacing:-0.01em;">TransLog<span style="color:#0d9488;">Pro</span></span>
          </div>
        </td></tr>
        <tr><td style="padding:28px 28px 8px 28px;font-size:15px;line-height:1.6;">
          ${paragraphs}
        </td></tr>
        <tr><td style="padding:8px 28px 28px 28px;">
          <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
            ${escapeHtml(cta)} →
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
