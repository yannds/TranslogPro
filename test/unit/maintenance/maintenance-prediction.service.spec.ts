import { MaintenancePredictionService } from '../../../src/modules/garage/maintenance-prediction.service';

/**
 * Tests unitaires MaintenancePredictionService (Sprint 7).
 *
 * Prisma mocké. Vérifie calcul prochaine échéance (km + jours), statut
 * DUE/SOON/OK/UNKNOWN, seuils d'anticipation lus depuis TenantBusinessConfig,
 * tri croissant par urgence, isolation tenantId.
 */
describe('MaintenancePredictionService.computeReminders', () => {
  let prismaMock: any;
  let service: MaintenancePredictionService;

  const buildMocks = (overrides: Partial<any> = {}) => ({
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(overrides.config ?? {
        maintenanceIntervals: [
          { type: 'VIDANGE', label: 'Vidange moteur', intervalKm: 10_000, intervalDays: 180 },
          { type: 'COURROIE', label: 'Courroie', intervalKm: 150_000 },
        ],
        maintenanceAnticipationKm:   500,
        maintenanceAnticipationDays: 14,
      }),
    },
    bus: {
      findMany: jest.fn().mockResolvedValue(overrides.buses ?? []),
      findFirst: jest.fn(),
    },
    maintenanceReminder: {
      upsert: jest.fn(),
    },
  });

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new MaintenancePredictionService(prismaMock);
  });

  it('retourne UNKNOWN quand aucune intervention saisie', async () => {
    prismaMock = buildMocks({
      buses: [{ id: 'b1', plateNumber: 'A-001', currentOdometerKm: 5000, maintenanceReminders: [] }],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    expect(res).toHaveLength(2); // 2 types configurés
    expect(res.every(r => r.status === 'UNKNOWN')).toBe(true);
  });

  it('calcule OK quand km restant > seuil anticipation', async () => {
    prismaMock = buildMocks({
      buses: [{
        id: 'b1', plateNumber: 'A-001', currentOdometerKm: 5_000,
        maintenanceReminders: [
          { type: 'VIDANGE', label: 'Vidange', lastPerformedKm: 0, lastPerformedDate: new Date() },
        ],
      }],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    const vidange = res.find(r => r.type === 'VIDANGE');
    expect(vidange?.dueAtKm).toBe(10_000);
    expect(vidange?.kmRemaining).toBe(5_000);
    expect(vidange?.status).toBe('OK');
  });

  it('calcule SOON quand km restant <= seuil anticipation (500 défaut)', async () => {
    prismaMock = buildMocks({
      buses: [{
        id: 'b1', plateNumber: 'A-001', currentOdometerKm: 9_700,
        maintenanceReminders: [
          { type: 'VIDANGE', label: 'Vidange', lastPerformedKm: 0, lastPerformedDate: new Date() },
        ],
      }],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    const vidange = res.find(r => r.type === 'VIDANGE');
    expect(vidange?.kmRemaining).toBe(300);
    expect(vidange?.status).toBe('SOON');
  });

  it('calcule DUE quand km restant <= 0', async () => {
    prismaMock = buildMocks({
      buses: [{
        id: 'b1', plateNumber: 'A-001', currentOdometerKm: 11_000,
        maintenanceReminders: [
          { type: 'VIDANGE', label: 'Vidange', lastPerformedKm: 0, lastPerformedDate: new Date() },
        ],
      }],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    const vidange = res.find(r => r.type === 'VIDANGE');
    expect(vidange?.kmRemaining).toBe(-1_000);
    expect(vidange?.status).toBe('DUE');
  });

  it('calcule DUE par date même si km OK', async () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 200); // > intervalDays 180

    prismaMock = buildMocks({
      buses: [{
        id: 'b1', plateNumber: 'A-001', currentOdometerKm: 1000,
        maintenanceReminders: [
          { type: 'VIDANGE', label: 'Vidange', lastPerformedKm: 0, lastPerformedDate: longAgo },
        ],
      }],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    const vidange = res.find(r => r.type === 'VIDANGE');
    expect(vidange?.daysRemaining).toBeLessThanOrEqual(0);
    expect(vidange?.status).toBe('DUE');
  });

  it('tri par urgence : DUE > SOON > OK > UNKNOWN', async () => {
    const now = new Date();
    prismaMock = buildMocks({
      buses: [
        { id: 'b1', plateNumber: 'OK-BUS',      currentOdometerKm: 100, maintenanceReminders: [
          { type: 'VIDANGE', label: 'V', lastPerformedKm: 0, lastPerformedDate: now },
        ]},
        { id: 'b2', plateNumber: 'DUE-BUS',     currentOdometerKm: 20_000, maintenanceReminders: [
          { type: 'VIDANGE', label: 'V', lastPerformedKm: 0, lastPerformedDate: now },
        ]},
        { id: 'b3', plateNumber: 'SOON-BUS',    currentOdometerKm: 9_800, maintenanceReminders: [
          { type: 'VIDANGE', label: 'V', lastPerformedKm: 0, lastPerformedDate: now },
        ]},
        { id: 'b4', plateNumber: 'UNKNOWN-BUS', currentOdometerKm: 0, maintenanceReminders: [] },
      ],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    // 2 types config × 4 bus = 8. Mais bus4 a 0 reminders → UNKNOWN × 2
    // bus1 : OK pour VIDANGE ; UNKNOWN pour COURROIE
    // bus2 : DUE pour VIDANGE ; UNKNOWN pour COURROIE
    // bus3 : SOON pour VIDANGE ; UNKNOWN pour COURROIE
    const firstStatuses = res.slice(0, 3).map(r => r.status);
    expect(firstStatuses).toContain('DUE');
    expect(res[0].status).toBe('DUE');
  });

  it('respecte seuils tenant (zéro magic number)', async () => {
    prismaMock = buildMocks({
      config: {
        maintenanceIntervals: [{ type: 'VIDANGE', label: 'V', intervalKm: 10_000 }],
        maintenanceAnticipationKm: 2_000, // beaucoup plus large
        maintenanceAnticipationDays: 30,
      },
      buses: [{
        id: 'b1', plateNumber: 'B', currentOdometerKm: 8_500,
        maintenanceReminders: [
          { type: 'VIDANGE', label: 'V', lastPerformedKm: 0, lastPerformedDate: null },
        ],
      }],
    });
    service = new MaintenancePredictionService(prismaMock);

    const res = await service.computeReminders('tenant-a');
    // kmRemaining = 1500, anticipation = 2000 → SOON (avec seuil standard 500 ça aurait été OK)
    expect(res[0].status).toBe('SOON');
  });

  it('filtre par busId quand fourni', async () => {
    await service.computeReminders('tenant-a', 'bus-xyz');
    expect(prismaMock.bus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a', id: 'bus-xyz' }),
      }),
    );
  });

  it('[security] filtre toujours par tenantId', async () => {
    await service.computeReminders('tenant-a');
    expect(prismaMock.bus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
    expect(prismaMock.tenantBusinessConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
  });
});
