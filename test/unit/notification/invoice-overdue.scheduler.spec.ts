/**
 * Tests unit de InvoiceOverdueScheduler — émission INVOICE_OVERDUE
 * pour les factures ISSUED + dueDate dépassée, avec idempotence
 * (1 seule notif par invoice).
 */

import { InvoiceOverdueScheduler } from '../../../src/modules/notification/invoice-overdue.scheduler';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('InvoiceOverdueScheduler', () => {
  let prismaMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let scheduler: InvoiceOverdueScheduler;

  const invA = { id: 'A', tenantId: 'T1', invoiceNumber: 'INV-A', totalAmount: 1000, currency: 'XAF', dueDate: new Date('2026-04-01'), paymentMethod: 'BANK' };
  const invB = { id: 'B', tenantId: 'T2', invoiceNumber: 'INV-B', totalAmount: 2000, currency: 'XAF', dueDate: new Date('2026-04-10'), paymentMethod: null };

  beforeEach(() => {
    prismaMock = {
      invoice:      { findMany: jest.fn().mockResolvedValue([invA, invB]) },
      notification: { findFirst: jest.fn().mockResolvedValue(null) },
      transact:     jest.fn().mockImplementation(async (fn: any) => fn({})),
    };
    platformConfigMock = { getBoolean: jest.fn().mockResolvedValue(true) };
    eventBusMock       = { publish: jest.fn() };
    scheduler          = new InvoiceOverdueScheduler(prismaMock, platformConfigMock, eventBusMock);
  });

  it('émet INVOICE_OVERDUE pour chaque facture en retard sans notif préalable', async () => {
    await scheduler.tick();

    expect(eventBusMock.publish).toHaveBeenCalledTimes(2);
    const types = eventBusMock.publish.mock.calls.map((c: any[]) => c[0].type);
    expect(types).toEqual([EventTypes.INVOICE_OVERDUE, EventTypes.INVOICE_OVERDUE]);

    const ids = eventBusMock.publish.mock.calls.map((c: any[]) => c[0].aggregateId);
    expect(ids).toEqual(['A', 'B']);
  });

  it('skip les factures déjà notifiées (idempotency via Notification table)', async () => {
    prismaMock.notification.findFirst.mockImplementation(({ where }: any) => {
      // Simule : invoice A déjà notifiée
      if (where.metadata?.equals === 'A') return Promise.resolve({ id: 'NOTIF-A' });
      return Promise.resolve(null);
    });

    await scheduler.tick();

    expect(eventBusMock.publish).toHaveBeenCalledTimes(1);
    const id = eventBusMock.publish.mock.calls[0][0].aggregateId;
    expect(id).toBe('B');
  });

  it('killswitch : skip tout le tick si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await scheduler.tick();

    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled();
    expect(eventBusMock.publish).not.toHaveBeenCalled();
  });

  it('payload contient les variables nécessaires au listener', async () => {
    await scheduler.tick();

    const event = eventBusMock.publish.mock.calls[0][0];
    expect(event.payload).toMatchObject({
      invoiceId:     'A',
      invoiceNumber: 'INV-A',
      totalAmount:   1000,
      currency:      'XAF',
    });
    expect(event.payload.dueDate).toBeTruthy();
    expect(event.tenantId).toBe('T1');
    expect(event.aggregateType).toBe('Invoice');
  });

  it('aucune facture en retard : 0 publish', async () => {
    prismaMock.invoice.findMany.mockResolvedValueOnce([]);
    await scheduler.tick();

    expect(eventBusMock.publish).not.toHaveBeenCalled();
  });

  it('publish via prisma.transact (Outbox tx atomique)', async () => {
    await scheduler.tick();
    expect(prismaMock.transact).toHaveBeenCalledTimes(2);
  });
});
