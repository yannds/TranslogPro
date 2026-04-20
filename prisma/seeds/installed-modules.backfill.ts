/**
 * Backfill installed_modules — garantit que chaque tenant actif a toutes les
 * lignes `InstalledModule` correspondant aux modules CORE, et que les modules
 * avancés référencés par son plan sont également présents.
 *
 * Contexte : `OnboardingService.seedInstalledModules` ne tourne qu'au signup
 * complet. Les tenants historiques (seed dev, import manuel) ont été créés
 * avant son introduction → `installed_modules` est partiel ou vide → la page
 * plateforme "Degré d'adoption par module" affiche "Non installé" alors que
 * le module est utilisé (voir `audit_logs` pour preuve d'usage).
 *
 * Idempotent : skipDuplicates sur la unique constraint (tenantId, moduleKey).
 * Rejouable sans risque — ne désactive jamais un module déjà activé.
 *
 * Exécution :
 *   npx ts-node prisma/seeds/installed-modules.backfill.ts
 */

import { PrismaClient } from '@prisma/client';
import { PLATFORM_TENANT_ID } from './iam.seed';

const CORE_MODULES = [
  'TICKETING', 'PARCEL', 'FLEET', 'CASHIER', 'TRACKING', 'NOTIFICATIONS',
] as const;

async function backfillInstalledModules(prisma: PrismaClient) {
  const tenants = await prisma.tenant.findMany({
    where:  { isActive: true, id: { not: PLATFORM_TENANT_ID } },
    select: { id: true, slug: true, planId: true },
  });

  let tenantsTouched = 0;
  let rowsCreated    = 0;

  for (const tenant of tenants) {
    // Modules attendus = CORE toujours + modules du plan (s'il en a un)
    const planModules = tenant.planId
      ? await prisma.planModule.findMany({
          where:  { planId: tenant.planId },
          select: { moduleKey: true },
        })
      : [];
    const expected = new Set<string>([
      ...CORE_MODULES,
      ...planModules.map(m => m.moduleKey),
    ]);

    const existing = await prisma.installedModule.findMany({
      where:  { tenantId: tenant.id },
      select: { moduleKey: true },
    });
    const existingSet = new Set(existing.map(r => r.moduleKey));

    const missing = Array.from(expected).filter(k => !existingSet.has(k));
    if (missing.length === 0) continue;

    const res = await prisma.installedModule.createMany({
      data: missing.map(key => ({
        tenantId:  tenant.id,
        moduleKey: key,
        isActive:  true,
      })),
      skipDuplicates: true,
    });

    rowsCreated   += res.count;
    tenantsTouched += 1;
    console.log(`  ✓ ${tenant.slug}  +${res.count} modules  [${missing.join(', ')}]`);
  }

  return { scanned: tenants.length, tenantsTouched, rowsCreated };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('[installed-modules.backfill] démarrage…');
    const stats = await backfillInstalledModules(prisma);
    console.log(
      `[installed-modules.backfill] ✅ ${stats.scanned} tenants scannés, ` +
      `${stats.tenantsTouched} modifiés, ${stats.rowsCreated} rows créées`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export { backfillInstalledModules, CORE_MODULES };
