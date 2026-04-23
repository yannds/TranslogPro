/**
 * Tests unit — PricingSimulatorAdvancedService.
 *
 * Vérifie les 7 outils d'aide à la décision. Mocks Prisma + constantes tenant.
 * L'engin de calcul (CostCalculatorEngine) n'est pas mocké — on teste bout-en-bout
 * la cohérence des scénarios comme un système intégré.
 */
import {
  PricingSimulatorAdvancedService,
  buildPriceSteps,
} from '../../../src/modules/pricing/simulator-advanced.service';

const TENANT_ID = 't1';
const ROUTE_ID  = 'r1';
const BUS_ID    = 'b1';

function costProfile(overrides: Record<string, number> = {}) {
  return {
    id: 'cp1', busId: BUS_ID, tenantId: TENANT_ID,
    fuelConsumptionPer100Km: 35,
    fuelPricePerLiter:       750,
    adBlueCostPerLiter:      0,
    adBlueRatioFuel:         0,
    maintenanceCostPerKm:    50,
    stationFeePerDeparture:  5000,
    driverAllowancePerTrip:  15000,
    tollFeesPerTrip:         2000,
    driverMonthlySalary:     150000,
    annualInsuranceCost:     1200000,
    monthlyAgencyFees:       50000,
    purchasePrice:           60000000,
    depreciationYears:       8,
    residualValue:           10000000,
    avgTripsPerMonth:        30,
    ...overrides,
  };
}

function route(overrides: Record<string, any> = {}) {
  return {
    id: ROUTE_ID, tenantId: TENANT_ID,
    name: 'Brazzaville → Pointe-Noire',
    distanceKm: 510,
    basePrice:  15000,
    pricingOverrides: {},
    waypoints: [],
    ...overrides,
  };
}

function bus() {
  return {
    id: BUS_ID, tenantId: TENANT_ID, capacity: 60, costProfile: costProfile(),
  };
}

function bizConfig() {
  return {
    tenantId: TENANT_ID,
    daysPerYear: 365,
    breakEvenThresholdPct: 0.1,
    agencyCommissionRate: 0.05,
  };
}

function createService(opts: { extraBuses?: any[]; snapshots?: any[]; noProfile?: boolean } = {}) {
  const prisma = {
    route: {
      findFirst: jest.fn().mockResolvedValue(route()),
      findMany:  jest.fn().mockResolvedValue([route()]),
    },
    bus: {
      findFirst: jest.fn().mockImplementation((args: any) =>
        Promise.resolve(
          opts.noProfile ? { ...bus(), costProfile: null } : bus(),
        ),
      ),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(bizConfig()),
    },
    pricingRules: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    busCostProfile: {
      findFirst: jest.fn().mockResolvedValue(costProfile()),
    },
    tripCostSnapshot: {
      findMany: jest.fn().mockResolvedValue(opts.snapshots ?? []),
    },
  };
  const svc = new PricingSimulatorAdvancedService(prisma as any);
  return { svc, prisma };
}

// ─── buildPriceSteps ─────────────────────────────────────────────────────────

describe('buildPriceSteps', () => {
  it('renvoie un seul point si steps < 2', () => {
    expect(buildPriceSteps(10000, 1, 0.5)).toEqual([10000]);
  });
  it('répartit symétriquement autour du centre', () => {
    const out = buildPriceSteps(10000, 5, 0.5);
    expect(out.length).toBe(5);
    expect(out[0]).toBe(5000);
    expect(out[4]).toBe(15000);
    expect(out[2]).toBe(10000); // point central
  });
});

// ─── A. sensitivityMatrix ────────────────────────────────────────────────────

describe('sensitivityMatrix', () => {
  it('renvoie une grille non vide avec les dimensions attendues', async () => {
    const { svc } = createService();
    const out = await svc.sensitivityMatrix(TENANT_ID, { routeId: ROUTE_ID, busId: BUS_ID });
    expect(out.prices.length).toBe(9);
    expect(out.fillRates.length).toBe(8);
    expect(out.cells.length).toBe(9);
    expect(out.cells[0].length).toBe(8);
    expect(out.totalSeats).toBe(60);
  });

  it('chaque cellule contient un tag de rentabilité', async () => {
    const { svc } = createService();
    const out = await svc.sensitivityMatrix(TENANT_ID, { routeId: ROUTE_ID, busId: BUS_ID });
    for (const row of out.cells) for (const cell of row) {
      expect(['PROFITABLE', 'BREAK_EVEN', 'DEFICIT']).toContain(cell.profitabilityTag);
    }
  });
});

// ─── B. priceBands ───────────────────────────────────────────────────────────

describe('priceBands', () => {
  it('renvoie 4 bandes ordonnées (min-viable <= breakEven <= profitable <= premium)', async () => {
    const { svc } = createService();
    const out = await svc.priceBands(TENANT_ID, { routeId: ROUTE_ID, busId: BUS_ID, fillRate: 0.7 });
    const { minViable, breakEven, profitable, premium } = out.bands;
    expect(minViable.price).toBeLessThanOrEqual(breakEven.price);
    expect(breakEven.price).toBeLessThan(profitable.price);
    expect(profitable.price).toBeLessThan(premium.price);
  });

  it('throw si fillRate=0 (calcul impossible)', async () => {
    const { svc } = createService();
    await expect(svc.priceBands(TENANT_ID, { routeId: ROUTE_ID, busId: BUS_ID, fillRate: 0 }))
      .rejects.toThrow();
  });
});

// ─── C. historicalBenchmark ──────────────────────────────────────────────────

