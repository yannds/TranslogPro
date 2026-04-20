import { PlatformKpiService } from '../../../src/modules/platform-kpi/platform-kpi.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createPrismaMock(overrides: Partial<Record<string, any>> = {}) {
  const base = {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      count:    jest.fn().mockResolvedValue(0),
    },
    ticket: {
      count:    jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    trip: {
      count:    jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy:  jest.fn().mockResolvedValue([]),
    },
    parcel: {
      groupBy:  jest.fn().mockResolvedValue([]),
    },
    incident: {
      count: jest.fn().mockResolvedValue(0),
    },
    bus: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { capacity: 0 } }),
    },
    user: {
      count:    jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    installedModule: {
      count:    jest.fn().mockResolvedValue(0),
      groupBy:  jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    moduleUsageDaily: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscriptionChange: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    dailyActiveUser: {
      groupBy:  jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { sessionsCount: 0 } }),
    },
    auditLog: {
      count:    jest.fn().mockResolvedValue(0),
      groupBy:  jest.fn().mockResolvedValue([]),
    },
  };
  return { ...base, ...overrides };
}

function createConfigMock(values: Record<string, number | string | boolean> = {}) {
  return {
    getNumber:  jest.fn(async (k: string) => values[k] as number ?? 0),
    getString:  jest.fn(async (k: string) => values[k] as string ?? ''),
    getBoolean: jest.fn(async (k: string) => values[k] as boolean ?? false),
  };
}

function make(prisma: any, config: any = createConfigMock()) {
  return new PlatformKpiService(prisma as any, config as any);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('PlatformKpiService — cache', () => {
  it('caches results per key within TTL', async () => {
    const prisma = createPrismaMock();
    prisma.subscriptionChange.findMany.mockResolvedValue([]);
    prisma.platformSubscription.findMany.mockResolvedValue([]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    await svc.getMrrBreakdown(30);
    await svc.getMrrBreakdown(30);
    expect(prisma.platformSubscription.findMany).toHaveBeenCalledTimes(1);
  });

  it('clearCache forces re-fetch', async () => {
    const prisma = createPrismaMock();
    prisma.subscriptionChange.findMany.mockResolvedValue([]);
    prisma.platformSubscription.findMany.mockResolvedValue([]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    await svc.getMrrBreakdown(30);
    svc.clearCache('mrr:');
    await svc.getMrrBreakdown(30);
    expect(prisma.platformSubscription.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('PlatformKpiService — getNorthStar', () => {
  it('excludes the platform tenant from queries', async () => {
    const prisma = createPrismaMock();
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
    }));
    await svc.getNorthStar('compared', 30);
    const call = prisma.tenant.findMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ not: PLATFORM_TENANT_ID });
    expect(call.where.isActive).toBe(true);
  });

  it('returns null pctViaSaasAvg when no tenant has data', async () => {
    const prisma = createPrismaMock();
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'T1', slug: 't1', estimatedOperationsMonthly: null },
    ]);
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
    }));
    const report = await svc.getNorthStar('compared', 30);
    expect(report.global.pctViaSaasAvg).toBeNull();
    expect(report.global.tenantsMissing).toBe(1);
  });

  it('computes declarative pct when estimation is set', async () => {
    const prisma = createPrismaMock();
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'T1', slug: 't1', estimatedOperationsMonthly: { tickets: 100, trips: 20, incidents: 1 } },
    ]);
    // Actual on 30j = 60 tickets → monthlyFactor = 30/30=1 → 60 → pct = 60/100 = 0.6
    prisma.ticket.count.mockResolvedValue(60);
    prisma.trip.count.mockResolvedValue(10);
    prisma.incident.count.mockResolvedValue(0);
    prisma.bus.aggregate.mockResolvedValue({ _sum: { capacity: 0 } });
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
    }));
    const report = await svc.getNorthStar('declarative', 30);
    expect(report.perTenant[0].declarative?.tickets.pct).toBeCloseTo(0.6, 2);
    expect(report.perTenant[0].declarative?.trips.pct).toBeCloseTo(0.5, 2);
    expect(report.perTenant[0].appliedMode).toBe('declarative');
  });

  it('falls back to heuristic when declarative null and capacity > 0', async () => {
    const prisma = createPrismaMock();
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'T1', slug: 't1', estimatedOperationsMonthly: null },
    ]);
    prisma.ticket.count.mockResolvedValue(100);
    prisma.trip.count.mockResolvedValue(10);
    prisma.incident.count.mockResolvedValue(0);
    prisma.bus.aggregate.mockResolvedValue({ _sum: { capacity: 50 } });
    // theoretical = 50 × 10 × 0.65 = 325 → pct = 100/325 ≈ 0.3077
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
    }));
    const report = await svc.getNorthStar('declarative', 30);
    expect(report.perTenant[0].heuristic?.tickets.pct).toBeCloseTo(0.3077, 2);
    expect(report.perTenant[0].appliedMode).toBe('heuristic');
  });
});

