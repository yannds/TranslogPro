/**
 * Tests unit de RefundNotificationListener — fan-out multi-canal sur les
 * 4 events refund (created / approved / auto_approved / rejected).
 */
import { RefundNotificationListener } from '../../../src/modules/notification/refund-notification.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('RefundNotificationListener', () => {
  let prismaMock: any;
  let notificationsMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let listener: RefundNotificationListener;

  const refundBase = {
    id:             'R1',
    ticketId:       'TK1',
    amount:         8750,
    originalAmount: 10000,
    policyPercent:  0.875,
    currency:       'XAF',
    reason:         'CLIENT_CANCEL',
    paymentMethod:  'Mobile Money',
    notes:          null,
  };

  const ticketBase = {
    passengerName:  'Awa Diallo',
    passengerEmail: 'awa@example.com',
    passengerPhone: '+221770000000',
    customer:       { language: 'fr', userId: 'U1' },
  };

  beforeEach(() => {
    prismaMock = {
      refund: { findFirst: jest.fn().mockResolvedValue(refundBase) },
      ticket: { findFirst: jest.fn().mockResolvedValue(ticketBase) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) },
    };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(true),
      sendWithChannelFallback: jest.fn().mockResolvedValue('WHATSAPP'),
    };
    platformConfigMock = { getBoolean: jest.fn().mockResolvedValue(true) };
    eventBusMock       = { subscribe: jest.fn(), publish: jest.fn() };
    listener = new RefundNotificationListener(
      prismaMock, notificationsMock, platformConfigMock, eventBusMock,
    );
  });

  function fire(eventType: string, evt: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find((c: any[]) => c[0] === eventType)[1];
    return handler(evt);
  }

  it('subscribe aux 4 events Refund', () => {
    listener.onModuleInit();
    const types = eventBusMock.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(types).toEqual(expect.arrayContaining([
      EventTypes.REFUND_CREATED,
      EventTypes.REFUND_APPROVED,
      EventTypes.REFUND_AUTO_APPROVED,
      EventTypes.REFUND_REJECTED,
    ]));
  });

  it('REFUND_CREATED → templateId refund.created', async () => {
    await fire(EventTypes.REFUND_CREATED, {
      id: 'evt-1', type: EventTypes.REFUND_CREATED,
      tenantId: 'T1', aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].templateId).toBe('refund.created');
    expect(emailCall[0].title).toContain('enregistrée');
  });

  it('REFUND_APPROVED et AUTO_APPROVED partagent le templateId refund.approved', async () => {
    await fire(EventTypes.REFUND_APPROVED, {
      id: 'evt-2', type: EventTypes.REFUND_APPROVED,
      tenantId: 'T1', aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    const e1 = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(e1[0].templateId).toBe('refund.approved');

    notificationsMock.send.mockClear();

    await fire(EventTypes.REFUND_AUTO_APPROVED, {
      id: 'evt-3', type: EventTypes.REFUND_AUTO_APPROVED,
      tenantId: 'T1', aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    const e2 = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(e2[0].templateId).toBe('refund.approved');
  });

  it('REFUND_REJECTED → notes propagées dans le HTML', async () => {
    prismaMock.refund.findFirst.mockResolvedValueOnce({ ...refundBase, notes: 'Trop tard' });
    await fire(EventTypes.REFUND_REJECTED, {
      id: 'evt-4', type: EventTypes.REFUND_REJECTED,
      tenantId: 'T1', aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].html).toContain('Trop tard');
  });

  it('Refund introuvable : skip sans throw', async () => {
    prismaMock.refund.findFirst.mockResolvedValueOnce(null);
    await expect(fire(EventTypes.REFUND_CREATED, {
      id: 'evt-5', type: EventTypes.REFUND_CREATED, tenantId: 'T1',
      aggregateId: 'NOTFOUND', aggregateType: 'Refund',
      payload: { refundId: 'NOTFOUND' }, occurredAt: new Date(),
    })).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('Ticket orphelin : skip sans throw', async () => {
    prismaMock.ticket.findFirst.mockResolvedValueOnce(null);
    await expect(fire(EventTypes.REFUND_CREATED, {
      id: 'evt-6', type: EventTypes.REFUND_CREATED, tenantId: 'T1',
      aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    })).resolves.not.toThrow();
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('killswitch : skip total si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fire(EventTypes.REFUND_CREATED, {
      id: 'evt-7', type: EventTypes.REFUND_CREATED, tenantId: 'T1',
      aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    expect(prismaMock.refund.findFirst).not.toHaveBeenCalled();
  });

  it('langue Customer (en) prioritaire sur tenant', async () => {
    prismaMock.ticket.findFirst.mockResolvedValueOnce({
      ...ticketBase, customer: { language: 'en', userId: 'U1' },
    });
    await fire(EventTypes.REFUND_CREATED, {
      id: 'evt-8', type: EventTypes.REFUND_CREATED, tenantId: 'T1',
      aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    const emailCall = notificationsMock.send.mock.calls.find((c: any[]) => c[0].channel === 'EMAIL');
    expect(emailCall[0].title).toContain('Refund request received');
  });

  it('Customer userId null : skip IN_APP, dispatche EMAIL/SMS', async () => {
    prismaMock.ticket.findFirst.mockResolvedValueOnce({
      ...ticketBase, customer: { language: 'fr', userId: null },
    });
    await fire(EventTypes.REFUND_APPROVED, {
      id: 'evt-9', type: EventTypes.REFUND_APPROVED, tenantId: 'T1',
      aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    const channels = notificationsMock.send.mock.calls.map((c: any[]) => c[0].channel);
    expect(channels).not.toContain('IN_APP');
    expect(channels).toContain('EMAIL');
  });

  it('Sécurité : where.tenantId posé sur refund.findFirst ET ticket.findFirst', async () => {
    await fire(EventTypes.REFUND_CREATED, {
      id: 'evt-10', type: EventTypes.REFUND_CREATED, tenantId: 'TENANT-XYZ',
      aggregateId: 'R1', aggregateType: 'Refund',
      payload: { refundId: 'R1' }, occurredAt: new Date(),
    });
    expect(prismaMock.refund.findFirst.mock.calls[0][0].where.tenantId).toBe('TENANT-XYZ');
    expect(prismaMock.ticket.findFirst.mock.calls[0][0].where.tenantId).toBe('TENANT-XYZ');
  });
});
