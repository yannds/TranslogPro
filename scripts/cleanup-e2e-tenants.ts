/**
 * scripts/cleanup-e2e-tenants.ts — purge idempotente des tenants E2E.
 *
 * Deux usages :
 *
 *   1. Helper importé par Playwright (via `deleteTenantBySlug` et
 *      `deleteTenantsByPrefix`) pour nettoyer le tenant créé par un test.
 *
 *   2. CLI batch pour purger tous les tenants d'un préfixe en CI :
 *        npx ts-node scripts/cleanup-e2e-tenants.ts pw-saas-
 *        npx ts-node scripts/cleanup-e2e-tenants.ts        # défaut pw-saas-
 *
 * Implémentation : on désactive localement les contraintes FK Postgres via
 * `SET LOCAL session_replication_role = 'replica'` pour la durée d'une
 * transaction. Cela permet un DELETE sur `tenants` même quand des FK
 * tenant-scoped n'ont pas `onDelete: Cascade` déclaré dans le schema.
 * Les cascades déclarées continuent de fonctionner ; les autres lignes
 * deviennent orphelines mais ne bloquent plus la suppression (acceptable
 * pour des tenants E2E jetables).
 *
 * ⚠️ Cette technique n'est utilisée QUE pour le cleanup E2E, jamais dans
 * le code applicatif.
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
      // FK cascade locale à la transaction — les cascades Prisma déclarées
      // restent actives, les FK non-cascade sont ignorées le temps du DELETE.
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenant.id);
    });

    return true;
  } finally {
    if (ownsClient) await client.$disconnect();
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
  deleteTenantsByPrefix(prefix)
    .then(({ deleted, slugs }) => {
      console.log(`[cleanup-e2e-tenants] ✅ ${deleted} tenant(s) supprimé(s) (préfixe "${prefix}")`);
      if (slugs.length > 0) {
        for (const s of slugs) console.log(`  - ${s}`);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error(`[cleanup-e2e-tenants] ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
