/**
 * Tests Ticket — templates (3) + listener (3 events).
 */
import { TicketNotificationListener } from '../../../src/modules/notification/ticket-notification.listener';
import { renderTicketTemplate, TicketTemplateId } from '../../../src/modules/notification/email-templates/ticket-templates';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('renderTicketTemplate', () => {
  const baseVars = {
    passengerName:        'Awa Diallo',
    ticketRef:            'TKT-001',
    routeName:            'Brazzaville → Pointe-Noire',
    origin:               'Brazzaville',
    destination:          'Pointe-Noire',
    scheduledDateLong:    'lundi 27 avril 2026',
    newScheduledDateLong: 'mardi 28 avril 2026',
    newScheduledHHMM:     '14:30',
    ttlHours:             '48',
    rebookUrl:            'https://app.translog.pro/tickets/X/rebook',
  };

  const ids: TicketTemplateId[] = ['ticket.no_show', 'ticket.rebooked', 'ticket.forfeited'];

  it.each(ids)('rend %s en fr', (id) => {
    const out = renderTicketTemplate(id, 'fr', baseVars);
    expect(out.body).toContain('Awa Diallo');
    expect(out.html).toContain('Awa Diallo');
  });

  it.each(ids)('rend %s en en', (id) => {
    const out = renderTicketTemplate(id, 'en', baseVars);
    expect(out.body).toContain('Awa Diallo');
  });

  it('ticket.no_show inclut TTL et bouton rebook', () => {
    const out = renderTicketTemplate('ticket.no_show', 'fr', baseVars);
    expect(out.html).toContain('48h');
    expect(out.html).toContain('Replacer mon billet');
    expect(out.title).toContain('Voyage manqué');
  });

  it('ticket.rebooked inclut nouveau départ', () => {
    const out = renderTicketTemplate('ticket.rebooked', 'fr', baseVars);
    expect(out.html).toContain('mardi 28 avril 2026');
    expect(out.html).toContain('14:30');
    expect(out.html).toContain('Nouveau départ');
  });

  it('ticket.forfeited en bloc rouge avec mention "forfaituré"', () => {
    const out = renderTicketTemplate('ticket.forfeited', 'fr', baseVars);
    expect(out.title).toContain('forfaituré');
    expect(out.html).toContain('forfaituré');
  });

  it('échappe XSS sur ticketRef', () => {
    const out = renderTicketTemplate('ticket.no_show', 'fr', { ...baseVars, ticketRef: '<script>x</script>' });
    expect(out.html).not.toContain('<script>');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderTicketTemplate('ticket.no_show', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Voyage manqué');
  });
});

describe('TicketNotificationListener', () => {
  let prismaMock: any, notificationsMock: any, platformConfigMock: any, eventBusMock: any;
  let listener: TicketNotificationListener;

  const ticketBase = {
    id: 'TK1', tripId: 'TRIP1',
    passengerName: 'Awa', passengerPhone: '+221770000001', passengerEmail: 'awa@example.com',
    customer: { language: 'fr', userId: 'U1' },
  };

  const tripBase = {
    departureScheduled: new Date('2026-04-27T08:30:00Z'),
    route: {
      name: 'BZV → PNR',
      origin:      { city: 'Brazzaville', name: 'BZV' },
      destination: { city: 'Pointe-Noire', name: 'PNR' },
    },
  };

  const newTripBase = { departureScheduled: new Date('2026-04-28T14:30:00Z') };

  beforeEach(() => {
    prismaMock = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticketBase) },
      trip:   {
        findFirst: jest.fn().mockImplementation(({ where: { id } }: any) =>
          Promise.resolve(id === 'TRIP2' ? newTripBase : tripBase),
        ),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
    };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(true),
      sendWithChannelFallback: jest.fn().mockResolvedValue('WHATSAPP'),
    };
    platformConfigMock = {
      getBoolean: jest.fn().mockResolvedValue(true),
      getNumber:  jest.fn().mockResolvedValue(48),
    };
    eventBusMock = { subscribe: jest.fn(), publish: jest.fn() };
    listener = new TicketNotificationListener(
      prismaMock, notificationsMock, platformConfigMock, eventBusMock,
    );
  });

  function fire(eventType: string, payload: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find((c: any[]) => c[0] === eventType)[1];
    return handler({
      id: 'evt', type: eventType, tenantId: 'T1',
      aggregateId: payload.ticketId ?? 'TK1', aggregateType: 'Ticket',
      payload, occurredAt: new Date(),
    });
  }

  it('subscribe aux 3 events Ticket no-show/rebook/forfeit', () => {
    listener.onModuleInit();
    const types = eventBusMock.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(types).toEqual(expect.arrayContaining([
      EventTypes.TICKET_NO_SHOW,
      EventTypes.TICKET_REBOOKED,
      EventTypes.TICKET_FORFEITED,
    ]));
  });

  it('TICKET_NO_SHOW dispatche IN_APP+WhatsApp+Email', async () => {
    await fire(EventTypes.TICKET_NO_SHOW, { ticketId: 'TK1' });
    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(1);
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).toEqual(expect.arrayContaining(['IN_APP', 'EMAIL']));
  });

  it('TICKET_REBOOKED charge le newTrip et insère son départ', async () => {
    await fire(EventTypes.TICKET_REBOOKED, { ticketId: 'TK1', newTripId: 'TRIP2' });
    expect(prismaMock.trip.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'TRIP2', tenantId: 'T1' },
    }));
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].html).toContain('14:30');
  });

  it('TICKET_FORFEITED titre forfaituré', async () => {
    await fire(EventTypes.TICKET_FORFEITED, { ticketId: 'TK1' });
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].title).toContain('forfaituré');
  });

  it('killswitch : skip total si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fire(EventTypes.TICKET_NO_SHOW, { ticketId: 'TK1' });
    expect(prismaMock.ticket.findFirst).not.toHaveBeenCalled();
  });

  it('ticket introuvable : skip', async () => {
    prismaMock.ticket.findFirst.mockResolvedValueOnce(null);
    await expect(fire(EventTypes.TICKET_NO_SHOW, { ticketId: 'NOT' })).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('Sécurité : tenantId where partout', async () => {
    await fire(EventTypes.TICKET_NO_SHOW, { ticketId: 'TK1' });
    expect(prismaMock.ticket.findFirst.mock.calls[0][0].where.tenantId).toBe('T1');
  });

  it('templateId TICKET_REBOOKED → ticket.rebooked', async () => {
    await fire(EventTypes.TICKET_REBOOKED, { ticketId: 'TK1', newTripId: 'TRIP2' });
    const all = [...notificationsMock.send.mock.calls, ...notificationsMock.sendWithChannelFallback.mock.calls];
    for (const c of all) expect(c[0].templateId).toBe('ticket.rebooked');
  });
});
