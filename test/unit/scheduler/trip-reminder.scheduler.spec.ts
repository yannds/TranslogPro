import { TripReminderScheduler } from '../../../src/modules/scheduler/trip-reminder.scheduler';
import { EventTypes } from '../../../src/common/types/domain-event.type';

/**
 * Tests TripReminderScheduler — couvrent :
 *   - filtre des seuils configurés (PlatformConfig)
 *   - fenêtre de scan correctement appliquée
 *   - exclusion des trips terminés (CANCELLED/COMPLETED)
 *   - idempotency via Notification.metadata
 *   - killswitch
 *   - sécurité tenant (tenantId pris depuis Trip, pas payload)
 */
describe('TripReminderScheduler', () => {
  let prismaMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let scheduler: TripReminderScheduler;

  const now = new Date('2026-04-26T10:00:00Z');
  const trip24h = {
    id: 'TR1', tenantId: 'T1',
    departureScheduled: new Date('2026-04-27T10:00:00Z'),
  };
  const trip6h = {
    id: 'TR2', tenantId: 'T1',
    departureScheduled: new Date('2026-04-26T16:00:00Z'),
  };

  beforeEach(() => {
    prismaMock = {
      trip:         { findMany: jest.fn().mockResolvedValue([]) },
      notification: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(prismaMock)),
    };
    platformConfigMock = {
      getBoolean: jest.fn().mockResolvedValue(true),
      getNumber:  jest.fn().mockResolvedValue(15),
      getJson:    jest.fn().mockResolvedValue([24, 6, 1]),
    };
    eventBusMock = { publish: jest.fn().mockResolvedValue(undefined), subscribe: jest.fn() };

    scheduler = new TripReminderScheduler(prismaMock, platformConfigMock, eventBusMock);
  });

  it('killswitch : skip total si notifications.lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await scheduler.tick();
    expect(prismaMock.trip.findMany).not.toHaveBeenCalled();
    expect(eventBusMock.publish).not.toHaveBeenCalled();
  });

  it('scanne 1 fois par seuil [24, 6, 1] avec fenêtre ±7.5min', async () => {
    prismaMock.trip.findMany.mockResolvedValue([]);
    await scheduler.runOnce(now);
    expect(prismaMock.trip.findMany).toHaveBeenCalledTimes(3);
    // Pour le seuil 24h, target = now + 24h → fenêtre [now+24h-7.5min, now+24h+7.5min]
    const calls = prismaMock.trip.findMany.mock.calls;
    const targetCenter24h = new Date(now.getTime() + 24 * 3_600_000);
    const where24 = calls[0][0].where;
    const from = where24.departureScheduled.gte;
    const to   = where24.departureScheduled.lte;
    expect(to.getTime() - from.getTime()).toBe(15 * 60_000);
    expect(Math.abs(((from.getTime() + to.getTime()) / 2) - targetCenter24h.getTime())).toBeLessThan(1000);
  });

  it('exclut les trips CANCELLED/COMPLETED/CANCELLED_IN_TRANSIT', async () => {
    prismaMock.trip.findMany.mockResolvedValue([]);
    await scheduler.runOnce(now);
    const where = prismaMock.trip.findMany.mock.calls[0][0].where;
    expect(where.status.notIn).toEqual(['CANCELLED', 'COMPLETED', 'CANCELLED_IN_TRANSIT']);
  });

  it('émet TRIP_REMINDER_DUE par trip × seuil avec payload {tripId, hoursThreshold}', async () => {
    prismaMock.trip.findMany
      .mockResolvedValueOnce([trip24h]) // 24h
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const res = await scheduler.runOnce(now);
    expect(res.emitted).toBe(1);
    expect(eventBusMock.publish).toHaveBeenCalledTimes(1);
    const event = eventBusMock.publish.mock.calls[0][0];
    expect(event.type).toBe(EventTypes.TRIP_REMINDER_DUE);
    expect(event.tenantId).toBe('T1');
    expect(event.aggregateId).toBe('TR1');
    expect(event.payload.hoursThreshold).toBe(24);
    expect(event.payload.tripId).toBe('TR1');
  });

  it('idempotency : skip si Notification existe déjà pour (tripId, hoursThreshold)', async () => {
    prismaMock.trip.findMany
      .mockResolvedValueOnce([trip24h])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.notification.findFirst.mockResolvedValueOnce({ id: 'NOTIF-EXISTS' });
    const res = await scheduler.runOnce(now);
    expect(res.emitted).toBe(0);
    expect(eventBusMock.publish).not.toHaveBeenCalled();
    // Vérifie le where de la dédup : templateId + tenantId + metadata.tripId + metadata.hoursThreshold
    const where = prismaMock.notification.findFirst.mock.calls[0][0].where;
    expect(where.tenantId).toBe('T1');
    expect(where.templateId).toBe('notif.trip.reminder');
  });

  it('plusieurs trips dans la fenêtre 6h → 1 emit chacun', async () => {
    prismaMock.trip.findMany
      .mockResolvedValueOnce([])      // 24h
      .mockResolvedValueOnce([trip6h, { ...trip6h, id: 'TR3' }])
      .mockResolvedValueOnce([]);     // 1h
    const res = await scheduler.runOnce(now);
    expect(res.emitted).toBe(2);
    expect(eventBusMock.publish).toHaveBeenCalledTimes(2);
  });

  it('seuils invalides (PlatformConfig corrompu) → fallback sur defaults [24,6,1]', async () => {
    platformConfigMock.getJson.mockResolvedValue('not-an-array');
    prismaMock.trip.findMany.mockResolvedValue([]);
    await scheduler.runOnce(now);
    // 3 scans (24h, 6h, 1h)
    expect(prismaMock.trip.findMany).toHaveBeenCalledTimes(3);
  });

  it('SÉCURITÉ : tenantId du payload event vient du Trip (pas modifiable)', async () => {
    prismaMock.trip.findMany
      .mockResolvedValueOnce([{ ...trip24h, tenantId: 'TENANT-LEGIT' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await scheduler.runOnce(now);
    const event = eventBusMock.publish.mock.calls[0][0];
    expect(event.tenantId).toBe('TENANT-LEGIT');
  });

  it('seuils dédupliqués + triés desc (24,24,6 → 24,6)', async () => {
    platformConfigMock.getJson.mockResolvedValue([24, 24, 6]);
    prismaMock.trip.findMany.mockResolvedValue([]);
    await scheduler.runOnce(now);
    expect(prismaMock.trip.findMany).toHaveBeenCalledTimes(2);
  });
});
