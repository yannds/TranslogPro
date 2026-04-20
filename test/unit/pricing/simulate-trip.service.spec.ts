import { ProfitabilityService } from '../../../src/modules/pricing/profitability.service';

/**
 * Tests unitaires ProfitabilityService.simulateTrip (Sprint 11.A).
 *
 * Prisma mocké. Vérifie : calcul marge, tag PROFITABLE/BREAK_EVEN/DEFICIT,
 * break-even price/fillRate, profitable price/fillRate, isolation tenantId.
 * Configs tenant respectées (breakEvenThresholdPct, agencyCommissionRate).
 */
describe('ProfitabilityService.simulateTrip', () => {
  let prismaMock: any;
  let service:    ProfitabilityService;

  // Profile de coûts : trip 500 km, coût fixe + variable → totalCost déterministe
  const COST_PROFILE = {
    fuelConsumptionPer100Km: 30,
    fuelPricePerLiter:       1.5,      // 150 * 1.5 = 225 → fuel
    adBlueCostPerLiter:      0.18,
    adBlueRatioFuel:         0.05,
    maintenanceCostPerKm:    0.05,     // 500 × 0.05 = 25
    stationFeePerDeparture:  0,
    driverAllowancePerTrip:  0,
    tollFeesPerTrip:         0,
    driverMonthlySalary:     300_000,
    annualInsuranceCost:     1_200_000,
    monthlyAgencyFees:       0,
    purchasePrice:           10_000_000,
    depreciationYears:       10,
    residualValue:           0,
    avgTripsPerMonth:        30,
  };

  const buildMocks = (overrides: Partial<any> = {}) => ({
    route: {
      findFirst: jest.fn().mockResolvedValue('route' in overrides ? overrides.route : {
        id: 'route-a', tenantId: 'tenant-a',
        distanceKm: 500, basePrice: 15_000,
      }),
    },
    bus: {
      findFirst: jest.fn().mockResolvedValue('bus' in overrides ? overrides.bus : {
        id: 'bus-a', tenantId: 'tenant-a', capacity: 50,
        costProfile: COST_PROFILE,
      }),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue('config' in overrides ? overrides.config : {
        daysPerYear:           365,
        breakEvenThresholdPct: 0.05,
        agencyCommissionRate:  0.03,
      }),
    },
  });

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new ProfitabilityService(prismaMock);
  });

  it('renvoie un diagnostic avec coûts + projections + recommandations', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: 0.7,
    });

    expect(res.costs.totalCost).toBeGreaterThan(0);
    expect(res.projected.totalSeats).toBe(50);
    expect(res.projected.bookedSeats).toBe(35);
    expect(res.projected.ticketRevenue).toBe(15_000 * 35);
    expect(['PROFITABLE', 'BREAK_EVEN', 'DEFICIT']).toContain(res.projected.profitabilityTag);
    expect(typeof res.recommendations.primaryMessage).toBe('string');
  });

  it('DEFICIT quand prix trop bas au fillRate fourni', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 100, fillRate: 0.1,
    });
    expect(res.projected.profitabilityTag).toBe('DEFICIT');
    expect(res.recommendations.breakEvenPriceAtFillRate).toBeGreaterThan(100);
    expect(res.recommendations.primaryMessage).toContain('DÉFICIT');
  });

  it('PROFITABLE quand prix + fillRate élevés', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 50_000, fillRate: 0.95,
    });
    expect(res.projected.profitabilityTag).toBe('PROFITABLE');
    expect(res.recommendations.primaryMessage).toContain('RENTABLE');
  });

  it('breakEvenPriceAtFillRate est le prix minimum pour couvrir les coûts', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: 0.8,
    });
    // Applique ce breakEvenPrice exactement → tag doit passer proche de BREAK_EVEN
    const bePrice = res.recommendations.breakEvenPriceAtFillRate!;
    const res2 = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: bePrice, fillRate: 0.8,
    });
    // Au prix de break-even, la marge nette doit être proche de 0 (petite surmarge via ceil)
    expect(res2.projected.netMargin).toBeGreaterThanOrEqual(0);
    expect(res2.projected.netMargin).toBeLessThan(res2.costs.totalCost * 0.1);
  });

  it('breakEvenFillRateAtPrice est le remplissage minimum au prix fourni', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: 0.3, // trop peu
    });
    const beFill = res.recommendations.breakEvenFillRateAtPrice!;
    expect(beFill).toBeGreaterThan(0);
    expect(beFill).toBeLessThanOrEqual(1);
    // À ce fillRate, la marge nette doit être ≥ 0 (ou très proche)
    const res2 = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: beFill,
    });
    expect(res2.projected.netMargin).toBeGreaterThanOrEqual(-100); // tolérance arrondi
  });

  it('applique fillRate par défaut 0.7 si omis', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000,
    });
    expect(res.projected.fillRate).toBe(0.7);
    expect(res.projected.bookedSeats).toBe(35);
  });

  it('applique ticketPrice = route.basePrice si omis', async () => {
    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      fillRate: 0.5,
    });
    expect(res.projected.ticketPrice).toBe(15_000);
  });

  it('clamp fillRate entre 0 et 1', async () => {
    const res1 = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: 2, // out of range
    });
    expect(res1.projected.fillRate).toBe(1);

    const res2 = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: -0.5,
    });
    expect(res2.projected.fillRate).toBe(0);
  });

  it('rejette si route ou bus introuvable (cross-tenant protection)', async () => {
    prismaMock = buildMocks({ route: null });
    service = new ProfitabilityService(prismaMock);

    await expect(service.simulateTrip('tenant-a', {
      routeId: 'route-x', busId: 'bus-a', ticketPrice: 15_000,
    })).rejects.toThrow(/route/i);
  });

  it('rejette si bus.costProfile absent (prérequis métier)', async () => {
    prismaMock = buildMocks({ bus: { id: 'bus-a', tenantId: 'tenant-a', capacity: 50, costProfile: null } });
    service = new ProfitabilityService(prismaMock);

    await expect(service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a', ticketPrice: 15_000,
    })).rejects.toThrow(/profil de coûts/i);
  });

  it('[security] filtre toujours par tenantId', async () => {
    await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a', ticketPrice: 15_000,
    });
    expect(prismaMock.route.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
    expect(prismaMock.bus.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });

  it('respecte breakEvenThresholdPct custom (zéro magic number)', async () => {
    prismaMock = buildMocks({
      config: { daysPerYear: 365, breakEvenThresholdPct: 0.20, agencyCommissionRate: 0.03 },
    });
    service = new ProfitabilityService(prismaMock);

    const res = await service.simulateTrip('tenant-a', {
      routeId: 'route-a', busId: 'bus-a',
      ticketPrice: 15_000, fillRate: 0.7,
    });
    expect(res.thresholds.breakEvenThresholdPct).toBe(0.20);
    expect(res.recommendations.profitabilityThresholdPct).toBe(0.20);
  });
});
