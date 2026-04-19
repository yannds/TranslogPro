/**
 * Backfill : crée une `PlatformSubscription` TRIAL pour chaque tenant qui n'en
 * a pas encore. Idempotent — ré-exécutable sans effet de bord.
 *
 * Usage :
 *   npx ts-node prisma/seeds/backfill-subscriptions.ts
 *
 * Comportement :
 *   - Ignore le tenant plateforme (`PLATFORM_TENANT_ID`) — il n'a jamais de
 *     souscription.
 *   - Plan par défaut : lit `subscription.defaultPlanSlug` dans la table
 *     `platform_config` (écrite depuis PagePlatformSettings) avec fallback
 *     `starter` si la clé n'est pas définie.
 *   - Si le plan par défaut est introuvable/inactif → abandonne avec message
 *     explicite (pas de fallback sauvage qui pourrait créer des données
 *     incohérentes).
 *   - Statut initial : TRIAL avec `trialEndsAt = now + plan.trialDays * MS_PER_DAY`.
 *     Si `plan.trialDays = 0` → ACTIVE et `trialEndsAt = null`.
 *
 * Sortie console : résumé créations / skips / erreurs.
 */

import { PrismaClient } from '@prisma/client';
import { PLATFORM_TENANT_ID } from './iam.seed';
import { MS_PER_DAY } from '../../src/common/constants/time';

const DEFAULT_PLAN_SLUG_KEY = 'subscription.defaultPlanSlug';
const DEFAULT_PLAN_SLUG_FALLBACK = 'starter';

async function readDefaultPlanSlug(prisma: PrismaClient): Promise<string> {
  try {
    const row = await prisma.platformConfig.findUnique({
      where: { key: DEFAULT_PLAN_SLUG_KEY },
    });
    if (row?.value && typeof row.value === 'string') return row.value as string;
    // Prisma stocke les JSON, donc value peut être une string entre quotes.
    if (row?.value !== null && typeof row?.value === 'object') {
      // cas improbable — tombe en fallback
      return DEFAULT_PLAN_SLUG_FALLBACK;
    }
    return (row?.value as string | undefined) ?? DEFAULT_PLAN_SLUG_FALLBACK;
  } catch {
    return DEFAULT_PLAN_SLUG_FALLBACK;
  }
}

async function backfillSubscriptions(prisma: PrismaClient): Promise<void> {
  const planSlug = await readDefaultPlanSlug(prisma);

  const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
  if (!plan) {
    console.error(
      `❌ Plan par défaut "${planSlug}" introuvable. Exécutez d'abord "npx ts-node prisma/seeds/plans.seed.ts".`,
    );
    process.exit(1);
  }
  if (!plan.isActive) {
    console.error(
      `❌ Plan par défaut "${planSlug}" est inactif (isActive=false). Corrigez la DB ou changez la clé PlatformConfig "${DEFAULT_PLAN_SLUG_KEY}".`,
    );
    process.exit(1);
  }

  // Tenants sans souscription — LEFT JOIN "manuel" via deux requêtes (Prisma
  // n'a pas de `NOT EXISTS` direct en findMany ; on prend tous puis on filtre).
  const allTenants = await prisma.tenant.findMany({
    where:  { id: { not: PLATFORM_TENANT_ID } },
    select: { id: true, name: true, slug: true },
  });
  const existingSubs = await prisma.platformSubscription.findMany({
    select: { tenantId: true },
  });
  const subbedIds = new Set(existingSubs.map(s => s.tenantId));
  const missing = allTenants.filter(t => !subbedIds.has(t.id));

  if (missing.length === 0) {
    console.log(`✓ Tous les tenants (${allTenants.length}) ont déjà une souscription. Rien à faire.`);
    return;
  }

  console.log(
    `ℹ  ${missing.length} tenant(s) sans souscription — création d'une sub ${plan.slug.toUpperCase()} ` +
    `(${plan.trialDays}j d'essai):`,
  );

  const now = new Date();
  let created = 0;
  let failed  = 0;

  for (const t of missing) {
    const trialEndsAt = plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * MS_PER_DAY)
      : null;
    const status = trialEndsAt ? 'TRIAL' : 'ACTIVE';

    try {
      await prisma.$transaction([
        prisma.platformSubscription.create({
          data: {
            tenantId:           t.id,
            planId:             plan.id,
            status,
            trialEndsAt,
            currentPeriodStart: now,
            // currentPeriodEnd laissé null en TRIAL — la facturation prendra
            // le relais au passage ACTIVE (SubscriptionRenewalService).
            autoRenew:          false,
          },
        }),
        // Reflète le plan sur Tenant pour les lookups UI (consommés par le
        // dashboard admin tenant).
        prisma.tenant.update({
          where: { id: t.id },
          data:  { planId: plan.id },
        }),
      ]);
      console.log(`  ✓ ${t.slug.padEnd(20)} → ${plan.slug} (${status}${trialEndsAt ? `, jusqu'au ${trialEndsAt.toISOString().slice(0, 10)}` : ''})`);
      created += 1;
    } catch (err) {
      console.error(`  ✗ ${t.slug}: ${(err as Error)?.message ?? err}`);
      failed += 1;
    }
  }

  console.log(`\n✅ Backfill terminé — ${created} créé(s), ${failed} échec(s), ${allTenants.length - missing.length} ignoré(s) (déjà présents).`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await backfillSubscriptions(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[backfill-subscriptions] Unexpected error:', err);
  process.exit(1);
});
