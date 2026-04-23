/**
 * cms-pages.backfill.ts — Backfill des pages CMS pour les tenants existants.
 *
 * Crée (idempotent) pour chaque tenant actif qui n'a pas encore ses pages CMS :
 *   - TenantPortalConfig
 *   - TenantPage about / fleet / contact (fr + en)
 *   - TenantPost de bienvenue
 *
 * Usage :
 *   npx ts-node prisma/seeds/cms-pages.backfill.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedCmsPages } from './cms-pages.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('[CMS Backfill] Démarrage...');

  const tenants = await prisma.tenant.findMany({
    where:   { provisionStatus: 'ACTIVE' },
    select:  { id: true, name: true, country: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[CMS Backfill] ${tenants.length} tenant(s) actif(s) à traiter`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const r = await seedCmsPages(prisma, tenant.id, {
      companyName: tenant.name,
      city:        '',
      country:     tenant.country ?? '',
    });

    if (r.pages > 0 || r.posts > 0 || r.configCreated) {
      console.log(
        `[CMS Backfill] ✅ ${tenant.name} (${tenant.id}) — ` +
        `pages:${r.pages} posts:${r.posts} config:${r.configCreated ? 'created' : 'skip'}`,
      );
      seeded++;
    } else {
      skipped++;
    }
  }

  console.log(`[CMS Backfill] Terminé — ${seeded} tenant(s) mis à jour, ${skipped} déjà à jour.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
