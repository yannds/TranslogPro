/**
 * Tests Parcel — templates (4) + listener (fan-out 4 events).
 */
import { ParcelNotificationListener } from '../../../src/modules/notification/parcel-notification.listener';
import { renderParcelTemplate, ParcelTemplateId } from '../../../src/modules/notification/email-templates/parcel-templates';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('renderParcelTemplate', () => {
  const baseVars = {
    recipientName:   'Awa Diallo',
    trackingCode:    'PCL-2026-9F3K',
    destinationName: 'Pointe-Noire',
    pickupStation:   'Agence Pointe-Noire',
    trackingUrl:     'https://track.translog.pro/PCL-2026-9F3K',
    recipientRole:   'recipient',
  };

  const ids: ParcelTemplateId[] = [
    'parcel.registered', 'parcel.in_transit', 'parcel.ready_for_pickup', 'parcel.delivered',
  ];

  it.each(ids)('rend %s en fr', (id) => {
    const out = renderParcelTemplate(id, 'fr', baseVars);
    expect(out.title).toContain('PCL-2026-9F3K');
    expect(out.body).toContain('Awa Diallo');
    expect(out.html).toContain('Awa Diallo');
  });

  it.each(ids)('rend %s en en', (id) => {
    const out = renderParcelTemplate(id, 'en', baseVars);
    expect(out.body).toContain('Awa Diallo');
    expect(out.title).toContain('PCL-2026-9F3K');
  });

  it('parcel.delivered (sender role) mentionne "remis au destinataire"', () => {
    const out = renderParcelTemplate('parcel.delivered', 'fr', { ...baseVars, recipientRole: 'sender' });
    expect(out.html).toContain('remis au destinataire');
  });

  it('parcel.delivered (recipient role) mentionne juste "remis"', () => {
    const out = renderParcelTemplate('parcel.delivered', 'fr', { ...baseVars, recipientRole: 'recipient' });
    expect(out.html).not.toContain('remis au destinataire');
    expect(out.html).toContain('remis');
  });

  it('échappe XSS sur trackingCode', () => {
    const out = renderParcelTemplate('parcel.registered', 'fr', { ...baseVars, trackingCode: '<script>x</script>' });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('bouton tracking rendu si url https', () => {
    const out = renderParcelTemplate('parcel.registered', 'fr', baseVars);
    expect(out.html).toContain('href="https://track.translog.pro');
  });

  it('bouton NON rendu si trackingUrl vide', () => {
    const out = renderParcelTemplate('parcel.registered', 'fr', { ...baseVars, trackingUrl: '' });
    expect(out.html).not.toContain('Suivre mon colis');
  });

  it('parcel.ready_for_pickup mentionne "pièce d\'identité"', () => {
    const out = renderParcelTemplate('parcel.ready_for_pickup', 'fr', baseVars);
    expect(out.html).toContain('pièce d\'identité');
    expect(out.html).toContain('Agence Pointe-Noire');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderParcelTemplate('parcel.registered', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Colis enregistré');
  });
});

describe('ParcelNotificationListener', () => {
  let prismaMock: any, notificationsMock: any, platformConfigMock: any, eventBusMock: any;
  let listener: ParcelNotificationListener;

  const parcelBase = {
    id: 'P1', trackingCode: 'PCL-2026-9F3K',
    senderCustomerId: 'CS', recipientCustomerId: 'CR',
    recipientInfo: { name: 'Awa', phone: '+221770000001', email: 'awa@example.com' },
    destination: { city: 'Pointe-Noire', name: 'PNR Gare' },
    hubStation: { city: 'Pointe-Noire', name: 'PNR Gare' },
  };

  beforeEach(() => {
    prismaMock = {
      parcel:   { findFirst: jest.fn().mockResolvedValue(parcelBase) },
      customer: { findFirst: jest.fn().mockImplementation(({ where: { id } }: any) => Promise.resolve({
        name: id === 'CS' ? 'Sender Bob' : 'Recipient Awa',
        email: id === 'CS' ? 'bob@example.com' : 'awa@example.com',
        phoneE164: id === 'CS' ? '+221770000010' : '+221770000020',
        userId: id === 'CS' ? 'U-S' : 'U-R',
        language: 'fr',
      })) },
      tenant:   { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
    };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(true),
      sendWithChannelFallback: jest.fn().mockResolvedValue('WHATSAPP'),
    };
    platformConfigMock = { getBoolean: jest.fn().mockResolvedValue(true) };
    eventBusMock       = { subscribe: jest.fn(), publish: jest.fn() };
    listener = new ParcelNotificationListener(
      prismaMock, notificationsMock, platformConfigMock, eventBusMock,
    );
  });

  function fire(eventType: string, evt: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find((c: any[]) => c[0] === eventType)[1];
    return handler(evt);
  }

  it('subscribe aux 4 events Parcel', () => {
    listener.onModuleInit();
    const types = eventBusMock.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(types).toEqual(expect.arrayContaining([
      EventTypes.PARCEL_REGISTERED,
      EventTypes.PARCEL_DISPATCHED,
      EventTypes.PARCEL_ARRIVED,
      EventTypes.PARCEL_DELIVERED,
    ]));
  });

  it('PARCEL_REGISTERED notifie sender + recipient', async () => {
    await fire(EventTypes.PARCEL_REGISTERED, {
      id: 'evt-1', type: EventTypes.PARCEL_REGISTERED,
      tenantId: 'T1', aggregateId: 'P1', aggregateType: 'Parcel',
      payload: { parcelId: 'P1' }, occurredAt: new Date(),
    });
    expect(prismaMock.customer.findFirst).toHaveBeenCalledTimes(2);
    const emailCalls = notificationsMock.send.mock.calls.filter((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCalls.length).toBe(2); // sender + recipient
  });

  it('PARCEL_ARRIVED notifie recipient uniquement', async () => {
    await fire(EventTypes.PARCEL_ARRIVED, {
      id: 'evt-2', type: EventTypes.PARCEL_ARRIVED,
      tenantId: 'T1', aggregateId: 'P1', aggregateType: 'Parcel',
      payload: { parcelId: 'P1' }, occurredAt: new Date(),
    });
    expect(prismaMock.customer.findFirst).toHaveBeenCalledTimes(1);
    const emailCalls = notificationsMock.send.mock.calls.filter((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCalls.length).toBe(1);
    expect(emailCalls[0][0].templateId).toBe('parcel.ready_for_pickup');
  });

  it('PARCEL_DELIVERED notifie sender + recipient avec templateId parcel.delivered', async () => {
    await fire(EventTypes.PARCEL_DELIVERED, {
      id: 'evt-3', type: EventTypes.PARCEL_DELIVERED,
      tenantId: 'T1', aggregateId: 'P1', aggregateType: 'Parcel',
      payload: { parcelId: 'P1' }, occurredAt: new Date(),
    });
    const emailCalls = notificationsMock.send.mock.calls.filter((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCalls.length).toBe(2);
    for (const call of emailCalls) expect(call[0].templateId).toBe('parcel.delivered');
  });

  it('Fallback recipientInfo si recipientCustomerId null', async () => {
    prismaMock.parcel.findFirst.mockResolvedValueOnce({ ...parcelBase, recipientCustomerId: null });
    await fire(EventTypes.PARCEL_ARRIVED, {
      id: 'evt-4', type: EventTypes.PARCEL_ARRIVED,
      tenantId: 'T1', aggregateId: 'P1', aggregateType: 'Parcel',
      payload: { parcelId: 'P1' }, occurredAt: new Date(),
    });
    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].email).toBe('awa@example.com'); // depuis recipientInfo
  });

  it('killswitch : skip total si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fire(EventTypes.PARCEL_REGISTERED, {
      id: 'evt-5', type: EventTypes.PARCEL_REGISTERED,
      tenantId: 'T1', aggregateId: 'P1', aggregateType: 'Parcel',
      payload: { parcelId: 'P1' }, occurredAt: new Date(),
    });
    expect(prismaMock.parcel.findFirst).not.toHaveBeenCalled();
  });

  it('parcel introuvable : skip sans throw', async () => {
    prismaMock.parcel.findFirst.mockResolvedValueOnce(null);
    await expect(fire(EventTypes.PARCEL_REGISTERED, {
      id: 'evt-6', type: EventTypes.PARCEL_REGISTERED, tenantId: 'T1',
      aggregateId: 'NOTFOUND', aggregateType: 'Parcel',
      payload: { parcelId: 'NOTFOUND' }, occurredAt: new Date(),
    })).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('Sécurité : tenantId where partout', async () => {
    await fire(EventTypes.PARCEL_REGISTERED, {
      id: 'evt-7', type: EventTypes.PARCEL_REGISTERED,
      tenantId: 'TENANT-XYZ', aggregateId: 'P1', aggregateType: 'Parcel',
      payload: { parcelId: 'P1' }, occurredAt: new Date(),
    });
    expect(prismaMock.parcel.findFirst.mock.calls[0][0].where.tenantId).toBe('TENANT-XYZ');
    expect(prismaMock.customer.findFirst.mock.calls[0][0].where.tenantId).toBe('TENANT-XYZ');
  });
});
