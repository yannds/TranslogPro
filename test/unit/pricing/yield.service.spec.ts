import { YieldService } from '../../../src/modules/pricing/yield.service';

/**
 * Tests unitaires YieldService (Sprint 8) — couvre les 4 règles + NO_CHANGE.
 *
 * Règles :
 *   A. GOLDEN_DAY  → prix × (1 + goldenDayMultiplier)
 *   B. BLACK_ROUTE → remonte au break-even (dernier snapshot)
 *   C. LOW_FILL    → -10% si fillRate < seuil ET ≤48h avant départ
 *   D. HIGH_FILL   → +10% si fillRate ≥ 80%
 *   E. NO_CHANGE   → module désactivé OU aucune règle ne matche
 *
 * Bornes : prix clampé [basePrice × 0.7, basePrice × 2.0].
 */

/** Mock PeakPeriodService — neutre par défaut (pas de peak actif). */
const peakPeriodMock: any = {
  resolveDemandFactor: jest.fn().mockResolvedValue({ factor: 1, periods: [] }),
  findActiveForDate:   jest.fn().mockResolvedValue([]),
};

/** Mock PlatformConfigService — retourne les defaults historiques du registry. */
const platformConfigMock: any = {
  getNumber: jest.fn(async (key: string) => {
    const defaults: Record<string, number> = {
      'yield.defaults.goldenDayMultiplier':          0.15,
      'yield.defaults.lowFillThreshold':             0.40,
      'yield.defaults.lowFillDiscount':              0.10,
      'yield.defaults.highFillThreshold':            0.80,
      'yield.defaults.highFillPremium':              0.10,
      'yield.defaults.priceFloorRate':               0.70,
      'yield.defaults.priceCeilingRate':             2.00,
      'yield.defaults.goldenDayFillThreshold':       0.85,
      'yield.defaults.blackRouteDeficitRatio':       0.50,
      'yield.defaults.analyticsWindowDays':          90,
      'yield.defaults.lowFillTriggerHoursBeforeDeparture': 48,
    };
    return defaults[key] ?? 0;
  }),
};

describe('YieldService.calculateSuggestedPrice', () => {
  let prismaMock: any;
  let service:    YieldService;

  const buildMocks = (overrides: Partial<any> = {}) => ({
    installedModule: {
      findFirst: jest.fn().mockResolvedValue(overrides.module ?? { isActive: true, config: {} }),
    },
    trip: {
      findFirst: jest.fn().mockResolvedValue(overrides.trip ?? null),
    },
    ticket: {
      count: jest.fn().mockResolvedValue(overrides.bookedSeats ?? 0),
    },
    tripAnalytics: {
      findFirst: jest.fn().mockResolvedValue(overrides.analytics ?? null),
    },
    tripCostSnapshot: {
      findFirst: jest.fn().mockResolvedValue(overrides.snapshot ?? null),
    },
  });

  const mkTrip = (opts: { basePrice?: number; capacity?: number; inHours?: number } = {}) => ({
    id: 'trip-1',
    routeId: 'route-1',
    departureScheduled: new Date(Date.now() + (opts.inHours ?? 72) * 3_600_000),
    route: { basePrice: opts.basePrice ?? 10_000 },
    bus:   { capacity: opts.capacity ?? 50 },
  });

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);
  });

  it('NO_CHANGE si module YIELD_ENGINE inactif', async () => {
    prismaMock = buildMocks({ module: null });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('NO_CHANGE');
    expect(res.yieldActive).toBe(false);
  });

  it('NO_CHANGE si trip introuvable', async () => {
    prismaMock = buildMocks({ trip: null });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-x');
    expect(res.rule).toBe('NO_CHANGE');
  });

  it('GOLDEN_DAY : +15% par défaut si isGoldenDay=true', async () => {
    prismaMock = buildMocks({
      trip:      mkTrip({ basePrice: 10_000 }),
      analytics: { isGoldenDay: true, isBlackRoute: false },
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('GOLDEN_DAY');
    expect(res.suggestedPrice).toBe(11_500);
    expect(res.deltaPercent).toBe(15);
  });

  it('BLACK_ROUTE : remonte au break-even si snapshot dispo', async () => {
    prismaMock = buildMocks({
      trip:      mkTrip({ basePrice: 10_000 }),
      analytics: { isGoldenDay: false, isBlackRoute: true },
      snapshot:  { breakEvenSeats: 30, bookedSeats: 20, totalCost: 240_000 },
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('BLACK_ROUTE');
    // breakEvenPrice = 240000/20 = 12000, clamp [7000, 20000] → 12000
    expect(res.suggestedPrice).toBe(12_000);
  });

  it('LOW_FILL : -10% si remplissage < 40% ET ≤48h avant départ', async () => {
    prismaMock = buildMocks({
      trip:        mkTrip({ basePrice: 10_000, capacity: 50, inHours: 24 }),
      bookedSeats: 10, // fillRate = 0.2 < 0.4
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('LOW_FILL');
    expect(res.suggestedPrice).toBe(9_000);
    expect(res.deltaPercent).toBe(-10);
  });

  it("LOW_FILL ne s'applique pas si départ >48h", async () => {
    prismaMock = buildMocks({
      trip:        mkTrip({ basePrice: 10_000, capacity: 50, inHours: 72 }),
      bookedSeats: 10,
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('NO_CHANGE');
  });

  it('HIGH_FILL : +10% si remplissage ≥ 80%', async () => {
    prismaMock = buildMocks({
      trip:        mkTrip({ basePrice: 10_000, capacity: 50, inHours: 72 }),
      bookedSeats: 42, // fillRate = 0.84
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('HIGH_FILL');
    expect(res.suggestedPrice).toBe(11_000);
  });

  it('NO_CHANGE quand aucune règle ne matche (fillRate moyen, pas golden, pas black)', async () => {
    prismaMock = buildMocks({
      trip:        mkTrip({ basePrice: 10_000, capacity: 50, inHours: 72 }),
      bookedSeats: 25, // fillRate = 0.5
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('NO_CHANGE');
    expect(res.suggestedPrice).toBe(10_000);
  });

  it('applique la config custom du tenant (zéro magic number)', async () => {
    prismaMock = buildMocks({
      module: { isActive: true, config: { highFillPremium: 0.25, highFillThreshold: 0.6 } },
      trip:   mkTrip({ basePrice: 10_000, capacity: 50, inHours: 72 }),
      bookedSeats: 35, // fillRate = 0.7 ≥ 0.6
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.rule).toBe('HIGH_FILL');
    expect(res.suggestedPrice).toBe(12_500); // +25%
  });

  it('respecte les bornes [floor, ceiling]', async () => {
    // Config extrême : goldenDay +500% mais ceiling cap à ×2
    prismaMock = buildMocks({
      module: { isActive: true, config: { goldenDayMultiplier: 5, priceCeilingRate: 2 } },
      trip:   mkTrip({ basePrice: 10_000 }),
      analytics: { isGoldenDay: true, isBlackRoute: false },
    });
    service = new YieldService(prismaMock, platformConfigMock, peakPeriodMock);

    const res = await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(res.suggestedPrice).toBe(20_000); // clamped to 10000 * 2
  });

  it('[security] filtre toujours par tenantId', async () => {
    await service.calculateSuggestedPrice('tenant-a', 'trip-1');
    expect(prismaMock.installedModule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });
});
