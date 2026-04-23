import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PaymentOrchestrator } from '../../infrastructure/payment/payment-orchestrator.service';
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

  constructor(
    private readonly prisma:       PrismaService,
    private readonly orchestrator: PaymentOrchestrator,
  ) {}

  @OnEvent(EventTypes.PAYMENT_INTENT_SUCCEEDED)
  async onPaymentSucceeded(payload: {
    tenantId:   string;
    intentId:   string;
    entityType: string;
    entityId:   string | null;
    amount:     number;
    currency:   string;
    metadata:   unknown;
    /** Tokenisation provider (si fournie) — activée l'auto-renew sans interaction. */
    tokenization?: {
      customerRef?: string; methodToken?: string;
      methodLast4?: string; methodBrand?: string;
      maskedPhone?: string;
    };
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

      // ─── Branche SetupIntent ─────────────────────────────────────────────
      // Si l'intent est un SetupIntent (microcharge tokenisante), on enregistre
      // le moyen de paiement puis on déclenche un refund automatique. On ne
      // touche NI au statut NI à la période de la subscription.
      const meta = (payload.metadata ?? {}) as Record<string, unknown>;
      if (meta.setupOnly === true) {
        await this.handleSetupIntentSuccess(sub, payload);
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
      const tk = payload.tokenization;
      const method = intent?.method ?? (prevRefs as any).lastMethod;
      const provider = lastAttempt?.providerKey ?? (prevRefs as any).lastProvider;

      // Fan-out : push ou merge dans savedMethods[] (dedup par token ou
      // (method,last4) ou (method,maskedPhone)). Le nouveau devient default.
      const prevList = Array.isArray((prevRefs as any).savedMethods)
        ? ((prevRefs as any).savedMethods as SavedMethodEntry[])
        : [];
      const nextList = tk && (tk.methodToken || tk.methodLast4 || tk.maskedPhone)
        ? upsertSavedMethod(prevList, {
            id:          `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            method:      method ?? 'CARD',
            provider:    provider ?? null,
            brand:       tk.methodBrand ?? null,
            last4:       tk.methodLast4 ?? null,
            maskedPhone: tk.maskedPhone ?? null,
            tokenRef:    tk.methodToken ?? null,
            customerRef: tk.customerRef ?? null,
            isDefault:   true,
            lastUsedAt:  new Date().toISOString(),
            createdAt:   new Date().toISOString(),
          })
        : prevList;

      const nextRefs = {
        ...prevRefs,
        lastIntentId:           payload.intentId,
        lastMethod:             method,
        lastAttemptExternalRef: lastAttempt?.externalRef ?? (prevRefs as any).lastAttemptExternalRef,
        lastProvider:           provider,
        lastSuccessAt:          new Date().toISOString(),
        // Tokenisation — on ne conserve que les refs réutilisables (customerRef,
        // methodToken). Le last4/brand/maskedPhone servent uniquement l'affichage UI.
        customerRef:            tk?.customerRef    ?? (prevRefs as any).customerRef,
        methodToken:            tk?.methodToken    ?? (prevRefs as any).methodToken,
        methodLast4:            tk?.methodLast4    ?? (prevRefs as any).methodLast4,
        methodBrand:            tk?.methodBrand    ?? (prevRefs as any).methodBrand,
        savedMethods:           nextList,
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
          externalRefs:       nextRefs as unknown as Prisma.InputJsonValue,
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

  /**
   * Branche SetupIntent (enregistrement d'un moyen sans facturation).
   *
   * 1. Upsert du moyen dans `externalRefs.savedMethods[]` (dedup par token / last4 /
   *    maskedPhone, même logique que le checkout classique).
   * 2. Refund du microcharge via l'orchestrator (les 100 XAF/NGN reviennent au
   *    tenant). Si le refund échoue, on log mais on ne rollback pas le moyen —
   *    mieux vaut un moyen enregistré + 100 XAF à réconcilier manuellement qu'un
   *    tenant qui perd sa tokenisation.
   * 3. La subscription reste dans son statut courant (ACTIVE/TRIAL/PAST_DUE) —
   *    on ne bascule PAS, on ne prolonge PAS.
   */
  private async handleSetupIntentSuccess(
    sub: { id: string; tenantId: string; externalRefs: Prisma.JsonValue },
    payload: {
      intentId:   string;
      tokenization?: {
        customerRef?: string; methodToken?: string;
        methodLast4?: string; methodBrand?: string;
        maskedPhone?: string;
      };
    },
  ) {
    const tk = payload.tokenization;
    if (!tk || (!tk.methodToken && !tk.methodLast4 && !tk.maskedPhone)) {
      this.logger.warn(
        `[setup-intent] intent=${payload.intentId} sans tokenisation — moyen non enregistré`,
      );
      // On refund quand même : le tenant a payé pour rien
      await this.refundSetupIntent(sub.tenantId, payload.intentId);
      return;
    }

    const intent = await this.prisma.paymentIntent.findUnique({
      where:  { id: payload.intentId },
      select: { method: true },
    });
    const lastAttempt = await this.prisma.paymentAttempt.findFirst({
      where:   { intentId: payload.intentId, status: 'SUCCESSFUL' },
      orderBy: { createdAt: 'desc' },
      select:  { providerKey: true },
    });

    const prevRefs = (sub.externalRefs ?? {}) as Record<string, unknown>;
    const prevList = Array.isArray((prevRefs as any).savedMethods)
      ? ((prevRefs as any).savedMethods as SavedMethodEntry[])
      : [];
    const nextList = upsertSavedMethod(prevList, {
      id:          `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      method:      intent?.method ?? 'CARD',
      provider:    lastAttempt?.providerKey ?? null,
      brand:       tk.methodBrand ?? null,
      last4:       tk.methodLast4 ?? null,
      maskedPhone: tk.maskedPhone ?? null,
      tokenRef:    tk.methodToken ?? null,
      customerRef: tk.customerRef ?? null,
      isDefault:   true,
      lastUsedAt:  null,  // pas encore utilisé pour une vraie charge
      createdAt:   new Date().toISOString(),
    });

    // On met à jour uniquement savedMethods + customerRef/methodToken (utiles
    // pour auto-renew futur). PAS touche au statut / currentPeriodEnd.
    await this.prisma.platformSubscription.update({
      where: { id: sub.id },
      data:  {
        externalRefs: {
          ...prevRefs,
          customerRef: tk.customerRef ?? (prevRefs as any).customerRef,
          methodToken: tk.methodToken ?? (prevRefs as any).methodToken,
          methodLast4: tk.methodLast4 ?? (prevRefs as any).methodLast4,
          methodBrand: tk.methodBrand ?? (prevRefs as any).methodBrand,
          savedMethods: nextList,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `[setup-intent] tenant=${sub.tenantId} sub=${sub.id} moyen enregistré (${tk.methodBrand ?? tk.maskedPhone ?? 'unknown'})`,
    );

    await this.refundSetupIntent(sub.tenantId, payload.intentId);
  }

  /**
   * Refund automatique du microcharge tokenisant. N'escalade pas en cas d'échec —
   * le moyen est déjà enregistré, un refund manuel reste possible côté support.
   */
  private async refundSetupIntent(tenantId: string, intentId: string) {
    try {
      const result = await this.orchestrator.refund(intentId, {
        reason: 'SETUP_INTENT_AUTO_REFUND',
      });
      this.logger.log(
        `[setup-intent] refund OK tenant=${tenantId} intent=${intentId} amount=${result.refundedAmount} status=${result.status}`,
      );
    } catch (err) {
      this.logger.error(
        `[setup-intent] refund FAILED tenant=${tenantId} intent=${intentId}: ${(err as Error).message} — à réconcilier manuellement`,
      );
    }
  }
}

// ─── Helpers locaux ──────────────────────────────────────────────────────────

export interface SavedMethodEntry {
  id:          string;
  method:      string;   // CARD | MOBILE_MONEY | BANK_TRANSFER
  provider:    string | null;
  brand:       string | null;
  last4:       string | null;
  maskedPhone: string | null;
  tokenRef:    string | null;
  customerRef: string | null;
  isDefault:   boolean;
  lastUsedAt:  string | null;
  createdAt:   string;
}

/**
 * Upsert idempotent : si une méthode équivalente existe déjà (même tokenRef, ou
 * (method,last4), ou (method,maskedPhone)), on la met à jour et on la promeut
 * default. Sinon on l'ajoute. Max 5 méthodes (on drop la plus ancienne).
 */
function upsertSavedMethod(list: SavedMethodEntry[], incoming: SavedMethodEntry): SavedMethodEntry[] {
  const same = (m: SavedMethodEntry) =>
    (incoming.tokenRef    && m.tokenRef    === incoming.tokenRef) ||
    (incoming.last4       && m.method === incoming.method && m.last4       === incoming.last4) ||
    (incoming.maskedPhone && m.method === incoming.method && m.maskedPhone === incoming.maskedPhone);

  const withoutSame = list.filter(m => !same(m));
  const merged      = [{ ...incoming }, ...withoutSame.map(m => ({ ...m, isDefault: false }))];
  return merged.slice(0, 5);
}

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
