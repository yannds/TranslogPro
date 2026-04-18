/**
 * Seed : plans SaaS publics (starter / growth / enterprise).
 *
 * Idempotent : upsert par slug. Préserve `sortOrder`, modules, limites.
 *
 * Exécuter :
 *   npx ts-node prisma/seeds/plans.seed.ts
 *
 * Les slugs doivent matcher `planSlugFromKey()` dans la landing :
 *   p1 → starter
 *   p2 → growth
 *   p3 → enterprise
 */
import { PrismaClient } from '@prisma/client';

// Modules InstalledModule référencés par clé — doivent exister dans le catalogue
// Tenant (activés par l'OnboardingService).
const CORE_MODULES       = ['TICKETING', 'PARCEL', 'FLEET', 'CASHIER', 'TRACKING', 'NOTIFICATIONS'];
const GROWTH_MODULES     = [...CORE_MODULES, 'CRM', 'ANALYTICS', 'SAV_MODULE'];
const ENTERPRISE_MODULES = [
  ...GROWTH_MODULES,
  'YIELD_ENGINE', 'WORKFLOW_STUDIO', 'WHITE_LABEL', 'QHSE',
  'DRIVER_PROFILE', 'CREW_BRIEFING', 'GARAGE_PRO', 'FLEET_DOCS',
];

interface PlanSeed {
  slug:         string;
  name:         string;
  description:  string;
  price:        number;
  currency:     string;
  billingCycle: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
  trialDays:    number;
  limits:       Record<string, number | string>;
  sla:          Record<string, number | string>;
  sortOrder:    number;
  isPublic:     boolean;
  isActive:     boolean;
  modules:      string[];
}

const PLANS: PlanSeed[] = [
  {
    slug:        'starter',
    name:        'Starter',
    description: 'Pour les jeunes compagnies qui veulent professionnaliser leur activité.',
    price:       49,
    currency:    'EUR',
    billingCycle:'MONTHLY',
    trialDays:   30,
    limits:      { maxUsers: 5, maxAgencies: 1, maxVehicles: 10 },
    sla:         { firstResponseHours: 48, uptimePct: 99.5 },
    sortOrder:   10,
    isPublic:    true,
    isActive:    true,
    modules:     CORE_MODULES,
  },
  {
    slug:        'growth',
    name:        'Growth',
    description: 'Le plan le plus choisi — modules étendus, multi-agences, CRM, analytics.',
    price:       149,
    currency:    'EUR',
    billingCycle:'MONTHLY',
    trialDays:   30,
    limits:      { maxUsers: 25, maxAgencies: 5, maxVehicles: 50 },
    sla:         { firstResponseHours: 24, uptimePct: 99.7 },
    sortOrder:   20,
    isPublic:    true,
    isActive:    true,
    modules:     GROWTH_MODULES,
  },
  {
    slug:        'enterprise',
    name:        'Enterprise',
    description: 'Volumétrie élevée, SLA dédié, personnalisation, support prioritaire 24/7.',
    price:       0, // "Sur mesure" — devis
    currency:    'EUR',
    billingCycle:'CUSTOM',
    trialDays:   30,
    limits:      { maxUsers: -1, maxAgencies: -1, maxVehicles: -1 }, // -1 = illimité
    sla:         { firstResponseHours: 4, uptimePct: 99.9, dedicatedAM: 1 },
    sortOrder:   30,
    isPublic:    true,
    isActive:    true,
    modules:     ENTERPRISE_MODULES,
  },
];

async function seedPlans(prisma: PrismaClient) {
  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where:  { slug: p.slug },
      update: {
        name:         p.name,
        description:  p.description,
        price:        p.price,
        currency:     p.currency,
        billingCycle: p.billingCycle,
        trialDays:    p.trialDays,
        limits:       p.limits,
        sla:          p.sla,
        sortOrder:    p.sortOrder,
        isPublic:     p.isPublic,
        isActive:     p.isActive,
      },
      create: {
        slug:         p.slug,
        name:         p.name,
        description:  p.description,
        price:        p.price,
        currency:     p.currency,
        billingCycle: p.billingCycle,
        trialDays:    p.trialDays,
        limits:       p.limits,
        sla:          p.sla,
        sortOrder:    p.sortOrder,
        isPublic:     p.isPublic,
        isActive:     p.isActive,
      },
    });

    // Re-sync modules (supprimer puis recréer — simple et idempotent).
    await prisma.planModule.deleteMany({ where: { planId: plan.id } });
    if (p.modules.length > 0) {
      await prisma.planModule.createMany({
        data: p.modules.map(moduleKey => ({ planId: plan.id, moduleKey })),
        skipDuplicates: true,
      });
    }

    console.log(`✓ Plan ${p.slug.padEnd(12)} — ${p.modules.length} modules, trial ${p.trialDays}j`);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedPlans(prisma);
    console.log('✓ Plans seed terminé');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export { seedPlans, PLANS };
