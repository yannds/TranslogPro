/**
 * Backfill : reconstitue l'historique `SubscriptionChange` depuis les
 * `PlatformSubscription` existantes. Utilisé par PlatformKpiService pour
 * calculer expansion / contraction / churn revenue.
 *
 * Usage :
 *   npx ts-node prisma/seeds/subscription-change.backfill.ts
 *
 * Stratégie (conservatrice — pas d'inférence spéculative) :
 *   - Pour chaque PlatformSubscription sans change NEW existant → crée 1 ligne
 *     NEW avec `toMonthlyAmount` normalisé sur le cycle mensuel et
 *     `createdAt = subscription.startedAt`.
 *   - Pour chaque subscription CANCELLED sans change CHURN → crée 1 ligne
 *     CHURN avec `deltaMonthly` négatif et `createdAt = cancelledAt`.
 *   - Les changements intermédiaires (EXPANSION / CONTRACTION) ne peuvent être
 *     reconstitués fidèlement sans journal d'événements — ils seront tracés
 *     uniquement à partir de ce point en avant par PlatformBillingService.
 *
 * Idempotence : utilise `upsert` sur le couple (tenantId, changeType, createdAt).
 */

import { PrismaClient } from '@prisma/client';
import { PLATFORM_TENANT_ID } from './iam.seed';

function normalizeMonthlyAmount(price: number, billingCycle: string): number {
  if (!price || price <= 0) return 0;
  switch (billingCycle) {
    case 'MONTHLY':
      return price;
    case 'YEARLY':
      return price / 12;
    case 'ONE_SHOT':
      // One-shot : amorti sur 12 mois pour MRR lisible.
      return price / 12;
    case 'CUSTOM':
    default:
      return price;
  }
}

async function backfillSubscriptionChanges(prisma: PrismaClient): Promise<void> {
  // On utilise findMany SANS include tenant pour tolérer les subscriptions
  // orphelines (tenant supprimé sans cascade — résidu cleanup E2E).
  const subscriptions = await prisma.platformSubscription.findMany({
    include: { plan: true, changes: true },
  });

  // Set des tenantIds encore valides, pour filtrer les orphelins
  const validTenants = new Set(
    (await prisma.tenant.findMany({ select: { id: true } })).map((t) => t.id),
  );

  let createdNew = 0;
  let createdChurn = 0;
  let skipped = 0;
  let orphan = 0;

  for (const sub of subscriptions) {
    // Ignore tenant plateforme — il n'a jamais de subscription facturée
    if (sub.tenantId === PLATFORM_TENANT_ID) {
      skipped++;
      continue;
    }
    // Ignore les subscriptions orphelines (tenant supprimé sans cascade)
    if (!validTenants.has(sub.tenantId)) {
      orphan++;
      continue;
    }

    const monthly = normalizeMonthlyAmount(sub.plan.price, sub.plan.billingCycle);
    const currency = sub.plan.currency ?? 'EUR';

    // Entrée NEW
    const hasNew = sub.changes.some((c) => c.changeType === 'NEW');
    if (!hasNew) {
      await prisma.subscriptionChange.create({
        data: {
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          fromPlanId: null,
          toPlanId: sub.planId,
          fromMonthlyAmount: 0,
          toMonthlyAmount: monthly,
          deltaMonthly: monthly,
          currency,
          changeType: 'NEW',
          reason: 'backfill',
          actorUserId: null,
          createdAt: sub.startedAt,
        },
      });
      createdNew++;
    }

    // Entrée CHURN si subscription cancelled
    if (sub.status === 'CANCELLED' && sub.cancelledAt) {
      const hasChurn = sub.changes.some((c) => c.changeType === 'CHURN');
      if (!hasChurn) {
        await prisma.subscriptionChange.create({
          data: {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            fromPlanId: sub.planId,
            toPlanId: sub.planId,
            fromMonthlyAmount: monthly,
            toMonthlyAmount: 0,
            deltaMonthly: -monthly,
            currency,
            changeType: 'CHURN',
            reason: sub.cancelReason ?? 'backfill',
            actorUserId: null,
            createdAt: sub.cancelledAt,
          },
        });
        createdChurn++;
      }
    }
  }

  console.log(`✅ Backfill SubscriptionChange terminé :`);
  console.log(`   - ${createdNew} entrées NEW créées`);
  console.log(`   - ${createdChurn} entrées CHURN créées`);
  console.log(`   - ${skipped} subscriptions ignorées (tenant plateforme)`);
  console.log(`   - ${orphan} subscriptions orphelines ignorées (tenant supprimé)`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await backfillSubscriptionChanges(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { backfillSubscriptionChanges, normalizeMonthlyAmount };
