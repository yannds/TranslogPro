/**
 * scripts/cleanup-e2e-tenants.ts — purge idempotente des tenants & plans E2E.
 *
 * Deux usages :
 *
 *   1. Helpers importés par Playwright :
 *        - deleteTenantBySlug / deleteTenantsByPrefix
 *        - deletePlanBySlug   / deletePlansByPrefix
 *
 *   2. CLI batch pour purger les résidus E2E en CI :
 *        npx ts-node scripts/cleanup-e2e-tenants.ts pw-saas-
 *        npx ts-node scripts/cleanup-e2e-tenants.ts        # défaut pw-saas-
 *      Le CLI purge aussi les plans orphelins préfixés `pw-pln-` ou `e2e-`.
 *
 * Implémentation :
 *   - On désactive les FK via `SET LOCAL session_replication_role = 'replica'`
 *     pour la durée de la transaction.
 *   - **On supprime d'abord toutes les rows tenant-scoped** (boucle sur toutes
 *     les tables du schéma public qui ont une colonne `tenantId`), puis le
 *     tenant lui-même. Pas d'orphelins laissés derrière.
 *
 * ⚠️ Technique réservée au cleanup E2E, jamais dans le code applicatif.
 */

import { PrismaClient } from '@prisma/client';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// Préfixes whitelistés — évite toute purge accidentelle d'un tenant de prod.
const ALLOWED_PREFIXES = ['pw-saas-', 'pw-a-', 'pw-e2e-', 'e2e-'] as const;

function isAllowedPrefix(prefix: string): boolean {
  return ALLOWED_PREFIXES.some(p => prefix.startsWith(p));
}

/**
 * Supprime un tenant par slug. Retourne `true` si un tenant a été supprimé,
 * `false` s'il n'existait pas (no-op). Sécurité : refuse de supprimer un
 * tenant hors préfixes E2E ou le tenant plateforme.
 */
export async function deleteTenantBySlug(slug: string, prisma?: PrismaClient): Promise<boolean> {
  const client = prisma ?? new PrismaClient();
  const ownsClient = !prisma;

  try {
    if (!isAllowedPrefix(slug)) {
      throw new Error(`[cleanup-e2e-tenants] Refus de supprimer "${slug}" — préfixe non whitelisté (${ALLOWED_PREFIXES.join(', ')})`);
    }

    const tenant = await client.tenant.findUnique({ where: { slug } });
    if (!tenant) return false;
    if (tenant.id === PLATFORM_TENANT_ID) {
      throw new Error(`[cleanup-e2e-tenants] Refus de supprimer le tenant plateforme (${slug})`);
    }

    await client.$transaction(async tx => {
      // FK off le temps de la purge.
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);

      // Tables tenant-scoped : on les purge d'abord pour ne laisser aucun orphelin.
      const scopedTables = await tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.columns
        WHERE column_name = 'tenantId'
          AND table_schema = 'public'
          AND table_name <> 'tenants'
      `;
      for (const { table_name } of scopedTables) {
        await tx.$executeRawUnsafe(
          `DELETE FROM public."${table_name}" WHERE "tenantId" = $1`,
          tenant.id,
        );
      }

      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenant.id);
    });

    return true;
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

// ─── Plans ──────────────────────────────────────────────────────────────────

const ALLOWED_PLAN_PREFIXES = ['pw-pln-', 'e2e-'] as const;

function isAllowedPlanPrefix(prefix: string): boolean {
  return ALLOWED_PLAN_PREFIXES.some(p => prefix.startsWith(p));
}

/**
 * Supprime un plan par slug (+ ses PlanModule). Refuse tout slug hors
 * whitelist E2E (`pw-pln-`, `e2e-`) — zéro risque sur les plans canoniques
 * (`starter`, `growth`, `enterprise`).
 *
 * No-op si une subscription référence encore le plan (FK bloque) — l'appelant
 * doit d'abord purger le tenant.
 */
export async function deletePlanBySlug(slug: string, prisma?: PrismaClient): Promise<boolean> {
  const client = prisma ?? new PrismaClient();
  const ownsClient = !prisma;
  try {
    if (!isAllowedPlanPrefix(slug)) {
      throw new Error(`[cleanup-e2e-tenants] Refus de supprimer plan "${slug}" — préfixe non whitelisté (${ALLOWED_PLAN_PREFIXES.join(', ')})`);
    }
    const plan = await client.plan.findUnique({ where: { slug } });
    if (!plan) return false;
    await client.$transaction([
      client.planModule.deleteMany({ where: { planId: plan.id } }),
      client.plan.delete({ where: { id: plan.id } }),
    ]);
    return true;
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

export async function deletePlansByPrefix(prefix: string): Promise<{ deleted: number; slugs: string[] }> {
  if (!isAllowedPlanPrefix(prefix)) {
    throw new Error(`[cleanup-e2e-tenants] Préfixe plan non whitelisté "${prefix}" — autorisés : ${ALLOWED_PLAN_PREFIXES.join(', ')}`);
  }
  const prisma = new PrismaClient();
  try {
    const plans = await prisma.plan.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    });
    const deletedSlugs: string[] = [];
    for (const p of plans) {
      const ok = await deletePlanBySlug(p.slug, prisma).catch(() => false);
      if (ok) deletedSlugs.push(p.slug);
    }
    return { deleted: deletedSlugs.length, slugs: deletedSlugs };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Supprime tous les tenants dont le slug commence par `prefix`. Utilisé en
 * CI pour purger les résidus E2E accumulés.
 *
 * Refuse tout préfixe hors whitelist (`pw-saas-`, `pw-a-`, `pw-e2e-`, `e2e-`).
 */
export async function deleteTenantsByPrefix(prefix: string): Promise<{ deleted: number; slugs: string[] }> {
  if (!isAllowedPrefix(prefix)) {
    throw new Error(`[cleanup-e2e-tenants] Préfixe non whitelisté "${prefix}" — autorisés : ${ALLOWED_PREFIXES.join(', ')}`);
  }

  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({
      where: { slug: { startsWith: prefix } },
      select: { id: true, slug: true },
    });

    const deletedSlugs: string[] = [];
    for (const t of tenants) {
      await deleteTenantBySlug(t.slug, prisma);
      deletedSlugs.push(t.slug);
    }
    return { deleted: deletedSlugs.length, slugs: deletedSlugs };
  } finally {
    await prisma.$disconnect();
  }
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const prefix = process.argv[2] ?? 'pw-saas-';
  (async () => {
    const tenants = await deleteTenantsByPrefix(prefix);
    console.log(`[cleanup-e2e-tenants] ✅ ${tenants.deleted} tenant(s) supprimé(s) (préfixe "${prefix}")`);
    for (const s of tenants.slugs) console.log(`  - tenant ${s}`);

    // En foulée, purge les plans E2E orphelins (aucune souscription ne les
    // référence après suppression des tenants). Idempotent, whitelist stricte.
    for (const p of ALLOWED_PLAN_PREFIXES) {
      const plans = await deletePlansByPrefix(p);
      if (plans.deleted > 0) {
        console.log(`[cleanup-e2e-tenants] ✅ ${plans.deleted} plan(s) supprimé(s) (préfixe "${p}")`);
        for (const s of plans.slugs) console.log(`  - plan ${s}`);
      }
    }
  })()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`[cleanup-e2e-tenants] ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
