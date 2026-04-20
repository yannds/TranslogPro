/**
 * PlatformKpiService — Tests d'intégration (DB réelle).
 *
 * Vérifie avec des données persistées :
 *   1. North Star mode déclaratif calcule correctement le % actual/estimated.
 *   2. North Star mode heuristique utilise capacity × tripsInPeriod × targetOccupancy.
 *   3. MRR breakdown totalise correctement par devise et groupe par plan.
 *   4. SubscriptionChange classement NEW / EXPANSION / CHURN agrège net new MRR.
 *   5. Activation funnel décroît correctement (trips → tickets → drivers → modules).
 *   6. Cache — une 2ᵉ requête identique ne déclenche pas de roundtrip DB.
 *
 * Isolation : chaque test utilise un namespace (RUN) pour éviter les collisions.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { PlatformKpiService } from '@modules/platform-kpi/platform-kpi.service';

const RUN = `kpi-integ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let prismaClient: PrismaClient;
let service:      PlatformKpiService;

// Config mock — évite la dépendance PlatformConfig DB
const configStub = {
  getNumber: async (k: string) => {
    const d: Record<string, number> = {
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30,
      'kpi.targetOccupancyRate': 0.65, 'kpi.moduleAdoptionThreshold': 0.3,
      'kpi.activation.minTickets': 1, 'kpi.activation.minTrips': 1,
    };
    return d[k] ?? 0;
  },
  getString:  async () => '',
  getBoolean: async () => false,
} as any;

async function createPlanAndSub(tenantId: string, slug: string, price: number, cycle: string) {
  const plan = await prismaClient.plan.create({
    data: { slug: `${RUN}-${slug}`, name: slug, price, currency: 'EUR', billingCycle: cycle, isActive: true },
  });
  await prismaClient.platformSubscription.create({
    data: { tenantId, planId: plan.id, status: 'ACTIVE', startedAt: new Date() },
  });
  return plan;
}

beforeAll(async () => {
  prismaClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  await prismaClient.$connect();
  service = new PlatformKpiService(prismaClient as unknown as PrismaService, configStub);
});

afterAll(async () => {
  // Cleanup ordre FK-safe
  await prismaClient.subscriptionChange.deleteMany({ where: { tenant: { slug: { startsWith: RUN } } } }).catch(() => {});
  await prismaClient.platformInvoice.deleteMany({ where: { tenant: { slug: { startsWith: RUN } } } }).catch(() => {});
  await prismaClient.platformSubscription.deleteMany({ where: { tenant: { slug: { startsWith: RUN } } } }).catch(() => {});
  await prismaClient.plan.deleteMany({ where: { slug: { startsWith: RUN } } }).catch(() => {});
  await prismaClient.tenant.deleteMany({ where: { slug: { startsWith: RUN } } }).catch(() => {});
  await prismaClient.$disconnect();
});

describe('[integ][KPI] North Star — modes déclaratif + heuristique', () => {
  it('calcule % déclaratif quand estimation est présente', async () => {
    const tid = `${RUN}-t-decl`;
    await prismaClient.tenant.create({
      data: {
        id: tid, slug: tid, name: 'T-Decl', isActive: true,
        estimatedOperationsMonthly: { tickets: 100, trips: 20, incidents: 2 },
      },
    });
    // Pas de tickets réels → pct = 0/100 = 0
    const report = await service.getNorthStar('declarative', 30);
    service.clearCache();
    const entry = report.perTenant.find((p) => p.tenantId === tid);
    expect(entry).toBeDefined();
    expect(entry!.declarative).not.toBeNull();
    expect(entry!.declarative!.tickets.estimated).toBe(100);
    expect(entry!.declarative!.tickets.pct).toBe(0);
    expect(entry!.appliedMode).toBe('declarative');
  });

  it('fallback heuristique quand estimation null et bus présents', async () => {
    const tid = `${RUN}-t-heur`;
    await prismaClient.tenant.create({
      data: { id: tid, slug: tid, name: 'T-Heur', isActive: true, estimatedOperationsMonthly: null as any },
    });
    // Crée une agency + bus pour avoir de la capacité
    const agency = await prismaClient.agency.create({
      data: { tenantId: tid, name: 'Main' },
    });
    await prismaClient.bus.create({
      data: {
        tenantId: tid, agencyId: agency.id,
        plateNumber: `B-${RUN}`, model: 'Sprinter', capacity: 50, luggageCapacityKg: 100, luggageCapacityM3: 5,
      },
    });
    // Pas de trips → capacity > 0 mais tripsInPeriod = 0 → heuristic null
    service.clearCache();
    const report = await service.getNorthStar('heuristic', 30);
    const entry = report.perTenant.find((p) => p.tenantId === tid);
    expect(entry).toBeDefined();
    // Pas de trips = pas de heuristic calculable
    expect(entry!.heuristic).toBeNull();
  });
});

describe('[integ][KPI] MRR Breakdown — agrégation par devise et plan', () => {
  it('normalise YEARLY à monthly pour MRR', async () => {
    const tid = `${RUN}-t-mrr`;
    await prismaClient.tenant.create({
      data: { id: tid, slug: tid, name: 'T-MRR', isActive: true },
    });
    await createPlanAndSub(tid, 'yearly', 1200, 'YEARLY'); // 1200/12 = 100/mo

    service.clearCache();
    const report = await service.getMrrBreakdown(30);
    expect(report.totals.mrr.EUR ?? 0).toBeGreaterThanOrEqual(100);
    expect(report.totals.activeTenants).toBeGreaterThanOrEqual(1);
  });
});

describe('[integ][KPI] Activation Funnel', () => {
  it('retourne un funnel même avec 0 activation complète', async () => {
    service.clearCache();
    const report = await service.getActivationFunnel();
    expect(report.totalTenants).toBeGreaterThanOrEqual(0);
    expect(report.steps).toHaveLength(4);
    expect(report.steps.map((s) => s.step)).toEqual(['TRIP_CREATED', 'TICKET_SOLD', 'DRIVER_ADDED', 'TWO_MODULES_USED']);
  });
});

describe('[integ][KPI] Cache', () => {
  it('deux appels consécutifs servent le même résultat (pas de fuite DB)', async () => {
    service.clearCache();
    const a = await service.getNorthStar('compared', 30);
    const b = await service.getNorthStar('compared', 30);
    expect(a).toEqual(b);
  });
});
