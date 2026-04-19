import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PaymentOrchestrator } from '../../infrastructure/payment/payment-orchestrator.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import type { PaymentMethod, PaymentCurrency } from '../../infrastructure/payment/interfaces/payment.interface';
import { StartSubscriptionCheckoutDto, UpdateAutoRenewDto, CancelSubscriptionDto } from './dto/subscription-checkout.dto';

/**
 * Checkout d'abonnement SaaS — crée un PaymentIntent via l'orchestrateur
 * pour régler 1 période d'abonnement (mensuelle ou annuelle selon le plan).
 *
 * Flux :
 *   1. Frontend appelle `POST /api/v1/subscription/checkout` depuis le banner
 *      trial ("Upgrade now") ou depuis /admin/billing.
 *   2. Service construit l'Intent (entityType=SUBSCRIPTION, idempotent par
 *      `sub-{subscriptionId}-{period}-{method}` pour éviter les doubles envois).
 *   3. Retourne `{ paymentUrl }` — le frontend redirige.
 *   4. Provider → webhook → PaymentOrchestrator marque l'Intent SUCCEEDED.
 *
 * Réconciliation Intent SUCCEEDED → PlatformSubscription ACTIVE :
 *   réalisée par un handler domain-event séparé (non inclus dans cet écrit —
 *   `SubscriptionPaymentReconciliationHandler` écoute `payment.intent.succeeded`
 *   et, si `entityType=SUBSCRIPTION` et `metadata.subscriptionId` présent,
 *   passe PlatformSubscription à ACTIVE + extend la période). À câbler en
 *   Phase 6 webhook reconciliation — pour l'instant, en dev, on peut simuler.
 */
@Injectable()
export class SubscriptionCheckoutService {
  private readonly logger = new Logger(SubscriptionCheckoutService.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly orchestrator: PaymentOrchestrator,
    private readonly config:       PlatformConfigService,
  ) {}

