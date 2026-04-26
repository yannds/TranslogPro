import { VoucherService } from '../../../src/modules/voucher/voucher.service';
import { VoucherState, VoucherAction, VoucherUsageScope } from '../../../src/common/constants/workflow-states';

/**
 * VoucherService — tests unit sur issue + redeem + cancel.
 * WorkflowEngine mocké : vérifie uniquement la logique applicative (validations,
 * transitions déléguées).
 */
describe('VoucherService', () => {
  let prismaMock:     any;
  let workflowMock:   any;
  let cashierMock:    any;
  let service:        VoucherService;

  const tenantId = 'T1';

  let eventBusMock: any;

  beforeEach(() => {
    prismaMock = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ slug: 'trans-express' }),
      },
      voucher: {
        findUnique: jest.fn().mockResolvedValue(null), // pas de collision
        findFirst:  jest.fn(),
        findMany:   jest.fn().mockResolvedValue([]),
        create:     jest.fn(),
        update:     jest.fn(),
      },
      ticket: {
        findFirst: jest.fn(),
      },
      trip: {
        findFirst: jest.fn(),
      },
      agency: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ag-1' }),
      },
      // issue() wrappe maintenant create + eventBus.publish dans transact —
      // on exécute le callback en lui repassant prismaMock comme tx pour garder
      // les assertions sur voucher.create.* fonctionnelles.
      transact: jest.fn().mockImplementation(async (fn: any) => fn(prismaMock)),
    };
    workflowMock = {
      transition: jest.fn().mockImplementation((_entity, _input, cfg) => cfg.persist(_entity, 'REDEEMED', prismaMock)),
    };
    cashierMock = {
      getOrCreateVirtualRegister: jest.fn().mockResolvedValue({ id: 'vreg-1' }),
      recordTransaction:          jest.fn().mockResolvedValue({ id: 'tx-1' }),
    };
    eventBusMock = {
      publish:   jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
    };
    service = new VoucherService(prismaMock, workflowMock, cashierMock, eventBusMock);
  });

  // ─── issue ─────────────────────────────────────────────────────────────────

  describe('issue', () => {
    it('rejette montant <= 0', async () => {
      await expect(service.issue({
        tenantId, amount: 0, currency: 'XAF', validityDays: 30, origin: 'MANUAL',
      } as any)).rejects.toThrow('montant');
    });

    it('rejette validité < 1 jour', async () => {
      await expect(service.issue({
        tenantId, amount: 1000, currency: 'XAF', validityDays: 0, origin: 'MANUAL',
      } as any)).rejects.toThrow('validité');
    });

    it('crée un voucher ISSUED avec code unique préfixé tenant', async () => {
      prismaMock.voucher.create.mockResolvedValue({
        id: 'V1', code: 'TRAN-ABCD-1234',
        amount: 5000, currency: 'XAF',
        validityEnd: new Date('2026-10-23T00:00:00Z'),
        origin: 'MANUAL', usageScope: VoucherUsageScope.SAME_COMPANY,
        sourceTripId: null, sourceTicketId: null,
      });
      const res = await service.issue({
        tenantId, amount: 5000, currency: 'XAF', validityDays: 180, origin: 'MANUAL',
      } as any);
      expect(res.id).toBe('V1');
      expect(prismaMock.voucher.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId, amount: 5000, status: VoucherState.ISSUED,
          usageScope: VoucherUsageScope.SAME_COMPANY,
        }),
      }));
      // Émission VOUCHER_ISSUED en Outbox dans la même tx
      expect(eventBusMock.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'voucher.issued',
          tenantId,
          aggregateType: 'Voucher',
          aggregateId: 'V1',
        }),
        prismaMock,
      );
      // Code commence par préfixe slug tenant (transformé maj / no-alpha retiré)
      const createdCode = prismaMock.voucher.create.mock.calls[0][0].data.code;
      expect(createdCode).toMatch(/^[A-Z]{1,4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    });

    it('définit validityEnd à now + validityDays (stable à l\'émission)', async () => {
      const before = Date.now();
      prismaMock.voucher.create.mockImplementation((args: any) => Promise.resolve({ id: 'V', ...args.data }));
      await service.issue({
        tenantId, amount: 1000, currency: 'XAF', validityDays: 30, origin: 'PROMO',
      } as any);
      const passedData = prismaMock.voucher.create.mock.calls[0][0].data;
      const delta = passedData.validityEnd.getTime() - passedData.validityStart.getTime();
      const expected = 30 * 86_400_000;
      expect(Math.abs(delta - expected)).toBeLessThan(1_000);
      expect(passedData.validityStart.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  // ─── redeem ────────────────────────────────────────────────────────────────

  describe('redeem', () => {
    const actor = { id: 'U1', tenantId, roleId: 'R1' } as any;

    it('404 si voucher inconnu', async () => {
      prismaMock.voucher.findFirst.mockResolvedValue(null);
      await expect(service.redeem(tenantId, 'UNKNOWN', 'TK1', actor))
        .rejects.toThrow('introuvable');
    });

    it('rejette si voucher déjà REDEEMED', async () => {
      prismaMock.voucher.findFirst.mockResolvedValue({
        id: 'V1', status: VoucherState.REDEEMED,
        validityEnd: new Date(Date.now() + 86_400_000),
      });
      await expect(service.redeem(tenantId, 'C1', 'TK1', actor))
        .rejects.toThrow('utilisable');
    });

    it('rejette si voucher expiré (validityEnd dépassé)', async () => {
      prismaMock.voucher.findFirst.mockResolvedValue({
        id: 'V1', status: VoucherState.ISSUED,
        validityEnd: new Date(Date.now() - 86_400_000),
      });
      await expect(service.redeem(tenantId, 'C1', 'TK1', actor))
        .rejects.toThrow('expiré');
    });

    it('rejette si scope SAME_ROUTE + route du ticket différente', async () => {
      prismaMock.voucher.findFirst.mockResolvedValue({
        id: 'V1', status: VoucherState.ISSUED,
        validityEnd: new Date(Date.now() + 86_400_000),
        usageScope: VoucherUsageScope.SAME_ROUTE,
        routeId: 'R1', customerId: null, recipientPhone: null,
      });
      prismaMock.ticket.findFirst.mockResolvedValue({
        id: 'TK1', tripId: 'Trip1', customerId: null, passengerPhone: null,
      });
      prismaMock.trip.findFirst.mockResolvedValue({ routeId: 'R2' });
      await expect(service.redeem(tenantId, 'C1', 'TK1', actor))
        .rejects.toThrow('route');
    });

    it('rejette si voucher nominatif (customerId différent)', async () => {
      prismaMock.voucher.findFirst.mockResolvedValue({
        id: 'V1', status: VoucherState.ISSUED,
        validityEnd: new Date(Date.now() + 86_400_000),
        usageScope: VoucherUsageScope.SAME_COMPANY,
        customerId: 'CUST_A', recipientPhone: null,
      });
      prismaMock.ticket.findFirst.mockResolvedValue({
        id: 'TK1', tripId: 'Trip1', customerId: 'CUST_B', passengerPhone: null,
      });
      await expect(service.redeem(tenantId, 'C1', 'TK1', actor))
        .rejects.toThrow('nominatif');
    });

    it('redeem OK : appelle workflow.transition(REDEEM) avec persist qui stampe', async () => {
      prismaMock.voucher.findFirst.mockResolvedValue({
        id: 'V1', status: VoucherState.ISSUED, amount: 2000, currency: 'XAF',
        validityEnd: new Date(Date.now() + 86_400_000),
        usageScope: VoucherUsageScope.SAME_COMPANY,
        customerId: null, recipientPhone: null,
      });
      prismaMock.ticket.findFirst.mockResolvedValue({
        id: 'TK1', tripId: 'Trip1', customerId: null, passengerPhone: null,
      });
      prismaMock.voucher.update.mockResolvedValue({ id: 'V1', status: 'REDEEMED' });
      const res = await service.redeem(tenantId, 'C1', 'TK1', actor);
      expect(workflowMock.transition).toHaveBeenCalled();
      expect(workflowMock.transition.mock.calls[0][1].action).toBe(VoucherAction.REDEEM);
      expect(workflowMock.transition.mock.calls[0][2].aggregateType).toBe('Voucher');
      expect(prismaMock.voucher.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          redeemedOnTicketId: 'TK1', redeemedById: 'U1',
        }),
      }));
      expect(res).toEqual({ voucherId: 'V1', amount: 2000, currency: 'XAF' });
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────────────

  it('cancel : appelle workflow.transition(CANCEL) et stampe cancelled*', async () => {
    const actor = { id: 'ADMIN', tenantId, roleId: 'R' } as any;
    prismaMock.voucher.findFirst.mockResolvedValue({
      id: 'V1', status: VoucherState.ISSUED,
      validityEnd: new Date(Date.now() + 86_400_000),
    });
    prismaMock.voucher.update.mockResolvedValue({ id: 'V1', status: 'CANCELLED' });
    workflowMock.transition.mockImplementation((_entity: any, _input: any, cfg: any) =>
      cfg.persist(_entity, 'CANCELLED', prismaMock),
    );
    await service.cancel(tenantId, 'V1', 'doublon', actor);
    expect(workflowMock.transition.mock.calls[0][1].action).toBe(VoucherAction.CANCEL);
    expect(prismaMock.voucher.update.mock.calls[0][0].data).toMatchObject({
      cancelledById: 'ADMIN', cancelledReason: 'doublon',
    });
  });
});
