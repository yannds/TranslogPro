import { AnalyticsService } from '../../../src/modules/analytics/analytics.service';

/**
 * Unit tests AnalyticsService.getFleetSummary (Sprint 5 — synthèse flotte).
 *
 * Vérifie : groupage par statut (actif/maintenance/offline), calcul util 7j,
 * filtre sous-utilisés selon seuil tenant, scope tenantId strict.
 */
describe('AnalyticsService.getFleetSummary', () => {
  let prismaMock: any;
  let service:    AnalyticsService;

  const buildMocks = (overrides: Partial<any> = {}) => ({
    bus: {
      count: jest.fn()
        .mockResolvedValueOnce(overrides.total       ?? 10)  // total
        .mockResolvedValueOnce(overrides.active      ?? 7)   // active
        .mockResolvedValueOnce(overrides.maintenance ?? 2)   // maintenance
        .mockResolvedValueOnce(overrides.offline     ?? 1),  // closed
      findMany: jest.fn().mockResolvedValue(overrides.buses ?? []),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(overrides.config ?? { anomalyFillRateFloor: 0.4 }),
    },
  });

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new AnalyticsService(prismaMock);
  });

  it('agrège total + byStatus', async () => {
    const res = await service.getFleetSummary('tenant-a');
    expect(res.total).toBe(10);
    expect(res.byStatus).toEqual({ active: 7, maintenance: 2, offline: 1 });
  });

  it('filtre tenantId strict sur toutes les requêtes (isolation)', async () => {
    await service.getFleetSummary('tenant-a');
    for (const call of prismaMock.bus.count.mock.calls) {
      expect(call[0].where.tenantId).toBe('tenant-a');
    }
    expect(prismaMock.bus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });

  it('applique agencyScope quand agencyId fourni', async () => {
    await service.getFleetSummary('tenant-a', 'ag-1');
    const findCall = prismaMock.bus.findMany.mock.calls[0][0];
    expect(findCall.where.agencyId).toBe('ag-1');
  });

  it('calcule utilization 7d = totalBoarded / (capacity * trips)', async () => {
    const buses = [
      {
        id: 'b1', plateNumber: 'B-001', model: 'Mercedes', capacity: 50,
        trips: [
          { id: 't1', travelers: [...Array(20)].map((_, i) => ({ id: `p${i}` })) },
          { id: 't2', travelers: [...Array(30)].map((_, i) => ({ id: `q${i}` })) },
        ],
      },
    ];
    prismaMock = buildMocks({ buses });
    service = new AnalyticsService(prismaMock);

    const res = await service.getFleetSummary('tenant-a');
    // 50 / (50*2) = 0.5
    expect(res.underutilized).toHaveLength(0); // 0.5 >= 0.4 (pas sous-utilisé)
  });

  it('liste sous-utilisés < seuil', async () => {
    const buses = [
      { id: 'b1', plateNumber: 'A-001', model: 'MB', capacity: 50,
        trips: [{ id: 't1', travelers: [...Array(5)].map(() => ({ id: 'p' })) }] }, // 5/50 = 10%
      { id: 'b2', plateNumber: 'A-002', model: 'MB', capacity: 50,
        trips: [{ id: 't2', travelers: [...Array(45)].map(() => ({ id: 'p' })) }] }, // 45/50 = 90%
    ];
    prismaMock = buildMocks({ buses });
    service = new AnalyticsService(prismaMock);

    const res = await service.getFleetSummary('tenant-a');
    expect(res.underutilized).toHaveLength(1);
    expect(res.underutilized[0].plateNumber).toBe('A-001');
    expect(res.underutilized[0].utilization7d).toBe(0.1);
  });

  it('ignore les bus sans trip sur 7j (pas sous-utilisés par défaut)', async () => {
    const buses = [
      { id: 'b1', plateNumber: 'A-001', model: 'MB', capacity: 50, trips: [] },
    ];
    prismaMock = buildMocks({ buses });
    service = new AnalyticsService(prismaMock);

    const res = await service.getFleetSummary('tenant-a');
    expect(res.underutilized).toEqual([]);
  });

  it('tri underutilized par utilization croissante (pire en premier)', async () => {
    const buses = [
      { id: 'b1', plateNumber: 'MEDIUM', model: 'MB', capacity: 50,
        trips: [{ id: 't', travelers: [...Array(10)].map(() => ({ id: 'p' })) }] }, // 20%
      { id: 'b2', plateNumber: 'WORST',  model: 'MB', capacity: 50,
        trips: [{ id: 't', travelers: [...Array(2)].map(() => ({ id: 'p' })) }] },  // 4%
    ];
    prismaMock = buildMocks({ buses });
    service = new AnalyticsService(prismaMock);

    const res = await service.getFleetSummary('tenant-a');
    expect(res.underutilized[0].plateNumber).toBe('WORST');
    expect(res.underutilized[1].plateNumber).toBe('MEDIUM');
  });

  it('limite à 5 bus sous-utilisés (pas de flood)', async () => {
    const buses = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`, plateNumber: `B-${i}`, model: 'MB', capacity: 50,
      trips: [{ id: 't', travelers: [] }], // 0% tous
    }));
    prismaMock = buildMocks({ buses });
    service = new AnalyticsService(prismaMock);

    const res = await service.getFleetSummary('tenant-a');
    expect(res.underutilized).toHaveLength(5);
  });
});
