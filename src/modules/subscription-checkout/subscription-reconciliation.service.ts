import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EventTypes } from '../../common/types/domain-event.type';

/**
 * Handler post-paiement — bascule PlatformSubscription TRIAL → ACTIVE et
 * prolonge la période au succès du paiement d'un Intent SUBSCRIPTION.
 *
 * Trigger : `EventTypes.PAYMENT_INTENT_SUCCEEDED` émis par PaymentOrchestrator
 * après mise à jour DB de l'Intent en SUCCEEDED (post-transaction). Le payload
 * contient `entityType`, `entityId` (subscriptionId), `tenantId`, `metadata`.
 *
 * Robustesse :
 *   - Idempotent : on lit l'état actuel avant toute update.
 *   - Isolation : ne touche JAMAIS une subscription qui n'appartient pas au
 *     tenant de l'event (double check entityId ↔ tenantId).
 *   - Non-bloquant : un échec log mais ne propage pas (l'orchestrator DOIT
 *     acquitter le webhook provider même si notre réconciliation rate).
 */
@Injectable()
export class SubscriptionReconciliationService {
  private readonly logger = new Logger(SubscriptionReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(EventTypes.PAYMENT_INTENT_SUCCEEDED)
  async onPaymentSucceeded(payload: {
    tenantId:   string;
    intentId:   string;
    entityType: string;
    entityId:   string | null;
    amount:     number;
    currency:   string;
    metadata:   unknown;
  }) {
    if (payload.entityType !== 'SUBSCRIPTION') return;
    if (!payload.entityId) {
      this.logger.warn(`SUBSCRIPTION intent ${payload.intentId} without entityId — skip`);
      return;
    }

    try {
      const sub = await this.prisma.platformSubscription.findUnique({
        where:   { id: payload.entityId },
        include: { plan: { select: { billingCycle: true } } },
      });
      if (!sub) {
        this.logger.warn(`Subscription ${payload.entityId} introuvable — ignoré`);
        return;
      }
      if (sub.tenantId !== payload.tenantId) {
        // Cross-tenant paranoia — ne devrait jamais arriver mais on bloque net.
        this.logger.error(
          `Cross-tenant mismatch: intent.tenant=${payload.tenantId} sub.tenant=${sub.tenantId} — abort`,
        );
        return;
      }

      // Déjà ACTIVE & période en cours → webhook rejoué ou doublon. On ne
      // prolonge PAS (idempotence stricte côté réconciliation).
      const now = new Date();
      if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
        this.logger.debug(`Subscription ${sub.id} déjà ACTIVE — webhook rejoué, pas d'action`);
        return;
      }

      // Calcul de la nouvelle période — ancre sur la fin de période actuelle
      // (renouvellement) ou sur now (premier upgrade depuis TRIAL).
      const start = sub.currentPeriodEnd && sub.currentPeriodEnd > now
        ? sub.currentPeriodEnd
        : now;
      const end   = addBillingCycle(start, sub.plan?.billingCycle ?? 'MONTHLY');

      // Capture les refs du dernier paiement réussi pour l'auto-renew futur.
      // La méthode est portée par l'Intent (PaymentIntent.method) ; l'externalRef
      // PSP est sur le dernier PaymentAttempt SUCCESSFUL.
      const [intent, lastAttempt] = await Promise.all([
        this.prisma.paymentIntent.findUnique({
          where:  { id: payload.intentId },
          select: { method: true },
        }),
        this.prisma.paymentAttempt.findFirst({
          where:   { intentId: payload.intentId, status: 'SUCCESSFUL' },
          orderBy: { createdAt: 'desc' },
          select:  { externalRef: true, providerKey: true },
        }),
      ]);
      const prevRefs = (sub.externalRefs ?? {}) as Record<string, unknown>;
      const nextRefs = {
        ...prevRefs,
        lastIntentId:           payload.intentId,
        lastMethod:             intent?.method ?? (prevRefs as any).lastMethod,
        lastAttemptExternalRef: lastAttempt?.externalRef ?? (prevRefs as any).lastAttemptExternalRef,
        lastProvider:           lastAttempt?.providerKey ?? (prevRefs as any).lastProvider,
        lastSuccessAt:          new Date().toISOString(),
        // Reset dunning history après un paiement réussi — la prochaine
        // occurrence de PAST_DUE repartira de zéro sur les rappels.
        dunningSent:            {},
      };

      await this.prisma.platformSubscription.update({
        where: { id: sub.id },
        data:  {
          status:             'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd:   end,
          renewsAt:           end,
          // trialEndsAt n'est pas null-ifié volontairement : garde la trace
          // historique du trial consommé (utile pour analytics/refund).
          cancelledAt:        null,
          cancelReason:       null,
          pastDueSince:       null,
          externalRefs:       nextRefs,
        },
      });

      // Miroir sur Tenant (planId déjà bon, on ajoute activatedAt si absent).
      if (!sub.tenantId) return;
      await this.prisma.tenant.update({
        where: { id: sub.tenantId },
        data:  { activatedAt: now },
      });

      this.logger.log(
        `[sub-reconciliation] tenant=${sub.tenantId} sub=${sub.id} → ACTIVE until ${end.toISOString()}`,
      );
    } catch (err) {
      this.logger.error(`Reconciliation failed for intent=${payload.intentId}: ${(err as Error).message}`);
      // On n'escalade pas — le webhook est déjà ACK côté orchestrator.
    }
  }
}

// ─── Helpers locaux ──────────────────────────────────────────────────────────

function addBillingCycle(from: Date, cycle: string): Date {
  const next = new Date(from);
  switch (cycle) {
    case 'MONTHLY': next.setMonth(next.getMonth() + 1); break;
    case 'YEARLY':  next.setFullYear(next.getFullYear() + 1); break;
    case 'ONE_SHOT':
      // Pas de renouvellement attendu — on écrit +100 ans pour l'UI, la
      // subscription passe en ACTIVE indéfiniment (l'admin plateforme annule
      // manuellement).
      next.setFullYear(next.getFullYear() + 100);
      break;
    case 'CUSTOM':
    default:
      // Fallback prudent : 1 mois. La plateforme doit aligner `billingCycle`
      // sur une valeur connue.
      next.setMonth(next.getMonth() + 1);
  }
  return next;
}
