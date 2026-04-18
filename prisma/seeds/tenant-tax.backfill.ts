/**
 * Tenant Tax Backfill — migre `TenantBusinessConfig.tvaEnabled / tvaRate`
 * vers la table `TenantTax` (une ligne par tenant si tvaEnabled = true).
 *
 * Idempotent : ré-exécutable sans doublon (upsert sur [tenantId, code='TVA']).
 *
 * À exécuter une fois après la migration Prisma :
 *   npx ts-node prisma/seeds/tenant-tax.backfill.ts
 *
 * Le code métier continuera à lire l'ancien couple pour rétro-compat tant que
 * `TaxCalculatorService` n'est pas branché partout — P2 assure la bascule.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function backfillTenantTaxes() {
  console.log('[tenant-tax.backfill] Démarrage…');

  const configs = await prisma.tenantBusinessConfig.findMany({
    select: { tenantId: true, tvaEnabled: true, tvaRate: true },
  });

  let created = 0;
  let skipped = 0;

  for (const cfg of configs) {
    if (!cfg.tvaEnabled) {
      skipped++;
      continue;
    }

    await prisma.tenantTax.upsert({
      where: { tenantId_code: { tenantId: cfg.tenantId, code: 'TVA' } },
      create: {
        tenantId:  cfg.tenantId,
        code:      'TVA',
        label:     `TVA ${Math.round(cfg.tvaRate * 100)}%`,
        labelKey:  'tax.tva',
        rate:      cfg.tvaRate,
        kind:      'PERCENT',
        base:      'SUBTOTAL',
        appliesTo: ['ALL'],
        sortOrder: 0,
        enabled:   true,
      },
      update: {
        // Ré-exécution : on corrige le taux si l'admin l'a modifié dans
        // TenantBusinessConfig avant la bascule ; on laisse le reste stable.
        rate:  cfg.tvaRate,
        label: `TVA ${Math.round(cfg.tvaRate * 100)}%`,
      },
    });
    created++;
  }

  console.log(`[tenant-tax.backfill] Terminé — créés/mis à jour: ${created}, ignorés: ${skipped}`);
}

if (require.main === module) {
  backfillTenantTaxes()
    .catch(err => {
      console.error('[tenant-tax.backfill] Échec :', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
