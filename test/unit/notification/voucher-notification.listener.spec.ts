/**
 * Tests unit de VoucherNotificationListener — fan-out multi-canal sur
 * VOUCHER_ISSUED.
 *
 * Mocks : Prisma, NotificationService, PlatformConfig, IEventBus.
 */

import { VoucherNotificationListener } from '../../../src/modules/notification/voucher-notification.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('VoucherNotificationListener', () => {
  let prismaMock: any;
  let notificationsMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let listener: VoucherNotificationListener;

  const voucherWithCustomer = {
    id:             'V1',
    code:           'VCHR-9F3K-2M1X',
    amount:         5000,
    currency:       'XAF',
    validityEnd:    new Date('2026-05-26T23:59:59Z'),
    usageScope:     'SAME_COMPANY',
    origin:         'GESTURE',
    customerId:     'C1',
    recipientEmail: null,
    recipientPhone: null,
  };

  beforeEach(() => {
    prismaMock = {
      voucher:  { findFirst: jest.fn().mockResolvedValue(voucherWithCustomer) },
      customer: { findFirst: jest.fn().mockResolvedValue({
        name: 'Awa Diallo', email: 'awa@example.com', phoneE164: '+221770000000',
        userId: 'U1', language: 'fr',
      }) },
      tenant:   { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
    };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(true),
      sendWithChannelFallback: jest.fn().mockResolvedValue('WHATSAPP'),
    };
    platformConfigMock = { getBoolean: jest.fn().mockResolvedValue(true) };
    eventBusMock       = { subscribe: jest.fn(), publish: jest.fn() };

    listener = new VoucherNotificationListener(
      prismaMock, notificationsMock, platformConfigMock, eventBusMock,
    );
  });

  function fireEvent(evt: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.VOUCHER_ISSUED,
    )[1];
    return handler(evt);
  }

  it('subscribe à VOUCHER_ISSUED au démarrage', () => {
    listener.onModuleInit();
    expect(eventBusMock.subscribe).toHaveBeenCalledWith(EventTypes.VOUCHER_ISSUED, expect.any(Function));
  });

  it('Customer rattaché : dispatch IN_APP + WhatsApp/SMS + EMAIL', async () => {
    await fireEvent({
      id: 'evt-1', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'V1', aggregateType: 'Voucher',
      payload: { voucherId: 'V1' }, occurredAt: new Date(),
    });

    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(1);
    expect(notificationsMock.send).toHaveBeenCalledTimes(2);
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).toEqual(expect.arrayContaining(['IN_APP', 'EMAIL']));
    // Sécurité : tenantId where posé
    expect(prismaMock.voucher.findFirst.mock.calls[0][0].where.tenantId).toBe('T1');
  });

  it('Voucher avec recipientEmail/Phone (pas de customerId) : dispatch EMAIL/SMS uniquement', async () => {
    prismaMock.voucher.findFirst.mockResolvedValueOnce({
      ...voucherWithCustomer,
      customerId:     null,
      recipientEmail: 'libre@example.com',
      recipientPhone: '+221770000001',
    });
    await fireEvent({
      id: 'evt-2', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'V1', aggregateType: 'Voucher',
      payload: { voucherId: 'V1' }, occurredAt: new Date(),
    });

    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(1);
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).not.toContain('IN_APP'); // pas de userId
    expect(channels).toContain('EMAIL');
  });

  it('Voucher sans customerId NI recipientEmail/Phone : skip silencieux', async () => {
    prismaMock.voucher.findFirst.mockResolvedValueOnce({
      ...voucherWithCustomer,
      customerId:     null,
      recipientEmail: null,
      recipientPhone: null,
    });
    await fireEvent({
      id: 'evt-3', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'V1', aggregateType: 'Voucher',
      payload: { voucherId: 'V1' }, occurredAt: new Date(),
    });

    expect(notificationsMock.send).not.toHaveBeenCalled();
    expect(notificationsMock.sendWithChannelFallback).not.toHaveBeenCalled();
  });

  it('templateId voucher.issued passé partout', async () => {
    await fireEvent({
      id: 'evt-4', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'V1', aggregateType: 'Voucher',
      payload: { voucherId: 'V1' }, occurredAt: new Date(),
    });
    const allCalls = [
      ...notificationsMock.send.mock.calls,
      ...notificationsMock.sendWithChannelFallback.mock.calls,
    ];
    for (const call of allCalls) {
      expect(call[0].templateId).toBe('voucher.issued');
    }
  });

  it('killswitch : skip total si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fireEvent({
      id: 'evt-5', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'V1', aggregateType: 'Voucher',
      payload: { voucherId: 'V1' }, occurredAt: new Date(),
    });

    expect(prismaMock.voucher.findFirst).not.toHaveBeenCalled();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('voucher introuvable : skip sans throw', async () => {
    prismaMock.voucher.findFirst.mockResolvedValueOnce(null);
    await expect(fireEvent({
      id: 'evt-6', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'NOTFOUND', aggregateType: 'Voucher',
      payload: { voucherId: 'NOTFOUND' }, occurredAt: new Date(),
    })).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('langue Customer prioritaire sur tenant (en)', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      name: 'John', email: 'john@example.com', phoneE164: null,
      userId: 'U2', language: 'en',
    });
    await fireEvent({
      id: 'evt-7', type: EventTypes.VOUCHER_ISSUED,
      tenantId: 'T1', aggregateId: 'V1', aggregateType: 'Voucher',
      payload: { voucherId: 'V1' }, occurredAt: new Date(),
    });
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].title).toContain('Your voucher');
  });
});
