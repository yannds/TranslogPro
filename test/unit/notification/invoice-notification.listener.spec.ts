/**
 * Tests unit de InvoiceNotificationListener — fan-out multi-canal sur les
 * 4 events INVOICE_*.
 *
 * Mocks : PrismaService, NotificationService, PlatformConfigService, IEventBus.
 * On vérifie le routage (channels appelés) et la sécurité tenant (where.tenantId).
 */

import { InvoiceNotificationListener } from '../../../src/modules/notification/invoice-notification.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('InvoiceNotificationListener', () => {
  let prismaMock: any;
  let notificationsMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let listener: InvoiceNotificationListener;

  const invoiceBase = {
    id:            'INV1',
    invoiceNumber: 'INV-2026-00042',
    customerName:  'Jean Mbemba',
    customerEmail: 'jean@example.com',
    customerPhone: '+242612345678',
    customerId:    'C1',
    totalAmount:   12500,
    currency:      'XAF',
    dueDate:       new Date('2026-05-27T00:00:00Z'),
    paidAt:        null,
    paymentMethod: 'Mobile Money',
    issuedAt:      new Date('2026-04-27T08:00:00Z'),
  };

  beforeEach(() => {
    prismaMock = {
      invoice:  { findFirst: jest.fn().mockResolvedValue(invoiceBase) },
      customer: { findFirst: jest.fn().mockResolvedValue({ language: 'fr', userId: 'U1' }) },
      tenant:   { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
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

    listener = new InvoiceNotificationListener(
      prismaMock,
      notificationsMock,
      platformConfigMock,
      eventBusMock,
    );
  });

  function fireHandler(eventType: string, evt: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === eventType,
    )[1];
    return handler(evt);
  }

  it('subscribe aux 4 events INVOICE_* au démarrage', () => {
    listener.onModuleInit();
    const types = eventBusMock.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(types).toEqual(expect.arrayContaining([
      EventTypes.INVOICE_ISSUED,
      EventTypes.INVOICE_PAID,
      EventTypes.INVOICE_OVERDUE,
      EventTypes.INVOICE_CANCELLED,
    ]));
  });

  it('INVOICE_ISSUED : envoie IN_APP + WhatsApp/SMS + Email', async () => {
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-1', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    expect(notificationsMock.sendWithChannelFallback).toHaveBeenCalledTimes(1);
    expect(notificationsMock.send).toHaveBeenCalledTimes(2); // IN_APP + EMAIL
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).toEqual(expect.arrayContaining(['IN_APP', 'EMAIL']));

    // Sécurité : where.tenantId posé sur invoice.findFirst
    expect(prismaMock.invoice.findFirst.mock.calls[0][0].where.tenantId).toBe('T1');
  });

  it('INVOICE_PAID : utilise le bon templateId dans la métadata', async () => {
    await fireHandler(EventTypes.INVOICE_PAID, {
      id: 'evt-2', type: EventTypes.INVOICE_PAID,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].templateId).toBe('invoice.paid');
    expect(emailCall[0].title).toContain('Paiement reçu');
  });

  it('INVOICE_OVERDUE : titre en retard + nombre de jours calculé', async () => {
    await fireHandler(EventTypes.INVOICE_OVERDUE, {
      id: 'evt-3', type: EventTypes.INVOICE_OVERDUE,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].templateId).toBe('invoice.overdue');
    expect(emailCall[0].title).toContain('en retard');
    expect(emailCall[0].html).toContain('jour(s)');
  });

  it('INVOICE_CANCELLED : titre annulée', async () => {
    await fireHandler(EventTypes.INVOICE_CANCELLED, {
      id: 'evt-4', type: EventTypes.INVOICE_CANCELLED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].templateId).toBe('invoice.cancelled');
    expect(emailCall[0].title).toContain('annulée');
  });

  it('skip IN_APP si Customer.userId est null (shadow customer)', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({ language: 'fr', userId: null });
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-5', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).not.toContain('IN_APP');
    expect(channels).toContain('EMAIL');
  });

  it('skip Email si customerEmail est null', async () => {
    prismaMock.invoice.findFirst.mockResolvedValueOnce({ ...invoiceBase, customerEmail: null });
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-6', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).not.toContain('EMAIL');
  });

  it('skip phone si customerPhone est null', async () => {
    prismaMock.invoice.findFirst.mockResolvedValueOnce({ ...invoiceBase, customerPhone: null });
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-7', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    expect(notificationsMock.sendWithChannelFallback).not.toHaveBeenCalled();
  });

  it('killswitch : skip total si notifications.lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-8', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    expect(notificationsMock.send).not.toHaveBeenCalled();
    expect(notificationsMock.sendWithChannelFallback).not.toHaveBeenCalled();
    expect(prismaMock.invoice.findFirst).not.toHaveBeenCalled();
  });

  it('invoice introuvable : log debug + skip sans throw', async () => {
    prismaMock.invoice.findFirst.mockResolvedValueOnce(null);
    await expect(
      fireHandler(EventTypes.INVOICE_ISSUED, {
        id: 'evt-9', type: EventTypes.INVOICE_ISSUED,
        tenantId: 'T1', aggregateId: 'INV-NOT-FOUND', aggregateType: 'Invoice',
        payload: { invoiceId: 'INV-NOT-FOUND' }, occurredAt: new Date(),
      }),
    ).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('langue résolue depuis Customer.language en priorité (en)', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({ language: 'en', userId: 'U1' });
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-10', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].title).toContain('New invoice');
  });

  it('fallback langue tenant si Customer.language null', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({ language: null, userId: 'U1' });
    prismaMock.tenant.findUnique.mockResolvedValueOnce({ language: 'en' });
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-11', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].title).toContain('New invoice');
  });

  it('customerId null : skip lookup Customer + dispatch EMAIL/SMS uniquement (pas IN_APP)', async () => {
    prismaMock.invoice.findFirst.mockResolvedValueOnce({ ...invoiceBase, customerId: null });
    await fireHandler(EventTypes.INVOICE_ISSUED, {
      id: 'evt-12', type: EventTypes.INVOICE_ISSUED,
      tenantId: 'T1', aggregateId: 'INV1', aggregateType: 'Invoice',
      payload: { invoiceId: 'INV1' }, occurredAt: new Date(),
    });

    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).not.toContain('IN_APP');
    expect(channels).toContain('EMAIL');
  });
});