describe('PlatformKpiService — getMrrBreakdown', () => {
  it('normalizes YEARLY plan to monthly MRR', async () => {
    const prisma = createPrismaMock();
    prisma.platformSubscription.findMany.mockResolvedValue([
      {
        id: 's1', planId: 'p1', tenantId: 't1',
        plan: { id: 'p1', slug: 'pro', price: 600, currency: 'EUR', billingCycle: 'YEARLY' },
        tenant: { id: 't1' },
      },
    ]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));
    const report = await svc.getMrrBreakdown(30);
    expect(report.totals.mrr.EUR).toBeCloseTo(50, 1);
    expect(report.totals.arr.EUR).toBeCloseTo(600, 1);
    expect(report.totals.payingTenants).toBe(1);
    expect(report.totals.arpu.EUR).toBeCloseTo(50, 1);
  });

  it('computes net new MRR = new + expansion - contraction - churn', async () => {
    const prisma = createPrismaMock();
    prisma.platformSubscription.findMany.mockResolvedValue([]);
    prisma.subscriptionChange.findMany.mockImplementation((args: any) => {
      // first call = current period; second = previous
      if (args.where.createdAt.gte && !args.where.createdAt.lt) {
        return Promise.resolve([
          { changeType: 'NEW',         deltaMonthly: 50,  currency: 'EUR' },
          { changeType: 'EXPANSION',   deltaMonthly: 20,  currency: 'EUR' },
          { changeType: 'CONTRACTION', deltaMonthly: -10, currency: 'EUR' },
          { changeType: 'CHURN',       deltaMonthly: -30, currency: 'EUR' },
        ]);
      }
      return Promise.resolve([]);
    });
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));
    const report = await svc.getMrrBreakdown(30);
    expect(report.growth.newRevenue.EUR).toBe(50);
    expect(report.growth.expansionRevenue.EUR).toBe(20);
    expect(report.growth.contractionRevenue.EUR).toBe(10);
    expect(report.growth.churnRevenue.EUR).toBe(30);
    expect(report.growth.netNewMrr.EUR).toBe(30); // 50 + 20 - 10 - 30
  });

  it('picks the top currency as reference', async () => {
    const prisma = createPrismaMock();
    prisma.platformSubscription.findMany.mockResolvedValue([
      { id: 's1', planId: 'p1', tenantId: 't1', plan: { slug: 'a', price: 10, currency: 'EUR', billingCycle: 'MONTHLY' } },
      { id: 's2', planId: 'p2', tenantId: 't2', plan: { slug: 'b', price: 100, currency: 'XAF', billingCycle: 'MONTHLY' } },
    ]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));
    const report = await svc.getMrrBreakdown(30);
    expect(report.currencyReference).toBe('XAF');
  });
});

