import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EMAIL_SERVICE, IEmailService } from '../../infrastructure/notification/interfaces/email.interface';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PaymentOrchestrator } from '../../infrastructure/payment/payment-orchestrator.service';
import type { PaymentMethod, PaymentCurrency } from '../../infrastructure/payment/interfaces/payment.interface';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * SubscriptionRenewalService — J-3 avant fin de période.
 *
 * Deux modes selon `PlatformSubscription.autoRenew` :
 *
 *   autoRenew=true  → tente de créer un nouvel Intent avec la dernière
 *                     méthode utilisée (externalRefs.lastMethod). Le provider
 *                     décide s'il accepte (tokenisation côté PSP) ou s'il
 *                     renvoie un paymentUrl — on envoie alors un email
 *                     "1-click pour confirmer" au lieu d'un reminder classique.
 *
 *   autoRenew=false → rappel classique "Vérifiez votre moyen de paiement"
 *                     avec lien vers /admin/billing.
 *
 * Tokenisation provider : **pas garantie ici**. Seuls certains providers
 * renvoient un `customerRef` exploitable pour le prélèvement sans interaction.
 * Dans le cas général, la création d'Intent retourne un paymentUrl que
 * l'utilisateur doit confirmer — ce qui est OK, l'effet UX net étant :
 * au lieu d'un "ça va se renouveler, agissez", l'admin reçoit un "cliquez ici"
 * qui saute les étapes intermédiaires.
 *
 * Idempotence : `externalRefs.renewalSent['{periodEndISO}']` → un seul essai
 * par période, même si le cron tourne plusieurs fois.
 *
 * Toggle runtime : `RENEWAL_REMINDERS_ENABLED=false`.
 */
@Injectable()
export class SubscriptionRenewalService {
  private readonly logger = new Logger(SubscriptionRenewalService.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly config:       PlatformConfigService,
    private readonly orchestrator: PaymentOrchestrator,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
  ) {}

