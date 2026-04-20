import { SeasonalityService } from '../../../src/modules/analytics/seasonality.service';

/**
 * Tests SeasonalityService (Sprint 4) — 2 axes :
 *   1. Règle YoY progressive (computeHistoryWindow)
 *   2. Agrégation + deltas vs période précédente / YoY
 */

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

function buildPrismaMock(opts: {
  earliestTripDate?: Date | null;
  trips?:             any[];
  existingAggregates?: any[];
} = {}) {
  const agStore = new Map<string, any>();
  (opts.existingAggregates ?? []).forEach(a => agStore.set(a.id, a));

  return {
    trip: {
      findFirst: jest.fn().mockResolvedValue(
        opts.earliestTripDate
          ? { departureScheduled: opts.earliestTripDate }
          : null,
      ),
      findMany: jest.fn().mockResolvedValue(opts.trips ?? []),
    },
    seasonalAggregate: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockImplementation(async ({ data }: any) => {
        for (const d of data) agStore.set(`${d.routeId ?? 'T'}|${d.periodType}|${d.periodKey}`, { ...d, id: `${d.routeId ?? 'T'}|${d.periodType}|${d.periodKey}` });
        return { count: data.length };
      }),
      findMany:   jest.fn().mockImplementation(async () => Array.from(agStore.values())),
      update:     jest.fn().mockImplementation(async ({ where, data }: any) => {
        const r = agStore.get(where.id);
        if (r) Object.assign(r, data);
        return r;
      }),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

describe('SeasonalityService.computeHistoryWindow (règle YoY progressive)', () => {
  it('INSUFFICIENT si aucun trip', async () => {
    const svc = new SeasonalityService(buildPrismaMock({ earliestTripDate: null }));
    const r = await svc.computeHistoryWindow('tenant-x');
    expect(r.window).toBe('INSUFFICIENT');
    expect(r.yoyAvailable).toBe(false);
    expect(r.daysOfHistory).toBe(0);
  });

  it('INSUFFICIENT si < 30 jours', async () => {
    const svc = new SeasonalityService(buildPrismaMock({ earliestTripDate: daysAgo(10) }));
    const r = await svc.computeHistoryWindow('tenant-x');
    expect(r.window).toBe('INSUFFICIENT');
    expect(r.yoyAvailable).toBe(false);
  });

  it('SHORT entre 30 et 89 jours', async () => {
    const svc = new SeasonalityService(buildPrismaMock({ earliestTripDate: daysAgo(45) }));
    const r = await svc.computeHistoryWindow('tenant-x');
    expect(r.window).toBe('SHORT');
    expect(r.yoyAvailable).toBe(false);
  });

  it('MEDIUM entre 90 et 364 jours', async () => {
    const svc = new SeasonalityService(buildPrismaMock({ earliestTripDate: daysAgo(200) }));
    const r = await svc.computeHistoryWindow('tenant-x');
    expect(r.window).toBe('MEDIUM');
    expect(r.yoyAvailable).toBe(false);
  });

  it('YOY à partir de 365 jours', async () => {
    const svc = new SeasonalityService(buildPrismaMock({ earliestTripDate: daysAgo(400) }));
    const r = await svc.computeHistoryWindow('tenant-x');
    expect(r.window).toBe('YOY');
    expect(r.yoyAvailable).toBe(true);
  });

  it('MULTI_YEAR à partir de 730 jours', async () => {
    const svc = new SeasonalityService(buildPrismaMock({ earliestTripDate: daysAgo(900) }));
    const r = await svc.computeHistoryWindow('tenant-x');
    expect(r.window).toBe('MULTI_YEAR');
    expect(r.yoyAvailable).toBe(true);
  });
});

describe('SeasonalityService.recomputeForTenant (agrégations)', () => {
  const mkTrip = (date: Date, opts: { route?: string; revenue?: number; fillRate?: number; tag?: string } = {}) => ({
    id: `trip-${date.toISOString()}`,
    routeId: opts.route ?? 'route-1',
    departureScheduled: date,
    costSnapshot: {
      ticketRevenue: opts.revenue ?? 10_000,
      parcelRevenue: 0,
      fillRate:      opts.fillRate ?? 0.7,
      netMargin:     1000,
      profitabilityTag: opts.tag ?? 'PROFITABLE',
    },
  });

  it('agrège un trip unique dans les 4 periodType (YEAR/MONTH/WEEK/WEEKDAY ou WEEKEND)', async () => {
    const mon = new Date(Date.UTC(2026, 3, 20, 10, 0, 0)); // Lundi 20 avril 2026
    const prisma = buildPrismaMock({ trips: [mkTrip(mon)] });
    const svc = new SeasonalityService(prisma);

    const stats = await svc.recomputeForTenant('tenant-x');
    // 1 trip × (tenant-global + par-route) × 4 periodType = 8 agrégats
    expect(stats.YEAR).toBe(2);
    expect(stats.MONTH).toBe(2);
    expect(stats.WEEK).toBe(2);
    expect(stats.WEEKDAY).toBe(2); // lundi = WEEKDAY
    expect(stats.WEEKEND).toBe(0);
  });

  it('sépare WEEKDAY et WEEKEND correctement', async () => {
    const monday = new Date(Date.UTC(2026, 3, 20)); // lundi
    const sunday = new Date(Date.UTC(2026, 3, 19)); // dimanche
    const prisma = buildPrismaMock({ trips: [mkTrip(monday), mkTrip(sunday)] });
    const svc = new SeasonalityService(prisma);
    const stats = await svc.recomputeForTenant('tenant-x');
    expect(stats.WEEKDAY).toBe(2); // lundi × (global + route)
    expect(stats.WEEKEND).toBe(2); // dimanche × (global + route)
  });

  it('calcule vsLastYearPct sur agrégats mensuels avec 13+ mois de données', async () => {
    // 2 trips : un en avril 2025, un en avril 2026, pour tester YoY mensuel
    const apr2025 = new Date(Date.UTC(2025, 3, 15));
    const apr2026 = new Date(Date.UTC(2026, 3, 15));
    const prisma = buildPrismaMock({
      trips: [
        mkTrip(apr2025, { revenue: 10_000 }),
        mkTrip(apr2026, { revenue: 13_000 }),
      ],
    });
    const svc = new SeasonalityService(prisma);
    await svc.recomputeForTenant('tenant-x');

    const all = await (prisma as any).seasonalAggregate.findMany();
    const apr2026Row = all.find((a: any) =>
      a.periodType === 'MONTH' && a.periodKey === '2026-04' && a.routeId === null,
    );
    expect(apr2026Row).toBeDefined();
    expect(apr2026Row.vsLastYearPct).not.toBeNull();
    expect(apr2026Row.vsLastYearPct).toBeCloseTo(30, 0); // (13k-10k)/10k = +30%
  });

  it('[sécurité] filtre par tenantId à chaque requête', async () => {
    const prisma = buildPrismaMock({ trips: [] });
    const svc = new SeasonalityService(prisma);
    await svc.recomputeForTenant('tenant-abc');
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-abc' }) }),
    );
    expect(prisma.seasonalAggregate.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-abc' }) }),
    );
  });
});