  async startCheckout(tenantId: string, dto: StartSubscriptionCheckoutDto) {
    // 1. Résoud la subscription active du tenant (1:1 avec Tenant).
    const sub = await this.prisma.platformSubscription.findUnique({
      where:   { tenantId },
      include: { plan: true },
    });
    if (!sub)         throw new NotFoundException('Aucune souscription active pour ce tenant');
    if (!sub.plan)    throw new NotFoundException('Plan introuvable');
    if (sub.plan.price <= 0) {
      throw new BadRequestException('Ce plan est gratuit ou sur-devis — pas de checkout direct');
    }
    if (sub.status === 'ACTIVE') {
      // L'abonnement est déjà actif, pas la peine de refacturer maintenant.
      throw new BadRequestException('Abonnement déjà ACTIVE — prochaine facture automatique');
    }

    // 2. Idempotence : une seule tentative par (subscription, currentPeriodStart, method)
    //    pour éviter qu'un double clic crée 2 Intents.
    const periodKey = sub.currentPeriodStart
      ? sub.currentPeriodStart.toISOString().slice(0, 10)
      : 'first';
    const idempotencyKey = `sub-${sub.id}-${periodKey}-${dto.method}`;

    // 3. Email/nom de l'admin (pour le provider qui a besoin du contact).
    const admin = await this.prisma.user.findFirst({
      where:   { tenantId, userType: 'STAFF' },
      orderBy: { id: 'asc' },
      select:  { email: true, name: true },
    });

    // 4. Monnaie du plan (EUR par défaut en seed) — vérifier qu'elle est
    //    supportée par l'orchestrator. Les devises africaines majeures sont
    //    acceptées : XAF, XOF, NGN, GHS, KES. EUR non couvert côté provider
    //    africain → pour l'instant on fallback vers tenant.currency, charge à
    //    l'admin plateforme de revoir le pricing en local currency.
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId }, select: { currency: true, name: true },
    });
    const supported: PaymentCurrency[] = ['XAF', 'XOF', 'NGN', 'GHS', 'KES', 'USD'];
    const currency = (supported as string[]).includes(sub.plan.currency)
      ? sub.plan.currency as PaymentCurrency
      : supported.includes(tenant.currency as PaymentCurrency)
        ? tenant.currency as PaymentCurrency
        : 'XAF';

    // 5. Crée l'Intent via PaymentOrchestrator.
    const redirectUrl = dto.redirectUrl ?? `/welcome?billing=success`;
    const intent = await this.orchestrator.createIntent(tenantId, {
      entityType:     'SUBSCRIPTION',
      entityId:       sub.id,
      subtotal:       sub.plan.price,
      method:         dto.method as PaymentMethod,
      currency,
      idempotencyKey,
      description:    `Abonnement ${sub.plan.name} — ${tenant.name}`,
      redirectUrl,
      customerEmail:  admin?.email ?? undefined,
      customerName:   admin?.name  ?? undefined,
      metadata: {
        subscriptionId: sub.id,
        planSlug:       sub.plan.slug,
        billingCycle:   sub.plan.billingCycle,
      },
    });

    this.logger.log(
      `[checkout] tenant=${tenantId} sub=${sub.id} plan=${sub.plan.slug} amount=${sub.plan.price}${currency} method=${dto.method}`,
    );

    return {
      intentId:    intent.intentId,
      paymentUrl:  intent.paymentUrl,
      amount:      intent.amount,
      currency:    intent.currency,
      expiresAt:   intent.expiresAt,
      providerKey: intent.providerKey,
    };
  }

  // ─── Résumé billing (pour le banner trial) ──────────────────────────────────

  async getBillingSummary(tenantId: string) {
    // Garde défensive — un tenantId absent (platform admin sans tenant, session
    // expirée, etc.) faisait lever une PrismaClientValidationError → 500 opaque.
    // On renvoie null (pas d'abonnement connu) pour un comportement UX propre.
    if (!tenantId) return null;

    try {
      const sub = await this.prisma.platformSubscription.findUnique({
        where:   { tenantId },
        include: { plan: { select: { slug: true, name: true, price: true, currency: true, billingCycle: true } } },
      });
      if (!sub) return null;

      const now = Date.now();
      const daysLeft = sub.trialEndsAt
        ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)))
        : null;

      // Seuil d'apparition du TrialBanner lu depuis PlatformConfig — pilotable
      // sans redéploiement (par défaut 14 jours).
      const trialBannerMaxDaysLeft = await this.config.getNumber('trial.banner.maxDaysLeft')
        .catch(() => 14); // défaut prudent si le service config est indisponible
      return {
        status:             sub.status,
        trialEndsAt:        sub.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft:      daysLeft,
        currentPeriodEnd:   sub.currentPeriodEnd?.toISOString() ?? null,
        cancelledAt:        sub.cancelledAt?.toISOString() ?? null,
        autoRenew:          sub.autoRenew,
        trialBannerMaxDaysLeft,
        plan:               sub.plan
          ? {
              slug:         sub.plan.slug,
              name:         sub.plan.name,
              price:        sub.plan.price,
              currency:     sub.plan.currency,
              billingCycle: sub.plan.billingCycle,
            }
          : null,
      };
    } catch (err) {
      this.logger.error(
        `[SubscriptionCheckout] getBillingSummary failed for tenant=${tenantId}: ${(err as Error)?.stack ?? err}`,
      );
      return null;
    }
  }

  // ─── Page billing dédiée (historique + méthode sauvée) ──────────────────────

  async getBillingDetails(tenantId: string) {
    if (!tenantId) return null;

    try {
      const sub = await this.prisma.platformSubscription.findUnique({
        where:   { tenantId },
        include: {
          plan:     { select: { slug: true, name: true, price: true, currency: true, billingCycle: true } },
          invoices: { orderBy: { createdAt: 'desc' }, take: 12 },
        },
      });
      if (!sub) return null;

      // Derniers PaymentIntent type SUBSCRIPTION pour ce tenant.
      const intents = await this.prisma.paymentIntent.findMany({
        where:   { tenantId, entityType: 'SUBSCRIPTION' },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select:  {
          id: true, status: true, amount: true, currency: true,
          createdAt: true, settledAt: true,
        },
      });

      const refs = (sub.externalRefs ?? {}) as Record<string, any>;
      const savedMethod = refs.lastMethod ? {
        method:        refs.lastMethod as string,
        provider:      (refs.lastProvider as string) ?? null,
        lastSuccessAt: (refs.lastSuccessAt as string) ?? null,
        // Tokenisation — affichage UI "Visa •••• 4242" si dispo.
        brand:         (refs.methodBrand  as string) ?? null,
        last4:         (refs.methodLast4  as string) ?? null,
        /** True si le provider a fourni un token réutilisable → auto-charge possible. */
        tokenized:     Boolean(refs.methodToken),
      } : null;

      return {
        summary: await this.getBillingSummary(tenantId),
        intents: intents.map(i => ({
          id:         i.id,
          status:     i.status,
          amount:     i.amount,
          currency:   i.currency,
          createdAt:  i.createdAt.toISOString(),
          settledAt:  i.settledAt?.toISOString() ?? null,
        })),
        invoices: sub.invoices.map(i => ({
          id:          i.id,
          number:      i.invoiceNumber,
          status:      i.status,
          totalAmount: i.totalAmount,
          currency:    i.currency,
          createdAt:   i.createdAt.toISOString(),
          paidAt:      i.paidAt?.toISOString() ?? null,
        })),
        savedMethod,
      };
    } catch (err) {
      this.logger.error(
        `[SubscriptionCheckout] getBillingDetails failed for tenant=${tenantId}: ${(err as Error)?.stack ?? err}`,
      );
      return null;
    }
  }

  // ─── Toggle auto-renew ──────────────────────────────────────────────────────

  async updateAutoRenew(tenantId: string, dto: UpdateAutoRenewDto) {
    const sub = await this.prisma.platformSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Aucune souscription');
    await this.prisma.platformSubscription.update({
      where: { id: sub.id },
      data:  { autoRenew: dto.autoRenew },
    });
    this.logger.log(`[auto-renew] tenant=${tenantId} set to ${dto.autoRenew}`);
    return { autoRenew: dto.autoRenew };
  }

  // ─── Résiliation self-service ───────────────────────────────────────────────
  //
  // L'abonnement reste ACTIVE jusqu'à `currentPeriodEnd` (l'admin conserve
  // l'accès à ce qu'il a payé). Après cette date, le cron devra passer en
  // CANCELLED — pour l'instant c'est juste un marqueur. Résumé billing
  // surface l'état annulé → frontend affiche "Se termine le {date}".

  async cancel(tenantId: string, dto: CancelSubscriptionDto) {
    const sub = await this.prisma.platformSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Aucune souscription');
    if (sub.cancelledAt) throw new BadRequestException('Abonnement déjà résilié');

    const cancelledAt = new Date();
    await this.prisma.platformSubscription.update({
      where: { id: sub.id },
      data:  {
        cancelledAt,
        cancelReason: dto.reason,
        autoRenew:    false, // cohérence : pas de prélèvement après annulation
      },
    });
    this.logger.log(`[cancel] tenant=${tenantId} reason="${dto.reason ?? '-'}"`);
    return {
      cancelledAt:      cancelledAt.toISOString(),
      effectiveAt:      sub.currentPeriodEnd?.toISOString() ?? null,
    };
  }

  async resume(tenantId: string) {
    const sub = await this.prisma.platformSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Aucune souscription');
    if (!sub.cancelledAt) throw new BadRequestException("L'abonnement n'est pas résilié");

    await this.prisma.platformSubscription.update({
      where: { id: sub.id },
      data:  { cancelledAt: null, cancelReason: null },
    });
    this.logger.log(`[resume] tenant=${tenantId}`);
    return { ok: true };
  }
}
