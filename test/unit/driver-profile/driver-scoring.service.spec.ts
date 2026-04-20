import { DriverScoringService } from '../../../src/modules/driver-profile/driver-scoring.service';

/**
 * Tests unitaires DriverScoringService (Sprint 9).
 *
 * Prisma mocké. Vérifie : composantes ponctualité / incidents / volume,
 * pondération configurable, fenêtre glissante, isolation tenantId,
 * persistance upsert driver_scores.
 */
describe('DriverScoringService.recomputeForDriver', () => {
  let prismaMock: any;
  let service: DriverScoringService;

  const buildMocks = (overrides: Partial<any> = {}) => ({
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(overrides.config ?? {
        driverScoreWeightPunctuality: 0.5,
        driverScoreWeightIncidents:   0.3,
        driverScoreWeightTripVolume:  0.2,
        driverScoreGraceMinutes:      10,
        driverScoreWindowDays:        30,
      }),
    },
    trip: {
      findMany: jest.fn().mockResolvedValue(overrides.trips ?? []),
    },
    incident: {
      count: jest.fn().mockResolvedValue(overrides.incidents ?? 0),
    },
    driverScore: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  const mkTrip = (offsetMin: number, actualMin?: number) => {
    const scheduled = new Date(Date.now() - 2 * 24 * 3600_000);
    const actual    = actualMin != null ? new Date(scheduled.getTime() + actualMin * 60_000) : null;
    void offsetMin;
    return { id: `t-${Math.random()}`, departureScheduled: scheduled, departureActual: actual };
  };

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new DriverScoringService(prismaMock);
  });

  it('tous les trips à l\'heure → punctualityScore = 1', async () => {
    prismaMock = buildMocks({ trips: [mkTrip(0, 5), mkTrip(0, 3), mkTrip(0, 0)] });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    expect(res.tripsCompleted).toBe(3);
    expect(res.tripsOnTime).toBe(3);
    expect(res.punctualityScore).toBe(1);
  });

  it('retard > grâce pénalise punctualityScore', async () => {
    // grâce = 10 min, retards 5, 15, 0 → 2 on-time / 3 total
    prismaMock = buildMocks({ trips: [mkTrip(0, 5), mkTrip(0, 15), mkTrip(0, 0)] });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    expect(res.tripsOnTime).toBe(2);
    expect(res.punctualityScore).toBeCloseTo(2 / 3, 3);
  });

  it('incidents pénalisent incidentScore', async () => {
    prismaMock = buildMocks({
      trips: [mkTrip(0, 0), mkTrip(0, 0), mkTrip(0, 0), mkTrip(0, 0)],
      incidents: 2,
    });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    // incidentScore = max(0, 1 - 2/4) = 0.5
    expect(res.incidentScore).toBe(0.5);
  });

  it('tripVolumeScore plafonne à 1 (target=20)', async () => {
    const trips = [...Array(25)].map(() => mkTrip(0, 0));
    prismaMock = buildMocks({ trips });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    expect(res.tripVolumeScore).toBe(1);
  });

  it('tripVolumeScore partiel (target=20)', async () => {
    const trips = [...Array(10)].map(() => mkTrip(0, 0));
    prismaMock = buildMocks({ trips });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    expect(res.tripVolumeScore).toBe(0.5);
  });

  it('overallScore combine les 3 composantes avec pondération', async () => {
    // punct=1, incident=1 (0 incidents), volume=0.5 (10/20)
    // overall = 1×0.5 + 1×0.3 + 0.5×0.2 = 0.9 × 100 = 90
    const trips = [...Array(10)].map(() => mkTrip(0, 0));
    prismaMock = buildMocks({ trips, incidents: 0 });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    expect(res.overallScore).toBe(90);
  });

  it('respecte les poids custom tenant', async () => {
    const trips = [...Array(10)].map(() => mkTrip(0, 0));
    prismaMock = buildMocks({
      trips,
      incidents: 0,
      config: {
        driverScoreWeightPunctuality: 0.8,
        driverScoreWeightIncidents:   0.1,
        driverScoreWeightTripVolume:  0.1,
        driverScoreGraceMinutes:      10,
        driverScoreWindowDays:        30,
      },
    });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    // 1×0.8 + 1×0.1 + 0.5×0.1 = 0.95 → 95
    expect(res.overallScore).toBe(95);
  });

  it('aucun trip → tripsCompleted=0 avec incidentScore neutre 1', async () => {
    prismaMock = buildMocks({ trips: [] });
    service = new DriverScoringService(prismaMock);

    const res = await service.recomputeForDriver('tenant-a', 'staff-1');
    expect(res.tripsCompleted).toBe(0);
    expect(res.incidentScore).toBe(1); // neutre bienveillant
    expect(res.punctualityScore).toBe(0);
    expect(res.tripVolumeScore).toBe(0);
  });

  it('persiste via upsert sur staffId unique', async () => {
    prismaMock = buildMocks({ trips: [mkTrip(0, 0)] });
    service = new DriverScoringService(prismaMock);

    await service.recomputeForDriver('tenant-a', 'staff-1');

    expect(prismaMock.driverScore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { staffId: 'staff-1' },
      }),
    );
  });

  it('[security] filtre toujours par tenantId + driverId', async () => {
    await service.recomputeForDriver('tenant-a', 'staff-1');

    expect(prismaMock.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a', driverId: 'staff-1' }),
      }),
    );
    expect(prismaMock.tenantBusinessConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
  });
});