  @Cron('0 10 * * *') // 10:00 — convention scheduling
  async runRenewalReminders(): Promise<void> {
    if (process.env.RENEWAL_REMINDERS_ENABLED === 'false') {
      this.logger.log('Skipped — RENEWAL_REMINDERS_ENABLED=false');
      return;
    }

    const now = Date.now();
    const leadDays = await this.config.getNumber('renewal.leadDays');
    // Fenêtre J-leadDays : trouve les subs dont `currentPeriodEnd` tombe dans
    // [leadDays, leadDays+1[ jours. Borne stricte → pas de doublon si le cron
    // tourne plusieurs fois dans la journée.
    const windowStart = new Date(now + leadDays     * MS_PER_DAY);
    const windowEnd   = new Date(now + (leadDays+1) * MS_PER_DAY);

    const subs = await this.prisma.platformSubscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { gte: windowStart, lt: windowEnd },
        // Déjà annulé → pas de relance (la sub expirera normalement)
        cancelledAt: null,
      },
      include: {
        plan:   { select: { id: true, slug: true, name: true, price: true, currency: true, billingCycle: true } },
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

    let sent = 0;
    for (const sub of subs) {
      if (!sub.tenant || !sub.plan) continue;
      const admin = sub.tenant.users[0];
      if (!admin?.email) continue;

      const periodKey = sub.currentPeriodEnd?.toISOString().slice(0, 10) ?? 'unknown';
      const refs = (sub.externalRefs ?? {}) as Record<string, any>;
      const renewalSent = (refs.renewalSent ?? {}) as Record<string, string>;
      if (renewalSent[periodKey]) continue; // déjà notifié pour cette période

      const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? 'translogpro.com';
      const billingUrl = `https://${sub.tenant.slug}.${baseDomain}/admin/billing`;

      // Si auto-renew activé ET qu'on a la méthode du dernier paiement :
      //   - methodToken présent  → Intent créé avec token, provider peut
      //     prélever silencieusement (paymentUrl souvent absent). On envoie
      //     un email "Votre prélèvement a été initié" (informatif).
      //   - methodToken absent   → Intent créé, paymentUrl revient, on envoie
      //     "1-click confirmer" pour que l'admin complete.
      // Sans `autoRenew` → rappel classique avec lien vers /admin/billing.
      let confirmUrl: string | undefined;
      const tokenized = Boolean(refs.methodToken);
      if (sub.autoRenew && refs.lastMethod) {
        confirmUrl = await this.tryCreateRenewalIntent(sub.tenantId, sub, refs.lastMethod, refs).catch(err => {
          this.logger.warn(`[renewal] auto-renew intent failed tenant=${sub.tenant!.slug}: ${(err as Error).message}`);
          return undefined;
        });
        // Auto-charge silencieuse : pas d'URL à renvoyer, mais il faut quand
        // même notifier — on pointe sur /admin/billing pour que l'admin vérifie.
        if (tokenized && !confirmUrl) confirmUrl = billingUrl;
      }

      try {
        const { subject, html, text } = buildRenewalEmail({
          adminName:   admin.name ?? admin.email.split('@')[0]!,
          tenantName:  sub.tenant.name,
          planName:    sub.plan.name,
          price:       sub.plan.price,
          currency:    sub.plan.currency,
          periodEnd:   sub.currentPeriodEnd!,
          billingUrl:  confirmUrl ?? billingUrl,
          oneClick:    !!confirmUrl,
          locale:      (sub.tenant.language as RenewalLocale) ?? 'fr',
        });

        await this.email.send({
          to:       { email: admin.email, name: admin.name ?? undefined },
          subject,
          html,
          text,
          category: 'transactional',
          tenantId: sub.tenant.id,
          idempotencyKey: `renewal:${sub.id}:${periodKey}`,
        });

        await this.prisma.platformSubscription.update({
          where: { id: sub.id },
          data:  {
            externalRefs: { ...refs, renewalSent: { ...renewalSent, [periodKey]: new Date().toISOString() } },
          },
        });

        this.logger.log(
          `[renewal] ${confirmUrl ? 'auto-renew' : 'reminder'} sent to tenant=${sub.tenant.slug} period=${periodKey}`,
        );
        sent++;
      } catch (err) {
        this.logger.warn(`[renewal] failed for tenant=${sub.tenant.slug}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`◀ Renewal reminders done — ${sent}/${subs.length}`);
  }

  /**
   * Crée un Intent renouvellement avec la méthode du dernier paiement réussi.
   * Retourne le paymentUrl si le provider en fournit un (l'email envoie
   * alors un CTA "1-click confirmer"), sinon undefined → rappel classique.
   *
   * N.B. un Intent SUCCEEDED synchrone (sans interaction user) n'est possible
   * qu'avec un provider qui supporte la tokenisation full (customerRef
   * réutilisable côté Stripe/Adyen/etc.). Nos providers courants renvoient
   * typiquement un paymentUrl — c'est déjà une énorme amélioration UX
   * par rapport au flow "login → billing page → checkout".
   */
  private async tryCreateRenewalIntent(
    tenantId: string,
    sub: { id: string; plan?: { price: number; currency: string; name: string } | null; currentPeriodEnd: Date | null },
    method: string,
    refs: Record<string, any>,
  ): Promise<string | undefined> {
    if (!sub.plan) return undefined;
    const supported = ['XAF', 'XOF', 'NGN', 'GHS', 'KES', 'USD'];
    const currency = (supported.includes(sub.plan.currency)
      ? sub.plan.currency
      : 'XAF') as PaymentCurrency;

    const periodKey = sub.currentPeriodEnd?.toISOString().slice(0, 10) ?? Date.now();
    // Quand on a customerRef/methodToken du PSP, on les passe dans metadata.
    // Le provider concret (Stripe, Flutterwave…) les lira et tentera un
    // prélèvement direct sans interaction — retour SUCCEEDED synchrone.
    // Si le provider ne supporte pas la tokenisation, il fallback sur
    // paymentUrl (comportement actuel sans token).
    const result = await this.orchestrator.createIntent(tenantId, {
      entityType:     'SUBSCRIPTION',
      entityId:       sub.id,
      subtotal:       sub.plan.price,
      method:         method as PaymentMethod,
      currency,
      idempotencyKey: `sub-${sub.id}-renewal-${periodKey}`,
      description:    `Renouvellement ${sub.plan.name}`,
      metadata:       {
        subscriptionId: sub.id,
        renewal:        true,
        // Passés au provider pour auto-charge silencieuse si supporté :
        customerRef:    refs.customerRef,
        methodToken:    refs.methodToken,
      },
    });

    return result.paymentUrl;
  }
}

// ─── Template email de rappel J-3 ────────────────────────────────────────────

type RenewalLocale = 'fr' | 'en' | 'es' | 'pt' | 'wo' | 'ln' | 'ktu' | 'ar';

interface RenewalInput {
  adminName:  string;
  tenantName: string;
  planName:   string;
  price:      number;
  currency:   string;
  periodEnd:  Date;
  billingUrl: string;
  /** Si true, billingUrl pointe directement sur le paymentUrl du PSP. */
  oneClick:   boolean;
  locale:     RenewalLocale;
}

function buildRenewalEmail(input: RenewalInput) {
  const L: Record<RenewalLocale, { subject: string; body: string; cta: string }> = {
    fr: {
      subject: "Votre abonnement TransLog Pro se renouvelle dans 3 jours",
      body:    "Bonjour {adminName},\n\nVotre abonnement {planName} pour {tenantName} arrive à échéance le {periodEnd}. Montant de la prochaine période : {price} {currency}.\n\nPour éviter toute interruption, vérifiez que votre moyen de paiement est à jour ou lancez le paiement dès maintenant.",
      cta:     "Gérer mon abonnement",
    },
    en: {
      subject: "Your TransLog Pro subscription renews in 3 days",
      body:    "Hi {adminName},\n\nYour {planName} subscription for {tenantName} ends on {periodEnd}. Next period amount: {price} {currency}.\n\nTo avoid interruption, check your payment method is current or start payment now.",
      cta:     "Manage my subscription",
    },
    es: {
      subject: "Su suscripción TransLog Pro se renueva en 3 días",
      body:    "Hola {adminName},\n\nSu suscripción {planName} para {tenantName} vence el {periodEnd}. Importe del próximo período: {price} {currency}.\n\nPara evitar interrupciones, verifique que su método de pago esté actualizado o inicie el pago ahora.",
      cta:     "Gestionar mi suscripción",
    },
    pt: {
      subject: "Sua assinatura TransLog Pro será renovada em 3 dias",
      body:    "Olá {adminName},\n\nSua assinatura {planName} para {tenantName} vence em {periodEnd}. Valor do próximo período: {price} {currency}.\n\nPara evitar interrupções, verifique se seu método de pagamento está atualizado ou inicie o pagamento agora.",
      cta:     "Gerenciar minha assinatura",
    },
    ar: {
      subject: "سيُجدَّد اشتراك TransLog Pro خلال 3 أيام",
      body:    "مرحبًا {adminName}،\n\nينتهي اشتراك {planName} لـ {tenantName} في {periodEnd}. مبلغ الفترة القادمة: {price} {currency}.\n\nلتجنّب الانقطاع، تحقّق من تحديث وسيلة الدفع أو ابدأ الدفع الآن.",
      cta:     "إدارة اشتراكي",
    },
    wo: {
      subject: "Sa abonnement TransLog Pro di renouveller ci 3 fan",
      body:    "Asalaa maalekum {adminName},\n\nSa abonnement {planName} ngir {tenantName} di jeex ci {periodEnd}. Xaalis bu période bu topp : {price} {currency}.\n\nNgir bañ taxaw, seetal sa moyen de paiement walla tambalil paiement bi leegi.",
      cta:     "Saytu sama abonnement",
    },
    ln: {
      subject: "Abonnement na yo ya TransLog Pro ekomizwa sika na mikolo 3",
      body:    "Mbote {adminName},\n\nAbonnement na yo {planName} mpo na {tenantName} esuki na {periodEnd}. Mbongo ya période oyo ekolanda : {price} {currency}.\n\nMpo ete eloko ekatana te, tala soki moyen ya paiement na yo ezali bien to banda paiement sikoyo.",
      cta:     "Kosala abonnement na ngai",
    },
    ktu: {
      subject: "Abonnement ya nge ya TransLog Pro ke kuzwa sika na bilumbu 3",
      body:    "Mbote {adminName},\n\nAbonnement ya nge {planName} sambu na {tenantName} ke suka na {periodEnd}. Mbongo ya période ya kulanda : {price} {currency}.\n\nMpo nde eloko kukatama ve, tala kana moyen ya paiement ya nge ke bien to banda paiement sika.",
      cta:     "Kusadisa abonnement ya mu",
    },
  };
  const b = L[input.locale] ?? L.fr;
  const dateStr = new Intl.DateTimeFormat(localeFormat(input.locale), {
    day: '2-digit', month: 'long', year: 'numeric',
  }).format(input.periodEnd);
  const priceStr = new Intl.NumberFormat(localeFormat(input.locale), { maximumFractionDigits: 0 })
    .format(input.price);

  const vars = {
    adminName:  input.adminName,
    tenantName: input.tenantName,
    planName:   input.planName,
    price:      priceStr,
    currency:   input.currency,
    periodEnd:  dateStr,
  };
  // Quand oneClick=true, on adapte le CTA pour refléter l'action directe
  // ("Confirmer le prélèvement") au lieu du "Gérer mon abonnement".
  const oneClickLabels: Partial<Record<RenewalLocale, string>> = {
    fr: 'Confirmer le renouvellement',
    en: 'Confirm renewal',
    es: 'Confirmar renovación',
    pt: 'Confirmar renovação',
    ar: 'تأكيد التجديد',
  };
  const cta = input.oneClick ? (oneClickLabels[input.locale] ?? b.cta) : b.cta;
  const subject = fill(b.subject, vars);
  const body    = fill(b.body,    vars);
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
          <a href="${escapeAttr(input.billingUrl)}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            ${escapeHtml(cta)} →
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${body}\n\n${cta}: ${input.billingUrl}\n\n— TransLog Pro`;
  return { subject, html, text };
}

function fill(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
function localeFormat(l: RenewalLocale): string {
  return { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', pt: 'pt-PT', ar: 'ar-SA', wo: 'fr-SN', ln: 'fr-CG', ktu: 'fr-CG' }[l];
}
