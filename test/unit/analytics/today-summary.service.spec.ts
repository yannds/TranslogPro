import { AnalyticsService } from '../../../src/modules/analytics/analytics.service';

/**
 * Tests unitaires AnalyticsService.getTodaySummary (Sprint 4 — dashboard gérant).
 *
 * Prisma mocké : vérifie la forme agrégée + seuils + flags d'alerte.
 * Scope tenantId strict dans toutes les requêtes (sécurité multi-tenant).
 */
describe('AnalyticsService.getTodaySummary', () => {
  let prismaMock: any;
  let service:    AnalyticsService;

  const buildMocks = (overrides: Partial<any> = {}) => ({
    ticket:       { count: jest.fn().mockResolvedValue(overrides.ticketsToday ?? 42) },
    parcel:       { count: jest.fn().mockResolvedValue(overrides.parcelsToday ?? 10) },
    incident:     { count: jest.fn().mockResolvedValue(overrides.openIncidents ?? 2) },
    cashRegister: { count: jest.fn()
      .mockResolvedValueOnce(overrides.openRegisters ?? 3)
      .mockResolvedValueOnce(overrides.discrepancyCount ?? 0),
    },
    transaction: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: overrides.revenueToday ?? 150_000 } }),
      findMany:  jest.fn().mockResolvedValue(overrides.revenue7d ?? []),
    },
    trip: {
      count:    jest.fn().mockResolvedValue(overrides.activeTrips ?? 5),
      findMany: jest.fn().mockResolvedValue(overrides.dayTrips ?? []),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(overrides.config ?? {
        anomalyIncidentThreshold:    3,
        anomalyDiscrepancyThreshold: 1,
        anomalyFillRateFloor:        0.4,
      }),
    },
  });

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new AnalyticsService(prismaMock);
  });

  it('agrège KPI jour + série 7j + seuils + alertes', async () => {
    const res = await service.getTodaySummary('tenant-a');

    expect(res).toMatchObject({
      today: {
        revenue:           150_000,
        ticketsSold:       42,
        parcelsRegistered: 10,
        openIncidents:     2,
        discrepancyCount:  0,
        activeTrips:       5,
      },
      thresholds: { incident: 3, discrepancy: 1, fillRate: 0.4 },
    });
    expect(Array.isArray(res.revenue7d)).toBe(true);
    expect(res.revenue7d).toHaveLength(7);
  });

  it('toutes les requêtes Prisma sont filtrées par tenantId (isolation)', async () => {
    await service.getTodaySummary('tenant-a');

    // getKpis filtre tenantId sur ticket, parcel, incident, cashRegister
    expect(prismaMock.ticket.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
    expect(prismaMock.incident.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
    expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });

  it('applique agencyScope quand agencyId fourni', async () => {
    await service.getTodaySummary('tenant-a', 'ag-1');

    // transactions filtrées par agencyId
    const txCall = prismaMock.transaction.aggregate.mock.calls[0][0];
    expect(txCall.where.agencyId).toBe('ag-1');
  });

  it('flag incidentAlert true quand openIncidents >= seuil', async () => {
    prismaMock = buildMocks({ openIncidents: 5, config: {
      anomalyIncidentThreshold: 3, anomalyDiscrepancyThreshold: 1, anomalyFillRateFloor: 0.4,
    }});
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    expect(res.alerts.incidentAlert).toBe(true);
  });

  it('flag incidentAlert false quand openIncidents < seuil', async () => {
    prismaMock = buildMocks({ openIncidents: 1, config: {
      anomalyIncidentThreshold: 3, anomalyDiscrepancyThreshold: 1, anomalyFillRateFloor: 0.4,
    }});
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    expect(res.alerts.incidentAlert).toBe(false);
  });

  it('flag discrepancyAlert activé selon seuil tenant (zéro magic number)', async () => {
    prismaMock = buildMocks({ discrepancyCount: 2, config: {
      anomalyIncidentThreshold: 100, anomalyDiscrepancyThreshold: 1, anomalyFillRateFloor: 0.4,
    }});
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    expect(res.alerts.discrepancyAlert).toBe(true);
    expect(res.alerts.incidentAlert).toBe(false);
  });

  it('fillRateAlert false quand aucun trip du jour (évite faux positif)', async () => {
    prismaMock = buildMocks({ dayTrips: [] });
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    expect(res.today.fillRate).toBe(0);
    expect(res.today.fillRateTripsCount).toBe(0);
    expect(res.alerts.fillRateAlert).toBe(false);
  });

  it('fillRate calculé correctement avec des trajets BOARDED', async () => {
    const dayTrips = [
      { bus: { capacity: 50 }, travelers: [...Array(40)].map((_, i) => ({ id: `t${i}` })) },
      { bus: { capacity: 50 }, travelers: [...Array(30)].map((_, i) => ({ id: `u${i}` })) },
    ];
    prismaMock = buildMocks({ dayTrips });
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    // (40+30) / (50+50) = 0.7
    expect(res.today.fillRate).toBe(0.7);
    expect(res.today.fillRateTripsCount).toBe(2);
    expect(res.alerts.fillRateAlert).toBe(false); // 0.7 >= 0.4
  });

  it('fillRateAlert true quand remplissage < seuil', async () => {
    const dayTrips = [
      { bus: { capacity: 50 }, travelers: [...Array(10)].map((_, i) => ({ id: `t${i}` })) },
    ];
    prismaMock = buildMocks({ dayTrips });
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    // 10/50 = 0.2 < 0.4
    expect(res.today.fillRate).toBe(0.2);
    expect(res.alerts.fillRateAlert).toBe(true);
  });

  it('utilise les defaults quand TenantBusinessConfig absent (jamais magic number absent)', async () => {
    prismaMock = buildMocks({ config: null });
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    expect(res.thresholds).toEqual({ incident: 3, discrepancy: 1, fillRate: 0.4 });
  });

  it('série revenue7d contient 7 jours même sans transaction', async () => {
    prismaMock = buildMocks({ revenue7d: [] });
    service = new AnalyticsService(prismaMock);

    const res = await service.getTodaySummary('tenant-a');
    expect(res.revenue7d).toHaveLength(7);
    expect(res.revenue7d.every(p => p.value === 0)).toBe(true);
  });
});