describe('PlatformKpiService — getTransactional', () => {
  it('computes digital vs offline ratio from customer.userId', async () => {
    const prisma = createPrismaMock();
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1', currency: 'EUR' }]);
    prisma.ticket.findMany.mockResolvedValue([
      { id: 'a', tenantId: 't1', pricePaid: 10, customerId: 'c1', customer: { userId: 'u1' }, createdAt: new Date() },
      { id: 'b', tenantId: 't1', pricePaid: 20, customerId: null, customer: null, createdAt: new Date() },
    ]);
    prisma.trip.groupBy.mockResolvedValue([]);
    prisma.parcel.groupBy.mockResolvedValue([]);
    prisma.trip.findMany.mockResolvedValue([]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));
    const report = await svc.getTransactional(30);
    expect(report.tickets.total).toBe(2);
    expect(report.tickets.gmv.EUR).toBe(30);
    expect(report.tickets.pctDigital).toBeCloseTo(0.5, 2);
    expect(report.tickets.pctOffline).toBeCloseTo(0.5, 2);
  });

  it('computes on-time % with 10min tolerance', async () => {
    const prisma = createPrismaMock();
    const baseTime = new Date('2026-04-01T10:00:00Z');
    prisma.tenant.findMany.mockResolvedValue([]);
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.trip.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { status: 2 } },
    ]);
    prisma.parcel.groupBy.mockResolvedValue([]);
    prisma.trip.findMany.mockImplementation((args: any) => {
      if (args.where.status === 'COMPLETED') {
        return Promise.resolve([
          { departureScheduled: baseTime, departureActual: new Date(baseTime.getTime() + 5 * 60_000) },   // 5min — ontime
          { departureScheduled: baseTime, departureActual: new Date(baseTime.getTime() + 20 * 60_000) },  // 20min — late
        ]);
      }
      return Promise.resolve([]);
    });
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));
    const report = await svc.getTransactional(30);
    expect(report.trips.onTimePct).toBeCloseTo(0.5, 2);
  });
});

describe('PlatformKpiService — getAdoptionBreakdown', () => {
  it('buckets users into STAFF / DRIVER / CUSTOMER correctly', async () => {
    const prisma = createPrismaMock();
    const now = Date.now();
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', userType: 'STAFF',    lastActiveAt: new Date(now - 1000), role: { name: 'AGENT' } },
      { id: 'u2', userType: 'STAFF',    lastActiveAt: new Date(now - 1000), role: { name: 'DRIVER' } },
      { id: 'u3', userType: 'CUSTOMER', lastActiveAt: new Date(now - 1000), role: null },
    ]);
    prisma.tenant.count.mockResolvedValue(1);
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.moduleAdoptionThreshold': 0.3,
    }));
    const report = await svc.getAdoptionBreakdown(30);
    expect(report.users.dau.STAFF).toBe(1);
    expect(report.users.dau.DRIVER).toBe(1);
    expect(report.users.dau.CUSTOMER).toBe(1);
  });

  it('marks module as adopted when ≥ threshold', async () => {
    const prisma = createPrismaMock();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.tenant.count.mockResolvedValue(10);
    prisma.installedModule.groupBy.mockResolvedValue([
      { moduleKey: 'TICKETING', _count: { tenantId: 5 } },  // 50% → adopted
      { moduleKey: 'QHSE',      _count: { tenantId: 2 } },  // 20% → not adopted
    ]);
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.moduleAdoptionThreshold': 0.3,
    }));
    const report = await svc.getAdoptionBreakdown(30);
    const t = report.modules.find((m) => m.moduleKey === 'TICKETING')!;
    const q = report.modules.find((m) => m.moduleKey === 'QHSE')!;
    expect(t.adopted).toBe(true);
    expect(q.adopted).toBe(false);
  });
});

describe('PlatformKpiService — getActivationFunnel', () => {
  it('computes descending funnel conversion', async () => {
    const prisma = createPrismaMock();
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'a', createdAt: new Date() },
      { id: 'b', createdAt: new Date() },
      { id: 'c', createdAt: new Date() },
    ]);
    // a: all 4 steps; b: 2 steps; c: 0
    prisma.trip.count.mockImplementation((args: any) => {
      if (args.where.tenantId === 'a') return 5;
      if (args.where.tenantId === 'b') return 5;
      return 0;
    });
    prisma.ticket.count.mockImplementation((args: any) => {
      if (args.where.tenantId === 'a') return 5;
      if (args.where.tenantId === 'b') return 5;
      return 0;
    });
    prisma.user.count.mockImplementation((args: any) => {
      if (args.where.tenantId === 'a') return 1;
      return 0;
    });
    prisma.installedModule.count.mockImplementation((args: any) => {
      if (args.where.tenantId === 'a') return 3;
      return 1;
    });
    prisma.ticket.findFirst.mockResolvedValue({ createdAt: new Date() });
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.activation.minTickets': 1, 'kpi.activation.minTrips': 1,
    }));
    const report = await svc.getActivationFunnel();
    expect(report.totalTenants).toBe(3);
    expect(report.steps[0].tenants).toBe(2); // trip_created
    expect(report.steps[1].tenants).toBe(2); // ticket_sold
    expect(report.steps[2].tenants).toBe(1); // driver_added
    expect(report.steps[3].tenants).toBe(1); // two_modules
    // conversion : ticket_sold vs trip_created = 2/2 = 1
    expect(report.steps[1].conversionPct).toBeCloseTo(1, 2);
    // conversion : driver_added vs ticket_sold = 1/2 = 0.5
    expect(report.steps[2].conversionPct).toBeCloseTo(0.5, 2);
  });
});

