import { AnnouncementTripListener } from '../../../src/modules/announcement/announcement-trip.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

/**
 * Tests unit — AnnouncementTripListener (2026-04-20).
 *
 * Vérifie que chaque événement trip lifecycle / incident génère une
 * auto-annonce avec le type, la priorité et le contexte (trip, station)
 * corrects. L'idempotence est assurée par `sourceEventId` (testée séparément
 * dans announcement.service).
 */
describe('AnnouncementTripListener', () => {
  const tenantId = 'tenant-a';

  function makeDeps() {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'trip-1',
          tenantId,
          departureScheduled: new Date('2026-04-20T08:30:00Z'),
          route: {
            name: 'Brazza → PNR',
            originId: 'st-brz',
            origin:      { city: 'Brazzaville', name: 'Gare Brazzaville' },
            destination: { city: 'Pointe-Noire', name: 'Gare Pointe-Noire' },
          },
        }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ language: 'fr' }),
      },
    };
    const announcements = { createAuto: jest.fn().mockResolvedValue({ id: 'ann-1' }) };
    const eventBus: any = {
      subscribers: new Map<string, Array<(e: any) => Promise<void>>>(),
      subscribe(type: string, handler: (e: any) => Promise<void>) {
        const existing = this.subscribers.get(type) ?? [];
        this.subscribers.set(type, [...existing, handler]);
      },
      async emit(type: string, event: any) {
        const handlers = this.subscribers.get(type) ?? [];
        for (const h of handlers) await h(event);
      },
    };
    const listener = new AnnouncementTripListener(prisma, announcements as any, eventBus);
    listener.onModuleInit();
    return { prisma, announcements, eventBus, listener };
  }

  function evt(type: string, payload: Record<string, unknown> = {}, id = 'evt-' + type) {
    return {
      id, type, tenantId,
      aggregateId: (payload.tripId as string) ?? 'trip-1',
      aggregateType: 'Trip',
      payload, occurredAt: new Date(),
    };
  }

  it('TRIP_BOARDING_OPENED → annonce BOARDING priority 5, scope gare origine', async () => {
    const { announcements, eventBus } = makeDeps();
    await eventBus.emit(
      EventTypes.TRIP_BOARDING_OPENED,
      evt(EventTypes.TRIP_BOARDING_OPENED, { tripId: 'trip-1' }),
    );
    expect(announcements.createAuto).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      type: 'BOARDING',
      priority: 5,
      tripId: 'trip-1',
      stationId: 'st-brz',
      sourceEventId: 'evt-trip.boarding.opened',
    }));
    const call = (announcements.createAuto as jest.Mock).mock.calls[0][1];
    expect(call.title).toMatch(/Embarquement/);
    expect(call.message).toMatch(/Brazzaville/);
    expect(call.message).toMatch(/Pointe-Noire/);
  });

  it('TRIP_DELAYED → annonce DELAY priority 7', async () => {
    const { announcements, eventBus } = makeDeps();
    await eventBus.emit(EventTypes.TRIP_DELAYED, evt(EventTypes.TRIP_DELAYED, { tripId: 'trip-1' }));
    expect(announcements.createAuto).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      type: 'DELAY',
      priority: 7,
    }));
  });

  it('TRIP_CANCELLED → annonce CANCELLATION priority 9', async () => {
    const { announcements, eventBus } = makeDeps();
    await eventBus.emit(EventTypes.TRIP_CANCELLED, evt(EventTypes.TRIP_CANCELLED, { tripId: 'trip-1' }));
    expect(announcements.createAuto).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      type: 'CANCELLATION',
      priority: 9,
    }));
  });

  it('TRIP_COMPLETED → annonce ARRIVAL priority 3', async () => {
    const { announcements, eventBus } = makeDeps();
    await eventBus.emit(EventTypes.TRIP_COMPLETED, evt(EventTypes.TRIP_COMPLETED, { tripId: 'trip-1' }));
    expect(announcements.createAuto).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      type: 'ARRIVAL',
      priority: 3,
    }));
  });

  it('TRIP_PAUSED → annonce SUSPENSION priority 7', async () => {
    const { announcements, eventBus } = makeDeps();
    await eventBus.emit(EventTypes.TRIP_PAUSED, evt(EventTypes.TRIP_PAUSED, { tripId: 'trip-1' }));
    expect(announcements.createAuto).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      type: 'SUSPENSION',
      priority: 7,
    }));
  });

  it('INCIDENT_SOS → annonce SECURITY priority 10', async () => {
    const { announcements, eventBus } = makeDeps();
    await eventBus.emit(EventTypes.INCIDENT_SOS, evt(EventTypes.INCIDENT_SOS, { stationId: 'st-brz' }));
    expect(announcements.createAuto).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      type: 'SECURITY',
      priority: 10,
      stationId: 'st-brz',
      sourceEventId: 'evt-incident.sos',
    }));
  });

  it('langue tenant anglais → templates en anglais', async () => {
    const { prisma, announcements, eventBus } = makeDeps();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce({ language: 'en' });
    await eventBus.emit(EventTypes.TRIP_DELAYED, evt(EventTypes.TRIP_DELAYED, { tripId: 'trip-1' }));
    const call = (announcements.createAuto as jest.Mock).mock.calls[0][1];
    expect(call.title).toMatch(/Delay/);
    expect(call.message).toMatch(/delayed/);
  });

  it('trip introuvable → handler silencieux, pas d\'annonce', async () => {
    const { prisma, announcements, eventBus } = makeDeps();
    (prisma.trip.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await eventBus.emit(EventTypes.TRIP_DELAYED, evt(EventTypes.TRIP_DELAYED, { tripId: 'inexistant' }));
    expect(announcements.createAuto).not.toHaveBeenCalled();
  });
});
