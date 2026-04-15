/**
 * Migration data — tenants existants → langue par défaut 'fr'.
 *
 * Les colonnes Tenant.language / timezone / currency ont été ajoutées au
 * schéma avec des defaults Prisma (fr / Africa/Brazzaville / XAF). En théorie
 * `prisma db push` les applique aux rows existantes. Ce script garantit une
 * convergence explicite pour les cas où :
 *   - la colonne a été ajoutée sans default et backfilled à NULL
 *   - un tenant a reçu un default différent par migration intermédiaire
 *
 * Idempotent : update conditionné sur le champ actuellement vide.
 *
 * Exécution : npx ts-node prisma/seeds/set-default-language.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  console.log('🔄 Migration langue par défaut fr pour tenants existants…');

  const tenants = await prisma.tenant.findMany({
    where:  { id: { not: PLATFORM_TENANT_ID } },
    select: { id: true, slug: true, language: true, timezone: true, currency: true },
  });

  let updated = 0;
  for (const tenant of tenants) {
    const patch: Record<string, string> = {};

    // Langue — si vide ou non reconnue, on force 'fr'
    if (!tenant.language || !['fr', 'en'].includes(tenant.language)) {
      patch.language = 'fr';
    }
    if (!tenant.timezone) patch.timezone = 'Africa/Brazzaville';
    if (!tenant.currency) patch.currency = 'XAF';

    if (Object.keys(patch).length === 0) continue;

    await prisma.tenant.update({
      where: { id: tenant.id },
      data:  patch,
    });
    updated++;
    console.log(`  ✓ tenant=${tenant.slug} → ${JSON.stringify(patch)}`);
  }

  console.log(`✅ ${updated} tenant(s) mis à jour sur ${tenants.length} scanné(s).`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
