import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EMAIL_SERVICE, IEmailService } from '../../infrastructure/notification/interfaces/email.interface';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { EventTypes } from '../../common/types/domain-event.type';

type DunningDay = 'day1' | 'day3' | 'day7';
type DunningLocale = 'fr' | 'en' | 'es' | 'pt' | 'wo' | 'ln' | 'ktu' | 'ar';

/**
 * SubscriptionDunningService — gère les relances quand un paiement échoue.
 *
 * Deux responsabilités :
 *
 *   1. Handler `PAYMENT_INTENT_FAILED` : pour un Intent SUBSCRIPTION, bascule
 *      la souscription en `PAST_DUE` et horodate `pastDueSince`. Idempotent :
 *      ignore si la sub est déjà PAST_DUE ou si l'Intent échoué concerne une
 *      ancienne période.
 *
 *   2. Cron quotidien (11h) : parcourt les subs `PAST_DUE` et envoie jusqu'à
 *      3 rappels basés sur `pastDueSince` :
 *        day1 — 24h+   → message informatif, "réessayez le paiement"
 *        day3 — 72h+   → message plus ferme, rappel du risque de suspension
 *        day7 — 168h+  → dernier avertissement + passage probable en SUSPENDED
 *
 * Idempotence : `externalRefs.dunningSent['day1'|'day3'|'day7']` → timestamp.
 * Reset à `{}` dans SubscriptionReconciliationService après un paiement réussi.
 *
 * Après day7, si toujours PAST_DUE, la sub passe en `SUSPENDED` — l'admin
 * tenant perd l'accès (le frontend doit surfacer un écran dédié ; pas inclus
 * ici, simple changement de statut DB).
 *
 * Toggle runtime : `DUNNING_EMAILS_ENABLED=false`.
 */
@Injectable()
export class SubscriptionDunningService {
  private readonly logger = new Logger(SubscriptionDunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
  ) {}

  // ─── Handler : Intent SUBSCRIPTION FAILED → sub PAST_DUE ────────────────────

  @OnEvent(EventTypes.PAYMENT_INTENT_FAILED)
  async onPaymentFailed(payload: {
    tenantId: string; intentId: string; entityType: string; entityId: string | null;
  }) {
    if (payload.entityType !== 'SUBSCRIPTION' || !payload.entityId) return;

    try {
      const sub = await this.prisma.platformSubscription.findUnique({
        where:   { id: payload.entityId },
        select:  { id: true, tenantId: true, status: true, pastDueSince: true, externalRefs: true },
      });
      if (!sub) return;
      if (sub.tenantId !== payload.tenantId) {
        this.logger.error(`Cross-tenant dunning mismatch for intent=${payload.intentId} — abort`);
        return;
      }
      if (sub.status === 'PAST_DUE' && sub.pastDueSince) {
        // Déjà PAST_DUE : on ne recommence pas le compteur. Un échec après
        // une tentative de rattrapage perdrait la fenêtre dunning initiale.
        this.logger.debug(`Subscription ${sub.id} déjà PAST_DUE — pas de re-horodatage`);
        return;
      }
      if (sub.status === 'CANCELLED' || sub.status === 'SUSPENDED') {
        this.logger.debug(`Subscription ${sub.id} status=${sub.status} — dunning ignoré`);
        return;
      }

      const now = new Date();
      await this.prisma.platformSubscription.update({
        where: { id: sub.id },
        data:  {
          status:       'PAST_DUE',
          pastDueSince: now,
          // Reset du tracking dunning en cas de re-déclenchement après retour ACTIVE
          externalRefs: {
            ...(sub.externalRefs as Record<string, unknown>),
            dunningSent: {},
          },
        },
      });
      this.logger.log(`[dunning] tenant=${sub.tenantId} sub=${sub.id} → PAST_DUE at ${now.toISOString()}`);
    } catch (err) {
      this.logger.error(`onPaymentFailed failed for intent=${payload.intentId}: ${(err as Error).message}`);
    }
  }

  // ─── Cron : 3 rappels + escalade SUSPENDED ──────────────────────────────────