describe('PlatformKpiService — getStrategic', () => {
  it('returns avg actions per active user and top tenants', async () => {
    const prisma = createPrismaMock();
    prisma.auditLog.count.mockResolvedValue(200);
    prisma.user.count.mockResolvedValue(10);
    prisma.auditLog.groupBy.mockResolvedValue([
      { tenantId: 't1', _count: { _all: 120 } },
      { tenantId: 't2', _count: { _all: 80 } },
    ]);
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'T1' }, { id: 't2', name: 'T2' },
    ]);
    prisma.dailyActiveUser.aggregate.mockResolvedValue({ _sum: { sessionsCount: 50 } });
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
    }));
    const report = await svc.getStrategic(7);
    expect(report.avgActionsPerUserWeek).toBe(20);
    expect(report.avgSessionsPerUserWeek).toBe(5);
    expect(report.topActiveTenants).toHaveLength(2);
    expect(report.topActiveTenants[0].tenantName).toBe('T1');
  });
});

describe('PlatformKpiService — edge cases', () => {
  it('handles zero tenants gracefully', async () => {
    const prisma = createPrismaMock();
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
      'kpi.activation.minTickets': 1, 'kpi.activation.minTrips': 1, 'kpi.moduleAdoptionThreshold': 0.3,
    }));
    const ns   = await svc.getNorthStar('compared', 30);
    const mrr  = await svc.getMrrBreakdown(30);
    const act  = await svc.getActivationFunnel();
    const adp  = await svc.getAdoptionBreakdown(30);
    expect(ns.global.tenantsCovered).toBe(0);
    expect(mrr.totals.activeTenants).toBe(0);
    expect(act.totalTenants).toBe(0);
    expect(adp.users.totalActive.STAFF).toBe(0);
  });

  it('does not leak PLATFORM_TENANT_ID in queries', async () => {
    const prisma = createPrismaMock();
    const svc = make(prisma, createConfigMock({
      'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
    }));
    await svc.getTransactional(30);
    const tcalls = prisma.ticket.findMany.mock.calls;
    expect(tcalls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
  });
});

// ─── Modules Usage par tenant ─────────────────────────────────────────────