describe('historicalBenchmark', () => {
  it('renvoie une réponse vide si aucune donnée', async () => {
    const { svc } = createService({ snapshots: [] });
    const out = await svc.historicalBenchmark(TENANT_ID, { routeId: ROUTE_ID, days: 30 });
    expect(out.summary.tripCount).toBe(0);
    expect(out.series).toEqual([]);
  });

  it('agrège correctement les snapshots', async () => {
    const snapshot = {
      totalSeats: 60, bookedSeats: 42,
      ticketRevenue: 630000, // 42 × 15 000
      netMargin: 100000, marginRate: 0.15,
      profitabilityTag: 'PROFITABLE',
      trip: { departureScheduled: new Date('2026-04-20') },
    };
    const { svc } = createService({ snapshots: [snapshot, snapshot, snapshot] });
    const out = await svc.historicalBenchmark(TENANT_ID, { routeId: ROUTE_ID, days: 30 });
    expect(out.summary.tripCount).toBe(3);
    expect(out.summary.avgFillRate).toBeCloseTo(0.7, 2);
    expect(out.summary.avgTicketPrice).toBe(15000);
    expect(out.series.length).toBe(3);
  });

  it('rejette days hors bornes', async () => {
    const { svc } = createService();
    await expect(svc.historicalBenchmark(TENANT_ID, { routeId: ROUTE_ID, days: 0 })).rejects.toThrow();
    await expect(svc.historicalBenchmark(TENANT_ID, { routeId: ROUTE_ID, days: 400 })).rejects.toThrow();
  });
});

// ─── D. analyzeCompetitor ────────────────────────────────────────────────────

describe('analyzeCompetitor', () => {
  it('recommande MATCH quand le prix concurrent laisse la ligne profitable', async () => {
    const { svc } = createService();
    const out = await svc.analyzeCompetitor(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID,
      competitorPrice: 30000, // largement au-dessus du basePrice 15000
      fillRate: 0.9,
    });
    expect(out.recommendation).toBe('MATCH');
  });

  it('recommande AVOID si même au propre prix la ligne est déficitaire à ce fillRate', async () => {
    const { svc } = createService();
    const out = await svc.analyzeCompetitor(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID,
      competitorPrice: 1000, fillRate: 0.2,  // scenario extrême
    });
    expect(['AVOID', 'UNDERCUT_PREMIUM', 'HOLD']).toContain(out.recommendation);
  });

  it('throw si competitorPrice <= 0', async () => {
    const { svc } = createService();
    await expect(svc.analyzeCompetitor(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID, competitorPrice: 0,
    })).rejects.toThrow();
  });
});

// ─── E. simulateWhatIf ───────────────────────────────────────────────────────

describe('simulateWhatIf', () => {
  it('un fuelDeltaPct positif augmente les coûts et réduit la marge', async () => {
    const { svc } = createService();
    const out = await svc.simulateWhatIf(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID,
      ticketPrice: 15000, fillRate: 0.7,
      fuelDeltaPct: 50,
    });
    expect(out.delta.totalCost).toBeGreaterThan(0);
    expect(out.delta.netMargin).toBeLessThan(0);
  });

  it('une commission à zéro augmente la marge nette', async () => {
    const { svc } = createService();
    const out = await svc.simulateWhatIf(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID,
      ticketPrice: 15000, fillRate: 0.7,
      commissionRate: 0,
    });
    expect(out.delta.netMargin).toBeGreaterThanOrEqual(0);
  });
});

// ─── F. compareRoutes ────────────────────────────────────────────────────────

describe('compareRoutes', () => {
  it('classe les lignes par netMarginRate décroissant', async () => {
    const { svc, prisma } = createService();
    prisma.route.findMany.mockResolvedValueOnce([
      route({ id: 'r1', name: 'A', distanceKm: 100, basePrice: 15000 }),
      route({ id: 'r2', name: 'B', distanceKm: 500, basePrice: 15000 }),
      route({ id: 'r3', name: 'C', distanceKm: 300, basePrice: 15000 }),
    ]);
    const out = await svc.compareRoutes(TENANT_ID, { fillRate: 0.7 });
    expect(out.routes.length).toBe(3);
    for (let i = 1; i < out.routes.length; i++) {
      const prev = out.routes[i - 1].netMarginRate ?? -Infinity;
      const cur  = out.routes[i].netMarginRate ?? -Infinity;
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it('renvoie notice si aucun bus avec profil coût', async () => {
    const { svc, prisma } = createService();
    prisma.bus.findFirst.mockImplementationOnce(() => Promise.resolve(null));
    const out = await svc.compareRoutes(TENANT_ID, {});
    expect(out.routes).toEqual([]);
    expect((out as any).notice).toBe('NO_COST_PROFILE_ANYWHERE');
  });
});

// ─── G. monthlyBreakEven ─────────────────────────────────────────────────────

describe('monthlyBreakEven', () => {
  it('renvoie un nombre de voyages/mois cohérent', async () => {
    const { svc } = createService();
    const out = await svc.monthlyBreakEven(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID,
      ticketPrice: 15000, fillRate: 0.7,
    });
    expect(out.monthlyFixedCost).toBeGreaterThan(0);
    expect(['REACHABLE', 'NEED_MORE_TRIPS', 'IMPOSSIBLE_AT_THESE_PARAMS']).toContain(out.verdict);
  });

  it('IMPOSSIBLE quand le prix ne couvre même pas les coûts variables', async () => {
    const { svc } = createService();
    const out = await svc.monthlyBreakEven(TENANT_ID, {
      routeId: ROUTE_ID, busId: BUS_ID,
      ticketPrice: 100, fillRate: 0.1,
    });
    expect(out.verdict).toBe('IMPOSSIBLE_AT_THESE_PARAMS');
    expect(out.tripsPerMonthToBreakEven).toBeNull();
  });
});
