/**
 * Pricing Defaults Backfill — rattrape tous les tenants pré-migration pricing S1.
 *
 * Actions idempotentes pour chaque tenant :
 *   1. Upsert TenantBusinessConfig (si manquant).
 *   2. Upsert TenantTax « TVA » isSystemDefault=true (desactivée par défaut).
 *   3. Upsert N TenantFareClass depuis `pricing.defaults.fareClasses`.
 *   4. Pour chaque Route sans PricingRules → crée une ligne par défaut depuis
 *      le registre (débloque la vente billets qui échouait en 400
 *      "Aucune règle tarifaire active").
 *
 * Zéro magic number : toutes les valeurs viennent du PLATFORM_CONFIG_REGISTRY
 * (fallback sur `def.default` si la clé n'est pas présente en DB).
 *
 * À exécuter une fois après la migration :
 *   npx ts-node prisma/seeds/pricing-defaults.backfill.ts
 *
 * Idempotent — toutes les écritures sont des upsert/skip.
 */
import { PrismaClient } from '@prisma/client';
import { PLATFORM_CONFIG_REGISTRY } from '../../src/modules/platform-config/platform-config.registry';
import { seedPeakPeriodsForTenant } from './peak-periods.seed';

const prisma = new PrismaClient();

export interface FareClassDef {
  code:       string;
  labelKey:   string;
  multiplier: number;
  sortOrder:  number;
  color?:     string;
}

/**
 * Lit une clé PlatformConfig depuis la DB avec fallback sur le registre.
 * Exporté pour ré-utilisation par `dev.seed.ts` (pas de DI NestJS côté seeds).
 */
export async function readPricingConfig<T>(
  client: PrismaClient,
  key:    string,
): Promise<T> {
  const row = await client.platformConfig.findUnique({ where: { key } });
  if (row?.value !== undefined && row.value !== null) return row.value as unknown as T;
  const def = PLATFORM_CONFIG_REGISTRY.find(d => d.key === key);
  if (!def) throw new Error(`[pricing-defaults] Clé inconnue dans le registre : "${key}"`);
  return def.default as T;
}

/**
 * Seed idempotent pour un tenant : TenantBusinessConfig + TenantTax(TVA) +
 * TenantFareClass × N + PricingRules pour routes orphelines.
 *
 * Exporté pour réutilisation par `dev.seed.ts` et `pricing-defaults.backfill`.
 * L'OnboardingService a sa propre implémentation équivalente (DI NestJS).
 */