describe('PlatformKpiService.getModulesUsageForTenant', () => {
  it('retourne toutes les clés du registry même sans usage', async () => {
    const prisma = createPrismaMock();
    // Aucun module installé, aucun usage → toutes les clés du registry doivent apparaître
    prisma.installedModule.findMany.mockResolvedValue([]);
    prisma.moduleUsageDaily.findMany.mockResolvedValue([]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    const report = await svc.getModulesUsageForTenant('tenant-abc', 30);

    expect(report.tenantId).toBe('tenant-abc');
    expect(report.periodDays).toBe(30);
    // registry = ticketing, trips, parcels, garage, qhse, pricing, reporting, crm
    expect(report.modules.length).toBeGreaterThanOrEqual(8);
    const ticketing = report.modules.find((m) => m.moduleKey === 'TICKETING')!;
    expect(ticketing.installed).toBe(false);
    expect(ticketing.isActive).toBe(false);
    expect(ticketing.actionCount).toBe(0);
    expect(ticketing.lastUsedAt).toBeNull();
  });

  it("expose activatedAt/By et deactivatedAt/By d'un module désactivé", async () => {
    const prisma = createPrismaMock();
    prisma.installedModule.findMany.mockResolvedValue([
      {
        moduleKey: 'TICKETING', isActive: false,
        activatedAt: new Date('2026-01-01'), activatedBy: 'user-admin',
        deactivatedAt: new Date('2026-04-15'), deactivatedBy: 'user-admin',
      },
    ]);
    prisma.moduleUsageDaily.findMany.mockResolvedValue([]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    const report = await svc.getModulesUsageForTenant('tenant-abc', 30);
    const ticketing = report.modules.find((m) => m.moduleKey === 'TICKETING')!;
    expect(ticketing.installed).toBe(true);
    expect(ticketing.isActive).toBe(false);
    expect(ticketing.activatedBy).toBe('user-admin');
    expect(ticketing.deactivatedBy).toBe('user-admin');
    expect(ticketing.deactivatedAt).toBe(new Date('2026-04-15').toISOString());
  });

  it('agrège actionCount, activeDays et lastUsedAt depuis ModuleUsageDaily', async () => {
    const prisma = createPrismaMock();
    prisma.installedModule.findMany.mockResolvedValue([
      {
        moduleKey: 'PARCEL', isActive: true,
        activatedAt: new Date('2026-01-01'), activatedBy: 'user-1',
        deactivatedAt: null, deactivatedBy: null,
      },
    ]);
    prisma.moduleUsageDaily.findMany.mockResolvedValue([
      { moduleKey: 'PARCEL', date: new Date('2026-04-10'), actionCount: 5,  uniqueUsers: 2 },
      { moduleKey: 'PARCEL', date: new Date('2026-04-11'), actionCount: 12, uniqueUsers: 4 },
      { moduleKey: 'PARCEL', date: new Date('2026-04-12'), actionCount: 0,  uniqueUsers: 0 },
      { moduleKey: 'PARCEL', date: new Date('2026-04-13'), actionCount: 3,  uniqueUsers: 1 },
    ]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    const report = await svc.getModulesUsageForTenant('tenant-abc', 30);
    const parcels = report.modules.find((m) => m.moduleKey === 'PARCEL')!;
    expect(parcels.actionCount).toBe(20);   // 5+12+0+3
    expect(parcels.uniqueUsers).toBe(4);    // max quotidien
    expect(parcels.activeDays).toBe(3);     // 3 jours avec actionCount > 0
    expect(parcels.lastUsedAt).toBe('2026-04-13');
  });

  it('trie les modules par actionCount décroissant', async () => {
    const prisma = createPrismaMock();
    prisma.installedModule.findMany.mockResolvedValue([]);
    prisma.moduleUsageDaily.findMany.mockResolvedValue([
      { moduleKey: 'TICKETING', date: new Date('2026-04-10'), actionCount: 100, uniqueUsers: 5 },
      { moduleKey: 'PARCEL',   date: new Date('2026-04-10'), actionCount: 50,  uniqueUsers: 3 },
      { moduleKey: 'QHSE',      date: new Date('2026-04-10'), actionCount: 200, uniqueUsers: 8 },
    ]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    const report = await svc.getModulesUsageForTenant('tenant-abc', 30);
    // Le plus utilisé en premier
    expect(report.modules[0].moduleKey).toBe('QHSE');
    expect(report.modules[1].moduleKey).toBe('TICKETING');
    expect(report.modules[2].moduleKey).toBe('PARCEL');
  });

  it('inclut modules legacy hors registry (installés mais pas dans MODULE_ACTION_PREFIXES)', async () => {
    const prisma = createPrismaMock();
    prisma.installedModule.findMany.mockResolvedValue([
      {
        moduleKey: 'YIELD_ENGINE', isActive: true,
        activatedAt: new Date('2026-01-01'), activatedBy: null,
        deactivatedAt: null, deactivatedBy: null,
      },
    ]);
    prisma.moduleUsageDaily.findMany.mockResolvedValue([]);
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));

    const report = await svc.getModulesUsageForTenant('tenant-abc', 30);
    const yield_ = report.modules.find((m) => m.moduleKey === 'YIELD_ENGINE');
    expect(yield_).toBeDefined();
    expect(yield_!.installed).toBe(true);
    expect(yield_!.isActive).toBe(true);
    expect(yield_!.actionCount).toBe(0);
  });

  it('filtre ModuleUsageDaily par tenantId et période', async () => {
    const prisma = createPrismaMock();
    const svc = make(prisma, createConfigMock({ 'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30 }));
    await svc.getModulesUsageForTenant('tenant-xyz', 14);
    const call = prisma.moduleUsageDaily.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe('tenant-xyz');
    expect(call.where.date.gte).toBeInstanceOf(Date);
  });
});