  @Cron('0 11 * * *') // 11:00 — convention scheduling
  async runDailyDunning(): Promise<void> {
    if (process.env.DUNNING_EMAILS_ENABLED === 'false') {
      this.logger.log('Skipped — DUNNING_EMAILS_ENABLED=false');
      return;
    }
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const [day1Hrs, day3Hrs, day7Hrs, suspendAfterDays] = await Promise.all([
      this.config.getNumber('dunning.day1.hours'),
      this.config.getNumber('dunning.day3.hours'),
      this.config.getNumber('dunning.day7.hours'),
      this.config.getNumber('dunning.suspendAfterDays'),
    ]);

    const subs = await this.prisma.platformSubscription.findMany({
      where: { status: 'PAST_DUE', pastDueSince: { not: null } },
      include: {
        plan:   { select: { name: true, price: true, currency: true } },
        tenant: {
          select: {
            id: true, name: true, slug: true, language: true,
            users: {
              where:   { userType: 'STAFF' },
              orderBy: { id: 'asc' },
              take:    1,
              select:  { email: true, name: true },
            },
          },
        },
      },
    });

    let emailsSent = 0;
    let suspended  = 0;

    for (const sub of subs) {
      if (!sub.tenant || !sub.plan || !sub.pastDueSince) continue;
      const admin = sub.tenant.users[0];
      if (!admin?.email) continue;

      const hours = (now - sub.pastDueSince.getTime()) / (1000 * 60 * 60);
      const refs = (sub.externalRefs ?? {}) as Record<string, any>;
      const dunningSent = (refs.dunningSent ?? {}) as Record<string, string>;

      // Détermine quel email envoyer (le plus avancé non encore envoyé).
      let day: DunningDay | null = null;
      if (hours >= day7Hrs && !dunningSent.day7) day = 'day7';
      else if (hours >= day3Hrs && !dunningSent.day3) day = 'day3';
      else if (hours >= day1Hrs && !dunningSent.day1) day = 'day1';

      // Escalade SUSPENDED après `suspendAfterDays` en PAST_DUE + day7 envoyé.
      if (!day && hours >= suspendAfterDays * 24 && dunningSent.day7) {
        await this.prisma.platformSubscription.update({
          where: { id: sub.id },
          data:  { status: 'SUSPENDED' },
        });
        this.logger.warn(`[dunning] tenant=${sub.tenant.slug} sub=${sub.id} → SUSPENDED (10j PAST_DUE)`);
        suspended++;
        continue;
      }
      if (!day) continue;

      const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? 'translogpro.com';
      const billingUrl = `https://${sub.tenant.slug}.${baseDomain}/admin/billing`;

      try {
        const { subject, html, text } = buildDunningEmail(day, {
          adminName:   admin.name ?? admin.email.split('@')[0]!,
          tenantName:  sub.tenant.name,
          planName:    sub.plan.name,
          price:       sub.plan.price,
          currency:    sub.plan.currency,
          billingUrl,
          locale:      (sub.tenant.language as DunningLocale) ?? 'fr',
        });

        await this.email.send({
          to:       { email: admin.email, name: admin.name ?? undefined },
          subject,
          html,
          text,
          category: 'transactional',
          tenantId: sub.tenant.id,
          idempotencyKey: `dunning:${sub.id}:${day}`,
        });

        await this.prisma.platformSubscription.update({
          where: { id: sub.id },
          data:  {
            externalRefs: {
              ...refs,
              dunningSent: { ...dunningSent, [day]: new Date().toISOString() },
            },
          },
        });

        this.logger.log(`[dunning] ${day} sent to tenant=${sub.tenant.slug}`);
        emailsSent++;
      } catch (err) {
        this.logger.warn(`[dunning] ${day} failed for tenant=${sub.tenant.slug}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`◀ Dunning done — ${emailsSent} email(s), ${suspended} suspension(s)`);
  }
}

// ─── Templates (3 jours × 8 locales) ────────────────────────────────────────

interface DunningInput {
  adminName:  string;
  tenantName: string;
  planName:   string;
  price:      number;
  currency:   string;
  billingUrl: string;
  locale:     DunningLocale;
}

const MSG: Record<DunningDay, Record<DunningLocale, { subject: string; body: string; cta: string }>> = {
  day1: {
    fr: {
      subject: "Paiement échoué — mettez à jour votre moyen de paiement",
      body:    "Bonjour {adminName},\n\nVotre dernier paiement pour {tenantName} ({planName}, {price} {currency}) n'a pas abouti. Aucun souci — mettez à jour votre moyen de paiement depuis votre espace billing et relancez le paiement en un clic.",
      cta:     "Gérer mon paiement",
    },
    en: {
      subject: "Payment failed — update your payment method",
      body:    "Hi {adminName},\n\nYour last payment for {tenantName} ({planName}, {price} {currency}) didn't go through. No worries — update your payment method from billing and retry in one click.",
      cta:     "Manage payment",
    },
    es: {
      subject: "Pago fallido — actualice su método de pago",
      body:    "Hola {adminName},\n\nSu último pago para {tenantName} ({planName}, {price} {currency}) no se completó. Actualice su método de pago desde su espacio y reintente en un clic.",
      cta:     "Gestionar pago",
    },
    pt: {
      subject: "Pagamento falhou — atualize seu método de pagamento",
      body:    "Olá {adminName},\n\nSeu último pagamento para {tenantName} ({planName}, {price} {currency}) não foi concluído. Atualize seu método de pagamento e tente novamente com um clique.",
      cta:     "Gerenciar pagamento",
    },
    ar: {
      subject: "فشل الدفع — حدِّث وسيلة الدفع",
      body:    "مرحبًا {adminName}،\n\nلم يكتمل الدفع الأخير لـ {tenantName} ({planName}, {price} {currency}). حدِّث وسيلة الدفع من مساحتك وأعد المحاولة بنقرة واحدة.",
      cta:     "إدارة الدفع",
    },
    wo: {
      subject: "Paiement bi antu — defaral sa moyen de paiement",
      body:    "Asalaa maalekum {adminName},\n\nPaiement bi mu génn ngir {tenantName} ({planName}, {price} {currency}) antuwul. Defaral sa moyen de paiement ci sa bopp, ba mu noppi am fàttaliku bi.",
      cta:     "Saytu paiement bi",
    },
    ln: {
      subject: "Paiement esukaki mabe — bongola moyen ya paiement",
      body:    "Mbote {adminName},\n\nPaiement ya yo ya nsuka mpo na {tenantName} ({planName}, {price} {currency}) esalemaki te. Bongola moyen ya paiement na yo mpe meka lisusu na click moko.",
      cta:     "Kosalela paiement",
    },
    ktu: {
      subject: "Paiement kunaka ve — bongisa moyen ya paiement",
      body:    "Mbote {adminName},\n\nPaiement ya nge ya nsuka sambu na {tenantName} ({planName}, {price} {currency}) salamaki ve. Bongisa moyen ya paiement ya nge mpe meka diaka na click mosi.",
      cta:     "Kusadisa paiement",
    },
  },
  day3: {
    fr: {
      subject: "Rappel : mettez à jour votre paiement pour éviter l'interruption",
      body:    "Bonjour {adminName},\n\nLe paiement de votre abonnement {planName} pour {tenantName} est toujours en attente depuis 3 jours. Sans action de votre part dans les prochains jours, votre accès pourrait être suspendu.\n\nMerci de régler la situation dès que possible.",
      cta:     "Régler maintenant",
    },
    en: {
      subject: "Reminder: update your payment to avoid interruption",
      body:    "Hi {adminName},\n\nYour payment for {planName} on {tenantName} has been pending for 3 days. Without action in the coming days, your access may be suspended.\n\nPlease resolve this as soon as possible.",
      cta:     "Pay now",
    },
    es: {
      subject: "Recordatorio: actualice su pago para evitar la interrupción",
      body:    "Hola {adminName},\n\nEl pago de su suscripción {planName} para {tenantName} lleva 3 días pendiente. Sin acción en los próximos días, su acceso podría ser suspendido.\n\nPor favor regularice cuanto antes.",
      cta:     "Pagar ahora",
    },
    pt: {
      subject: "Lembrete: atualize seu pagamento para evitar interrupção",
      body:    "Olá {adminName},\n\nO pagamento da sua assinatura {planName} para {tenantName} está pendente há 3 dias. Sem ação nos próximos dias, seu acesso pode ser suspenso.\n\nPor favor regularize o quanto antes.",
      cta:     "Pagar agora",
    },
    ar: {
      subject: "تذكير: حدِّث دفعتك لتجنّب انقطاع الخدمة",
      body:    "مرحبًا {adminName}،\n\nدفعتك للاشتراك {planName} لـ {tenantName} معلّقة منذ ٣ أيام. بدون تحرّك خلال الأيام القادمة، قد يُعلَّق وصولك.\n\nيُرجى حلّ الأمر بأسرع ما يمكن.",
      cta:     "ادفع الآن",
    },
    wo: {
      subject: "Fàttaliku : defaral sa paiement, bañ ku taxaw",
      body:    "Asalaa maalekum {adminName},\n\nPaiement ba sa abonnement {planName} ngir {tenantName} fi 3 fan taxaw na. Su amul jëfandikoo ci ay fan, sa accès bi mën a taxaw.\n\nJëfandikoo lu gaaw, sunu sama bopp.",
      cta:     "Fey leegi",
    },
    ln: {
      subject: "Bokundoli : bongola paiement na yo mpo etelema te",
      body:    "Mbote {adminName},\n\nPaiement ya abonnement {planName} mpo na {tenantName} ezali kozela uta mikolo 3. Soki osali eloko te na mikolo mike oyo, accès na yo ekoki kotelema.\n\nBongisa likambo noki.",
      cta:     "Futa sikoyo",
    },
    ktu: {
      subject: "Lusungulu : bongisa paiement ya nge mpo ete etelama ve",
      body:    "Mbote {adminName},\n\nPaiement ya abonnement {planName} sambu na {tenantName} ke kuzela na bilumbu 3. Kana nge sala eloko ve na bilumbu ya kulanda, accès ya nge lenda telama.\n\nBongisa diambu yayi nswa.",
      cta:     "Futa sika",
    },
  },
  day7: {
    fr: {
      subject: "Dernier avertissement — suspension imminente",
      body:    "Bonjour {adminName},\n\n7 jours se sont écoulés sans régularisation du paiement pour {tenantName} ({planName}, {price} {currency}). Sans action dans les 72h, l'accès à votre espace sera suspendu : vente, caisse et données resteront en sécurité mais non-accessibles.\n\nNous sommes là pour vous aider — répondez simplement à cet email si vous avez un problème.",
      cta:     "Régulariser maintenant",
    },
    en: {
      subject: "Final warning — suspension imminent",
      body:    "Hi {adminName},\n\nIt's been 7 days without payment for {tenantName} ({planName}, {price} {currency}). Without action in the next 72h, access to your workspace will be suspended: sales, POS and data will remain safe but inaccessible.\n\nWe're here to help — just reply to this email if you're having trouble.",
      cta:     "Resolve now",
    },
    es: {
      subject: "Último aviso — suspensión inminente",
      body:    "Hola {adminName},\n\nHan pasado 7 días sin regularizar el pago de {tenantName} ({planName}, {price} {currency}). Sin acción en las próximas 72h, el acceso a su espacio será suspendido: ventas, caja y datos quedarán seguros pero inaccesibles.\n\nEstamos aquí para ayudar — responda a este email si tiene problemas.",
      cta:     "Regularizar ahora",
    },
    pt: {
      subject: "Último aviso — suspensão iminente",
      body:    "Olá {adminName},\n\nJá se passaram 7 dias sem regularizar o pagamento para {tenantName} ({planName}, {price} {currency}). Sem ação nas próximas 72h, o acesso ao seu espaço será suspenso: vendas, caixa e dados ficarão seguros mas inacessíveis.\n\nEstamos aqui para ajudar — responda a este email se tiver problemas.",
      cta:     "Regularizar agora",
    },
    ar: {
      subject: "تحذير أخير — الإيقاف وشيك",
      body:    "مرحبًا {adminName}،\n\nمرّت ٧ أيام دون تسوية الدفع لـ {tenantName} ({planName}, {price} {currency}). بدون تحرّك في ٧٢ ساعة، سيُعلَّق وصولك إلى مساحتك: ستظل المبيعات والصندوق والبيانات آمنة لكن غير متاحة.\n\nنحن هنا لمساعدتك — ردّ على هذا البريد إذا واجهت مشكلة.",
      cta:     "تسوية الآن",
    },
    wo: {
      subject: "Fàttaliku sa ñépp — taxaw bi jege",
      body:    "Asalaa maalekum {adminName},\n\n7 fan jàll nañu te paiement bi defarul ngir {tenantName} ({planName}, {price} {currency}). Su amul jëfandikoo ci 72 waxtu yi topp, sa accès dina taxaw : sama jay, sa caisse ak sa données yi dinañu sàmm waaye duñu jot a taggu.\n\nNunga fi ngir la dimbali — tontu ci email bi bu nga am problème.",
      cta:     "Defar leegi",
    },
    ln: {
      subject: "Libanganisi ya nsuka — botelemi ekomi pene",
      body:    "Mbote {adminName},\n\nMikolo 7 esili mpe paiement mpo na {tenantName} ({planName}, {price} {currency}) esalemaki te. Soki osali eloko te na bangonga 72 oyo ekolanda, accès na yo ekotelema : sala ya yo, caisse na données ekozala kobatela malamu kasi ekozwama te.\n\nTozali awa mpo na kosalisa yo — zongisa email oyo soki ozali na problème.",
      cta:     "Salisa sikoyo",
    },
    ktu: {
      subject: "Likebisi ya nsuka — kutelama ke kuyula",
      body:    "Mbote {adminName},\n\nBilumbu 7 me luta mpe paiement sambu na {tenantName} ({planName}, {price} {currency}) salamaki ve. Kana nge sala eloko ve na bangonga 72 ya kulanda, accès ya nge ta telama : sala ya nge, caisse ti données ta vanda na kusimba kansi nge ta baka ve.\n\nBeto ke hayi mpo na kusadisa nge — vutula email yayi kana nge ke na problème.",
      cta:     "Sadisa sika",
    },
  },
};

function buildDunningEmail(day: DunningDay, input: DunningInput) {
  const b = MSG[day][input.locale] ?? MSG[day].fr;
  const priceStr = new Intl.NumberFormat(localeFormat(input.locale), { maximumFractionDigits: 0 })
    .format(input.price);
  const vars = {
    adminName:  input.adminName,
    tenantName: input.tenantName,
    planName:   input.planName,
    price:      priceStr,
    currency:   input.currency,
  };
  const subject = fill(b.subject, vars);
  const body    = fill(b.body, vars);
  const dir     = input.locale === 'ar' ? 'rtl' : 'ltr';

  const html = `<!doctype html>
<html lang="${input.locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:28px 28px 8px 28px;font-size:15px;line-height:1.6;">
          ${body.split('\n\n').map(p => `<p style="margin:0 0 14px 0;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
        </td></tr>
        <tr><td style="padding:8px 28px 28px 28px;">
          <a href="${escapeAttr(input.billingUrl)}" style="display:inline-block;background:${day === 'day7' ? '#dc2626' : '#0d9488'};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            ${escapeHtml(b.cta)} →
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${body}\n\n${b.cta}: ${input.billingUrl}\n\n— TransLog Pro`;
  return { subject, html, text };
}

function fill(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
function localeFormat(l: DunningLocale): string {
  return { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', pt: 'pt-PT', ar: 'ar-SA', wo: 'fr-SN', ln: 'fr-CG', ktu: 'fr-CG' }[l];
}
