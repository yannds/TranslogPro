/**
 * Tests unit de TripCancelledNotificationListener — fan-out aux porteurs
 * de billets actifs lors d'un TRIP_CANCELLED.
 */
import { TripCancelledNotificationListener } from '../../../src/modules/notification/trip-cancelled-notification.listener';
import { renderTripTemplate } from '../../../src/modules/notification/email-templates/trip-templates';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('TripCancelledNotificationListener', () => {
  let prismaMock: any, notificationsMock: any, platformConfigMock: any, eventBusMock: any;
  let listener: TripCancelledNotificationListener;

  const trip = {
    id: 'TRIP1',
    departureScheduled: new Date('2026-04-27T08:30:00Z'),
    route: {
      name: 'Brazzaville → Pointe-Noire',
      origin:      { city: 'Brazzaville', name: 'BZV' },
      destination: { city: 'Pointe-Noire', name: 'PNR' },
    },
  };

  const tickets = [
    { id: 'T1', passengerName: 'Awa', passengerPhone: '+221770000001', passengerEmail: 'awa@example.com',
      customer: { language: 'fr', userId: 'U1' } },
    { id: 'T2', passengerName: 'John', passengerPhone: null, passengerEmail: 'john@example.com',
      customer: { language: 'en', userId: null } },
  ];

  beforeEach(() => {
    prismaMock = {
      trip:   { findFirst: jest.fn().mockResolvedValue(trip) },
      ticket: { findMany: jest.fn().mockResolvedValue(tickets) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
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
    listener = new TripCancelledNotificationListener(
      prismaMock, notificationsMock, platformConfigMock, eventBusMock,
    );
  });

  function fire(payload: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find((c: any[]) => c[0] === EventTypes.TRIP_CANCELLED)[1];
    return handler({
      id: 'evt-1', type: EventTypes.TRIP_CANCELLED,
      tenantId: 'T1', aggregateId: 'TRIP1', aggregateType: 'Trip',
      payload, occurredAt: new Date(),
    });
  }

  it('subscribe à TRIP_CANCELLED', () => {
    listener.onModuleInit();
    expect(eventBusMock.subscribe).toHaveBeenCalledWith(EventTypes.TRIP_CANCELLED, expect.any(Function));
  });

  it('fan-out aux 2 tickets actifs avec canaux respectifs', async () => {
    await fire({ tripId: 'TRIP1', reason: 'Panne mécanique' });

    // T1 : userId + phone + email → IN_APP + WhatsApp/SMS + EMAIL = 3 envois
    // T2 : pas de userId, pas de phone, juste email → 1 envoi EMAIL
    // Total : send=3 (2 IN_APP + 2 EMAIL = 4 ? non — T1 IN_APP, T1 EMAIL, T2 EMAIL = 3)
    expect(notificationsMock.send.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(1); // T1 only
  });

  it('passe le motif dans le HTML', async () => {
    await fire({ tripId: 'TRIP1', reason: 'Météo défavorable' });
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].html).toContain('Météo défavorable');
  });

  it('ticket T2 (en) reçoit le titre en anglais', async () => {
    await fire({ tripId: 'TRIP1', reason: '' });
    const emailCalls = notificationsMock.send.mock.calls.filter((c: any[]) => c[0].channel === 'EMAIL');
    const enCall = emailCalls.find((c: any[]) => c[0].email === 'john@example.com');
    expect(enCall[0].title).toContain('Trip cancelled');
  });

  it('killswitch : skip total si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fire({ tripId: 'TRIP1' });
    expect(prismaMock.trip.findFirst).not.toHaveBeenCalled();
  });

  it('trip introuvable : skip sans throw', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce(null);
    await expect(fire({ tripId: 'NOT' })).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('sécurité : where.tenantId posé sur trip + ticket', async () => {
    await fire({ tripId: 'TRIP1' });
    expect(prismaMock.trip.findFirst.mock.calls[0][0].where.tenantId).toBe('T1');
    expect(prismaMock.ticket.findMany.mock.calls[0][0].where.tenantId).toBe('T1');
  });

  it('templateId trip.cancelled passé partout', async () => {
    await fire({ tripId: 'TRIP1' });
    const all = [...notificationsMock.send.mock.calls, ...notificationsMock.sendWithChannelFallback.mock.calls];
    for (const c of all) expect(c[0].templateId).toBe('trip.cancelled');
  });
});

describe('renderTripTemplate trip.cancelled', () => {
  const baseVars = {
    passengerName:     'Awa Diallo',
    routeName:         'Brazzaville → Pointe-Noire',
    origin:            'Brazzaville',
    destination:       'Pointe-Noire',
    scheduledDateLong: 'lundi 27 avril 2026',
    scheduledHHMM:     '08:30',
    reason:            'Panne mécanique',
  };

  it('rend en fr avec motif visuel', () => {
    const out = renderTripTemplate('trip.cancelled', 'fr', baseVars);
    expect(out.title).toContain('annulé');
    expect(out.html).toContain('Awa Diallo');
    expect(out.html).toContain('Panne mécanique');
    expect(out.html).toContain('Motif :');
  });

  it('rend en en sans motif', () => {
    const out = renderTripTemplate('trip.cancelled', 'en', { ...baseVars, reason: '' });
    expect(out.title).toContain('cancelled');
    expect(out.html).not.toContain('Reason:');
  });

  it('échappe XSS sur reason', () => {
    const out = renderTripTemplate('trip.cancelled', 'fr', { ...baseVars, reason: '<script>x</script>' });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderTripTemplate('trip.cancelled', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Trajet annulé');
  });
});
