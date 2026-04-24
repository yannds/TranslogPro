/**
 * PayoutService — gap #4 tests unit.
 *
 * Vérifie la logique de dispatch gateway + idempotence + marquage metadata.
 * Le provider est mocké — pas d'appel HTTP réel.
 */
import { PayoutService } from '../../../src/infrastructure/payment/payout.service';
import { NotFoundException } from '@nestjs/common';

const TENANT = 'tenant-payout-001';
const REFUND_ID = 'refund-001';

function makePrisma(overrides: {
  refund?:         unknown;
  reversal?:       unknown;
  originalTx?:     unknown;
  updateFn?:       jest.Mock;
} = {}) {
  return {
    refund: {
      findFirst: jest.fn().mockResolvedValue(overrides.refund ?? {
        id: REFUND_ID, tenantId: TENANT, ticketId: 'ticket-001', amount: 8000, status: 'PROCESSED',
      }),
    },
    transaction: {
      findFirst: jest.fn()
        .mockResolvedValueOnce(overrides.reversal ?? {
          id: 'reversal-001', amount: -8000, externalRef: `refund:${REFUND_ID}`, metadata: {},
        })
        .mockResolvedValueOnce(overrides.originalTx ?? {
          id: 'orig-001', paymentMethod: 'MOBILE_MONEY', externalRef: 'FLW-ABC', metadata: { providerKey: 'flutterwave_agg' },
        }),
      update: overrides.updateFn ?? jest.fn().mockResolvedValue({}),
    },
  } as any;
}

function makeRegistry(provider: unknown) {
  return {
    get: jest.fn().mockReturnValue(provider),
  } as any;
}

describe('PayoutService.executeRefundPayout', () => {
  it('404 si refund introuvable', async () => {
    const prisma = makePrisma({ refund: null });
    prisma.refund.findFirst.mockResolvedValue(null);
    const svc = new PayoutService(prisma, makeRegistry({}));
    await expect(svc.executeRefundPayout(TENANT, REFUND_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('skip si refund status ≠ PROCESSED', async () => {
    const prisma = makePrisma({ refund: { id: REFUND_ID, tenantId: TENANT, status: 'PENDING' } });
    const svc = new PayoutService(prisma, makeRegistry({}));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('SKIPPED');
    expect(res.reason).toContain('PROCESSED');
  });

  it('skip si reversal Transaction introuvable', async () => {
    const prisma = makePrisma();
    prisma.transaction.findFirst = jest.fn().mockResolvedValue(null);
    const svc = new PayoutService(prisma, makeRegistry({}));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('SKIPPED');
  });

  it('skip si déjà exécuté (idempotent)', async () => {
    const prisma = makePrisma({
      reversal: { id: 'rev-1', amount: -8000, externalRef: 'ref', metadata: { payoutStatus: 'SUCCEEDED' } },
    });
    const svc = new PayoutService(prisma, makeRegistry({}));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('SKIPPED');
    expect(res.reason).toContain('idempotent');
  });

  it('skip si paiement originel CASH (rendu au guichet)', async () => {
    const prisma = makePrisma({
      originalTx: { id: 'orig', paymentMethod: 'CASH', externalRef: null, metadata: {} },
    });
    const svc = new PayoutService(prisma, makeRegistry({}));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('SKIPPED');
  });

  it('FAILED si externalRef manquant sur tx originale', async () => {
    const prisma = makePrisma({
      originalTx: { id: 'orig', paymentMethod: 'MOBILE_MONEY', externalRef: null, metadata: { providerKey: 'flw' } },
    });
    const svc = new PayoutService(prisma, makeRegistry({}));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('FAILED');
  });

  it('FAILED si providerKey absent du metadata', async () => {
    const prisma = makePrisma({
      originalTx: { id: 'orig', paymentMethod: 'MOBILE_MONEY', externalRef: 'FLW-X', metadata: {} },
    });
    const svc = new PayoutService(prisma, makeRegistry({}));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('FAILED');
    expect(res.reason).toContain('providerKey');
  });

  it('FAILED si provider non enregistré', async () => {
    const prisma = makePrisma();
    const registry = makeRegistry(undefined);  // get() renvoie undefined
    const svc = new PayoutService(prisma, registry);
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);
    expect(res.status).toBe('FAILED');
  });

  it('SUCCEEDED : appelle provider.refund + stamp payoutStatus=SUCCEEDED', async () => {
    const prisma = makePrisma();
    const updateFn = jest.fn().mockResolvedValue({});
    prisma.transaction.update = updateFn;

    const provider = {
      refund: jest.fn().mockResolvedValue({
        externalRef: 'FLW-REFUND-XYZ',
        status:      'SUCCESSFUL',
        amount:      8000,
      }),
    };

    const svc = new PayoutService(prisma, makeRegistry(provider));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);

    expect(provider.refund).toHaveBeenCalledWith(expect.objectContaining({
      externalRef: 'FLW-ABC',
      amount:      8000,
      reason:      `Refund ${REFUND_ID}`,
    }));
    expect(res.status).toBe('SUCCEEDED');
    expect(res.externalRef).toBe('FLW-REFUND-XYZ');

    // Stamp metadata
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalRef: 'FLW-REFUND-XYZ',
        metadata:    expect.objectContaining({ payoutStatus: 'SUCCEEDED', payoutProvider: 'flutterwave_agg' }),
      }),
    }));
  });

  it('FAILED : exception provider → stamp payoutStatus=FAILED + error msg', async () => {
    const prisma = makePrisma();
    const updateFn = jest.fn().mockResolvedValue({});
    prisma.transaction.update = updateFn;

    const provider = { refund: jest.fn().mockRejectedValue(new Error('Flutterwave 500')) };

    const svc = new PayoutService(prisma, makeRegistry(provider));
    const res = await svc.executeRefundPayout(TENANT, REFUND_ID);

    expect(res.status).toBe('FAILED');
    expect(res.reason).toContain('Flutterwave 500');
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          payoutStatus: 'FAILED',
          payoutError:  'Flutterwave 500',
        }),
      }),
    }));
  });
});
