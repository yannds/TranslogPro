/**
 * InvoiceService.createPaidReceiptFromTickets() — Sprint 3 (reçu caisse auto).
 *
 * Vérifie :
 *   - crée une Invoice PAID avec lineItems = 1 par ticket
 *   - idempotence : 2e appel même batchKey renvoie la 1re sans re-créer
 *   - propage paymentMethod, paymentRef, currency depuis les params
 *   - applique la transition DRAFT→PAID via WorkflowEngine (audit garanti)
 */

import { InvoiceService } from '@modules/invoice/invoice.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT = 'tenant-receipt-01';
const ACTOR = { id: 'agent-01', tenantId: TENANT, roleId: 'role-cashier' } as any;

function makePrisma(opts: {
  existing?: any | null;
  createdDraft?: any;
  final?: any;
} = {}) {
  return {
    invoice: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      count:     jest.fn().mockResolvedValue(0),
      create:    jest.fn().mockImplementation(({ data }: any) => Promise.resolve({
        ...data,
        id: 'inv-001',
        ...(opts.createdDraft ?? {}),
      })),
      update:    jest.fn().mockImplementation(({ data }: any) => Promise.resolve({
        id: 'inv-001', ...data,
      })),
      findFirst_final: undefined,
    },
  } as any;
}

function makeWorkflow() {
  return {
    transition: jest.fn().mockImplementation(async (entity: any, _input: any, config: any) => {
      // Simule transition DRAFT → PAID en exécutant la persist callback.
      const updated = await config.persist(entity, 'PAID', { invoice: { update: jest.fn().mockResolvedValue({ ...entity, status: 'PAID' }) } });
      return { entity: updated, toState: 'PAID' };
    }),
  } as any;
}

/**
 * Mock IEventBus minimal — `publish` est appelé depuis la persist callback
 * de WorkflowEngine pour émettre INVOICE_PAID en Outbox. Les tests existants
 * vérifient le flow caisse (création reçu) et n'ont pas besoin d'asserter
 * sur l'event ; on capture juste les appels pour les tests qui le demandent.
 */
function makeEventBus() {
  return {
    publish:   jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(),
  } as any;
}

function buildService(prisma?: any, workflow?: any, eventBus?: any) {
  const p  = prisma   ?? makePrisma();
  const w  = workflow ?? makeWorkflow();
  const eb = eventBus ?? makeEventBus();
  const svc = new InvoiceService(p as PrismaService, w, eb);
  // findOne() relit après la transition — on stub
  jest.spyOn(svc as any, 'findOne').mockImplementation((_t, id) => Promise.resolve({ id, status: 'PAID' }));
  return { service: svc, prisma: p, workflow: w, eventBus: eb };
}

const PARAMS = {
  batchKey:     'batch:t-1,t-2',
  customerName: 'Kouadio A.',
  customerPhone: '+242067000000',
  currency:      'XAF',
  paymentMethod: 'CASH',
  paymentRef:    'proof-cash-123',
  tickets: [
    { id: 't-1', passengerName: 'Kouadio A.', pricePaid: 5_000, seatNumber: '4A', routeName: 'Brazzaville — Pointe-Noire' },
    { id: 't-2', passengerName: 'Kouadio B.', pricePaid: 3_000, seatNumber: '4B', routeName: 'Brazzaville — Pointe-Noire' },
  ],
};

describe('InvoiceService.createPaidReceiptFromTickets()', () => {
  it('crée un reçu avec totalAmount = somme des tickets + lineItems', async () => {
    const { service, prisma, workflow } = buildService();
    await service.createPaidReceiptFromTickets(TENANT, PARAMS as any, ACTOR);

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId:      TENANT,
          customerName:  'Kouadio A.',
          customerPhone: '+242067000000',
          subtotal:      8_000,   // 5000 + 3000
          totalAmount:   8_000,
          currency:      'XAF',
          entityType:    'TICKET_BATCH',
          entityId:      'batch:t-1,t-2',
          paymentMethod: 'CASH',
          paymentRef:    'proof-cash-123',
          status:        'DRAFT',
        }),
      }),
    );
    // lineItems = 2 tickets
    const call = (prisma.invoice.create as jest.Mock).mock.calls[0][0];
    expect(Array.isArray(call.data.lineItems)).toBe(true);
    expect(call.data.lineItems).toHaveLength(2);
    expect(call.data.lineItems[0]).toMatchObject({ ticketId: 't-1', total: 5_000 });

    // Workflow : transition mark_paid appelée avec l'acteur réel
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-001', status: 'DRAFT' }),
      expect.objectContaining({ action: 'mark_paid', actor: ACTOR }),
      expect.anything(),
    );
  });

  it('idempotence — 2e appel avec même batchKey renvoie l\'Invoice existante sans create', async () => {
    const existing = { id: 'inv-existing', status: 'PAID', entityId: PARAMS.batchKey };
    const prisma = makePrisma({ existing });
    const { service } = buildService(prisma);
    const res = await service.createPaidReceiptFromTickets(TENANT, PARAMS as any, ACTOR);
    expect(res).toEqual(existing);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('propage paymentMethod MOBILE_MONEY + paymentRef (proof code)', async () => {
    const { service, prisma } = buildService();
    await service.createPaidReceiptFromTickets(
      TENANT,
      { ...PARAMS, paymentMethod: 'MOBILE_MONEY', paymentRef: 'MP260524.ABC' } as any,
      ACTOR,
    );
    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentMethod: 'MOBILE_MONEY',
          paymentRef:    'MP260524.ABC',
        }),
      }),
    );
  });
});