export async function seedTenantPricingDefaults(
  client:   PrismaClient,
  tenantId: string,
): Promise<{
  businessConfigCreated: boolean;
  taxCreated:            boolean;
  fareClassesCreated:    number;
  pricingRulesCreated:   number;
  peakPeriodsCreated:    number;
}> {
  // 1. TenantBusinessConfig
  const bcExisting = await client.tenantBusinessConfig.findUnique({ where: { tenantId } });
  if (!bcExisting) {
    await client.tenantBusinessConfig.create({ data: { tenantId } });
  }

  // 2. TenantTax TVA (isSystemDefault — on ne touche pas si déjà présent)
  const tvaCode                     = await readPricingConfig<string>(client,  'tax.defaults.tvaCode');
  const tvaLabelKey                 = await readPricingConfig<string>(client,  'tax.defaults.tvaLabelKey');
  const tvaRate                     = await readPricingConfig<number>(client,  'tax.defaults.tvaRate');
  const tvaEnabled                  = await readPricingConfig<boolean>(client, 'tax.defaults.tvaEnabled');
  const tvaAppliedToPrice           = await readPricingConfig<boolean>(client, 'tax.defaults.tvaAppliedToPrice');
  const tvaAppliedToRecommendation  = await readPricingConfig<boolean>(client, 'tax.defaults.tvaAppliedToRecommendation');

  const taxExisting = await client.tenantTax.findUnique({
    where: { tenantId_code: { tenantId, code: tvaCode } },
  });
  if (!taxExisting) {
    await client.tenantTax.create({
      data: {
        tenantId,
        code:                    tvaCode,
        label:                   `TVA ${Math.round(tvaRate * 1000) / 10}%`,
        labelKey:                tvaLabelKey,
        rate:                    tvaRate,
        kind:                    'PERCENT',
        base:                    'SUBTOTAL',
        appliesTo:               ['ALL'],
        sortOrder:               0,
        enabled:                 tvaEnabled,
        appliedToPrice:          tvaAppliedToPrice,
        appliedToRecommendation: tvaAppliedToRecommendation,
        isSystemDefault:         true,
      },
    });
  }

  // 3. TenantFareClass × N
  const fareDefaults = await readPricingConfig<FareClassDef[]>(client, 'pricing.defaults.fareClasses');
  let fareClassesCreated = 0;
  for (const def of fareDefaults) {
    const existing = await client.tenantFareClass.findUnique({
      where: { tenantId_code: { tenantId, code: def.code } },
    });
    if (existing) continue;
    await client.tenantFareClass.create({
      data: {
        tenantId,
        code:            def.code,
        label:           def.code,
        labelKey:        def.labelKey,
        multiplier:      def.multiplier,
        sortOrder:       def.sortOrder,
        color:           def.color,
        enabled:         true,
        isSystemDefault: true,
      },
    });
    fareClassesCreated++;
  }

  // 4. PricingRules pour toutes les routes orphelines du tenant
  const [luggageFreeKg, luggagePerExtraKg, tollsXof, costPerKm] = await Promise.all([
    readPricingConfig<number>(client, 'pricing.defaults.luggageFreeKg'),
    readPricingConfig<number>(client, 'pricing.defaults.luggagePerExtraKg'),
    readPricingConfig<number>(client, 'pricing.defaults.tollsXof'),
    readPricingConfig<number>(client, 'pricing.defaults.costPerKm'),
  ]);
  const fareMultipliers: Record<string, number> = {};
  for (const fc of fareDefaults) fareMultipliers[fc.code] = fc.multiplier;

  const orphanRoutes = await client.route.findMany({
    where: {
      tenantId,
      NOT: {
        id: {
          in: (await client.pricingRules.findMany({
            where:  { tenantId },
            select: { routeId: true },
          })).map(r => r.routeId),
        },
      },
    },
    select: { id: true, basePrice: true },
  });

  let pricingRulesCreated = 0;
  for (const route of orphanRoutes) {
    await client.pricingRules.create({
      data: {
        tenantId,
        routeId: route.id,
        rules: {
          basePriceXof:      route.basePrice,
          taxRate:           0, // canonique via TenantTax, 0 = no-op legacy
          tollsXof,
          costPerKm,
          luggageFreeKg,
          luggagePerExtraKg,
          fareMultipliers,
        },
      },
    });
    pricingRulesCreated++;
  }

  // 5. Peak periods — seed selon le pays du tenant (null = universels seulement)
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: { country: true },
  });
  const peakResult = await seedPeakPeriodsForTenant(client, tenantId, tenant?.country ?? null);

  // 6. Activer le module YIELD_ENGINE par défaut (le calendrier peak n'a
  // d'effet que si le module est actif). L'admin peut le désactiver via
  // PageModules. Idempotent — n'écrase pas la config si déjà présent.
  await client.installedModule.upsert({
    where:  { tenantId_moduleKey: { tenantId, moduleKey: 'YIELD_ENGINE' } },
    create: { tenantId, moduleKey: 'YIELD_ENGINE', isActive: true, config: {} },
    update: { isActive: true },
  });

  return {
    businessConfigCreated: !bcExisting,
    taxCreated:            !taxExisting,
    fareClassesCreated,
    pricingRulesCreated,
    peakPeriodsCreated:    peakResult.created,
  };
}

export async function backfillPricingDefaults() {
  console.log('[pricing-defaults.backfill] Démarrage…');
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  console.log(`[pricing-defaults.backfill] ${tenants.length} tenant(s) à traiter`);

  let totals = { bc: 0, tax: 0, fc: 0, pr: 0 };

  let totalPeaks = 0;
  for (const t of tenants) {
    const r = await seedTenantPricingDefaults(prisma, t.id);
    console.log(
      `[pricing-defaults.backfill] ${t.slug} → BC:${r.businessConfigCreated ? 'created' : 'skip'} ` +
      `TVA:${r.taxCreated ? 'created' : 'skip'} ` +
      `FareClass:${r.fareClassesCreated}/${await prisma.tenantFareClass.count({ where: { tenantId: t.id } })} ` +
      `PricingRules:${r.pricingRulesCreated} ` +
      `PeakPeriods:+${r.peakPeriodsCreated}`,
    );
    if (r.businessConfigCreated) totals.bc++;
    if (r.taxCreated) totals.tax++;
    totals.fc += r.fareClassesCreated;
    totals.pr += r.pricingRulesCreated;
    totalPeaks += r.peakPeriodsCreated;
  }

  console.log(
    `[pricing-defaults.backfill] Terminé — TenantBusinessConfig:${totals.bc}, TVA:${totals.tax}, ` +
    `FareClass:${totals.fc}, PricingRules(orphelines):${totals.pr}, PeakPeriods:${totalPeaks}`,
  );
}

if (require.main === module) {
  backfillPricingDefaults()
    .catch(err => {
      console.error('[pricing-defaults.backfill] Échec :', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
