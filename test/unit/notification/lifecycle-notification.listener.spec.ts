import { LifecycleNotificationListener } from '../../../src/modules/notification/lifecycle-notification.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

/**
 * Tests unit du LifecycleNotificationListener — couvrent :
 *   - fan-out aux passagers (TICKET_ISSUED, TRIP_BOARDING_OPENED, TRIP_COMPLETED, TRIP_REMINDER_DUE)
 *   - filtrage des Tickets actifs uniquement (CONFIRMED/CHECKED_IN/BOARDED)
 *   - killswitch via PlatformConfig
 *   - sécurité tenant (where.tenantId toujours posé)
 *
 * NotificationService est mocké : on vérifie uniquement le routage.
 */
describe('LifecycleNotificationListener', () => {
  let prismaMock: any;
  let notificationsMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let listener: LifecycleNotificationListener;

  const trip = {
    id: 'TRIP1',
    departureScheduled: new Date('2026-04-27T08:30:00Z'),
    route: {
      name: 'Pointe-Noire ⇄ Brazzaville',
      origin:      { city: 'Pointe-Noire', name: 'Pointe-Noire Gare' },
      destination: { city: 'Brazzaville',   name: 'Brazzaville Gare' },
    },
  };

  beforeEach(() => {
    prismaMock = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
      trip:   { findFirst: jest.fn().mockResolvedValue(trip) },
      ticket: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(true),
      sendWithChannelFallback: jest.fn().mockResolvedValue('WHATSAPP'),
    };
    platformConfigMock = {
      getBoolean: jest.fn().mockResolvedValue(true),
      getNumber:  jest.fn().mockResolvedValue(500),
    };
    eventBusMock = { subscribe: jest.fn(), publish: jest.fn() };

    listener = new LifecycleNotificationListener(
      prismaMock,
      notificationsMock,
      platformConfigMock,
      eventBusMock,
    );
  });

  it('subscribe aux 5 events lifecycle au démarrage', () => {
    listener.onModuleInit();
    const calls = eventBusMock.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([
      EventTypes.TICKET_ISSUED,
      EventTypes.TRIP_PUBLISHED,
      EventTypes.TRIP_BOARDING_OPENED,
      EventTypes.TRIP_REMINDER_DUE,
      EventTypes.TRIP_COMPLETED,
    ]));
  });

  it('TICKET_ISSUED : envoie WhatsApp/SMS + Email + IN_APP au passager', async () => {
    prismaMock.ticket.findFirst.mockResolvedValueOnce({
      id: 'TK1', tripId: 'TRIP1', passengerName: 'Marie',
      passengerPhone: '+242612345678', passengerEmail: 'marie@example.com',
      customerId: 'C1', pricePaid: 5000,
      customer: { language: 'fr', userId: 'U1' },
    });
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TICKET_ISSUED,
    )[1];
    await handler({
      id: 'evt-1', type: EventTypes.TICKET_ISSUED, tenantId: 'T1',
      aggregateId: 'TK1', aggregateType: 'Ticket',
      payload: { ticketId: 'TK1', tripId: 'TRIP1' }, occurredAt: new Date(),
    });

    // 1× IN_APP + 1× sendWithChannelFallback (WA→SMS) + 1× EMAIL
    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(1);
    expect(notificationsMock.send).toHaveBeenCalledTimes(2); // IN_APP + EMAIL
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).toEqual(expect.arrayContaining(['IN_APP', 'EMAIL']));
  });

  it('killswitch : skip total si notifications.lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TICKET_ISSUED,
    )[1];
    await handler({
      id: 'evt-2', type: EventTypes.TICKET_ISSUED, tenantId: 'T1',
      aggregateId: 'TK1', aggregateType: 'Ticket',
      payload: { ticketId: 'TK1' }, occurredAt: new Date(),
    });
    expect(notificationsMock.send).not.toHaveBeenCalled();
    expect(notificationsMock.sendWithChannelFallback).not.toHaveBeenCalled();
    expect(prismaMock.ticket.findFirst).not.toHaveBeenCalled();
  });

  it('TRIP_BOARDING_OPENED : fan-out aux tickets actifs uniquement', async () => {
    prismaMock.ticket.findMany.mockResolvedValueOnce([
      { id: 'TK1', passengerName: 'A', passengerPhone: '+242611111111', passengerEmail: null,
        customer: { language: 'fr', userId: 'U1' } },
      { id: 'TK2', passengerName: 'B', passengerPhone: '+242622222222', passengerEmail: 'b@x.com',
        customer: { language: 'en', userId: 'U2' } },
    ]);
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TRIP_BOARDING_OPENED,
    )[1];
    await handler({
      id: 'evt-3', type: EventTypes.TRIP_BOARDING_OPENED, tenantId: 'T1',
      aggregateId: 'TRIP1', aggregateType: 'Trip',
      payload: { tripId: 'TRIP1' }, occurredAt: new Date(),
    });

    // findMany doit filtrer sur tenantId + tripId + status actif
    const where = prismaMock.ticket.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('T1');
    expect(where.tripId).toBe('TRIP1');
    expect(where.status.in).toEqual(['CONFIRMED', 'CHECKED_IN', 'BOARDED']);

    // 2 passagers × (IN_APP + WA fallback + Email-si-présent)
    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(2);
  });

  it('SÉCURITÉ : where.tenantId toujours posé (Trip et Ticket lookups)', async () => {
    prismaMock.ticket.findFirst.mockResolvedValueOnce({
      id: 'TK1', tripId: 'TRIP1', passengerName: 'X',
      passengerPhone: null, passengerEmail: null,
      customerId: null, pricePaid: 0,
      customer: null,
    });
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TICKET_ISSUED,
    )[1];
    await handler({
      id: 'evt-4', type: EventTypes.TICKET_ISSUED, tenantId: 'TENANT-A',
      aggregateId: 'TK1', aggregateType: 'Ticket',
      payload: { ticketId: 'TK1' }, occurredAt: new Date(),
    });

    expect(prismaMock.ticket.findFirst.mock.calls[0][0].where.tenantId).toBe('TENANT-A');
    expect(prismaMock.trip.findFirst.mock.calls[0][0].where.tenantId).toBe('TENANT-A');
  });

  it('TRIP_REMINDER_DUE : skip si payload.hoursThreshold absent (mauvais cron)', async () => {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TRIP_REMINDER_DUE,
    )[1];
    await handler({
      id: 'evt-5', type: EventTypes.TRIP_REMINDER_DUE, tenantId: 'T1',
      aggregateId: 'TRIP1', aggregateType: 'Trip',
      payload: { tripId: 'TRIP1' }, occurredAt: new Date(),
    });
    expect(prismaMock.ticket.findMany).not.toHaveBeenCalled();
  });

  it('TRIP_PUBLISHED : ne notifie QUE les Customers FREQUENT/VIP (pas spam)', async () => {
    prismaMock.customer.findMany.mockResolvedValueOnce([
      { phoneE164: '+242611111111', email: 'a@x.com', name: 'A',
        language: 'fr', userId: 'U1' },
    ]);
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TRIP_PUBLISHED,
    )[1];
    await handler({
      id: 'evt-6', type: EventTypes.TRIP_PUBLISHED, tenantId: 'T1',
      aggregateId: 'TRIP1', aggregateType: 'Trip',
      payload: { tripId: 'TRIP1' }, occurredAt: new Date(),
    });

    const where = prismaMock.customer.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('T1');
    expect(where.phoneVerified).toBe(true);
    // Le filtre OR doit cibler FREQUENT et VIP
    expect(where.OR).toEqual(expect.arrayContaining([
      { segments: { has: 'FREQUENT' } },
      { segments: { has: 'VIP' } },
    ]));
  });

  it('TRIP_COMPLETED : utilise template arrived (bon séjour)', async () => {
    prismaMock.ticket.findMany.mockResolvedValueOnce([
      { id: 'TK1', passengerName: 'A', passengerPhone: '+242611111111', passengerEmail: null,
        customer: { language: 'fr', userId: 'U1' } },
    ]);
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TRIP_COMPLETED,
    )[1];
    await handler({
      id: 'evt-7', type: EventTypes.TRIP_COMPLETED, tenantId: 'T1',
      aggregateId: 'TRIP1', aggregateType: 'Trip',
      payload: { tripId: 'TRIP1' }, occurredAt: new Date(),
    });

    // Le templateId envoyé via send (IN_APP) doit être notif.trip.arrived
    const inAppCall = notificationsMock.send.mock.calls.find(
      (c: any[]) => c[0].channel === 'IN_APP',
    );
    expect(inAppCall[0].templateId).toBe('notif.trip.arrived');
    // Le body en français doit contenir "Bon séjour"
    expect(inAppCall[0].body).toMatch(/bon séjour/i);
  });

  it('limite maxRecipientsPerTrip respectée dans findMany.take', async () => {
    platformConfigMock.getNumber.mockResolvedValueOnce(7);
    prismaMock.ticket.findMany.mockResolvedValueOnce([]);
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.TRIP_BOARDING_OPENED,
    )[1];
    await handler({
      id: 'evt-8', type: EventTypes.TRIP_BOARDING_OPENED, tenantId: 'T1',
      aggregateId: 'TRIP1', aggregateType: 'Trip',
      payload: { tripId: 'TRIP1' }, occurredAt: new Date(),
    });
    expect(prismaMock.ticket.findMany.mock.calls[0][0].take).toBe(7);
  });
});
