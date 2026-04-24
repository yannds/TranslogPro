/**
 * CashierService — Gap #3 MIXED payment components.
 *
 * Valide :
 *   - MIXED sans components → BadRequest (ambigu)
 *   - Σ(components) ≠ amount → BadRequest (somme incohérente)
 *   - Composant MIXED imbriqué → BadRequest (récursivité interdite)
 *   - MIXED valide → Transaction parente + N TransactionComponent créés atomiquement
 *   - listTransactions() : MIXED déplié en totaux per-méthode effective (gap reconciliation)
 */
import { BadRequestException } from '@nestjs/common';
import { CashierService } from '../../../src/modules/cashier/cashier.service';

const TENANT = 'tenant-mix-001';
const REGISTER_ID = 'reg-001';
const ACTOR = { id: 'cashier-01', tenantId: TENANT, roleId: 'r1' } as any;

function makePrisma(opts: {
  register?:  unknown;
  existingTx?: unknown;
  components?: unknown[];
  plainTotals?: unknown[];
  mixedComponents?: unknown[];
} = {}) {
  const register = opts.register ?? {
    id: REGISTER_ID, agentId: ACTOR.id, agencyId: 'ag-1', status: 'OPEN', tenantId: TENANT,
  };
  const txCreate = jest.fn().mockResolvedValue({ id: 'tx-001' });
  const compCreate = jest.fn().mockResolvedValue({});
  return {
    cashRegister: {
      findFirst: jest.fn().mockResolvedValue(register),
    },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(opts.existingTx ?? null),
      create:    txCreate,
      count:     jest.fn().mockResolvedValue(0),
      findMany:  jest.fn().mockResolvedValue([]),
      groupBy:   jest.fn().mockResolvedValue(opts.plainTotals ?? []),
    },
    transactionComponent: {
      create:   compCreate,
      findMany: jest.fn().mockResolvedValue(opts.mixedComponents ?? []),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
}

function build(prisma: any) {
  return new CashierService(
    prisma,
    { record: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,  // workflow — non utilisé par recordTransaction
    {} as any,  // providers — non utilisé par recordTransaction
  );
}

describe('CashierService.recordTransaction — gap #3 MIXED components', () => {
  it('rejette MIXED sans components (ambigu)', async () => {
    const prisma = makePrisma();
    const svc = build(prisma);
    await expect(svc.recordTransaction(TENANT, REGISTER_ID, {
      type: 'TICKET', amount: 8000, paymentMethod: 'MIXED',
    } as any, ACTOR, undefined, { skipScopeCheck: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette si Σ(components) ≠ total', async () => {
    const prisma = makePrisma();
    const svc = build(prisma);
    await expect(svc.recordTransaction(TENANT, REGISTER_ID, {
      type: 'TICKET', amount: 8000, paymentMethod: 'MIXED',
      components: [
        { paymentMethod: 'CASH', amount: 5000 },
        { paymentMethod: 'MOBILE_MONEY', amount: 2000 }, // Σ=7000 ≠ 8000
      ],
    } as any, ACTOR, undefined, { skipScopeCheck: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un composant MIXED imbriqué (récursivité)', async () => {
    const prisma = makePrisma();
    const svc = build(prisma);
    await expect(svc.recordTransaction(TENANT, REGISTER_ID, {
      type: 'TICKET', amount: 5000, paymentMethod: 'MIXED',
      components: [
        { paymentMethod: 'MIXED', amount: 5000 },    // récursif interdit
      ],
    } as any, ACTOR, undefined, { skipScopeCheck: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('MIXED valide : Transaction parente + N composants créés atomiquement', async () => {
    const prisma = makePrisma();
    const svc = build(prisma);

    await svc.recordTransaction(TENANT, REGISTER_ID, {
      type: 'TICKET', amount: 8000, paymentMethod: 'MIXED',
      components: [
        { paymentMethod: 'CASH', amount: 5000, proofCode: undefined },
        { paymentMethod: 'MOBILE_MONEY', amount: 3000, proofCode: 'MOMO-X42' },
      ],
    } as any, ACTOR, undefined, { skipScopeCheck: true });

    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 8000, paymentMethod: 'MIXED' }),
      }),
    );
    expect(prisma.transactionComponent.create).toHaveBeenCalledTimes(2);
    expect(prisma.transactionComponent.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ paymentMethod: 'CASH', amount: 5000, sortOrder: 0 }),
    }));
    expect(prisma.transactionComponent.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ paymentMethod: 'MOBILE_MONEY', amount: 3000, sortOrder: 1, proofCode: 'MOMO-X42' }),
    }));
  });

  it('non-MIXED : composants ignorés même si fournis (comportement actuel préservé)', async () => {
    const prisma = makePrisma();
    const svc = build(prisma);

    await svc.recordTransaction(TENANT, REGISTER_ID, {
      type: 'TICKET', amount: 5000, paymentMethod: 'CASH',
      // Normalement pas de components pour CASH mais on ne rejette pas — ils sont simplement ignorés
      components: [{ paymentMethod: 'CASH', amount: 5000 }],
    } as any, ACTOR, undefined, { skipScopeCheck: true });

    expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.transactionComponent.create).not.toHaveBeenCalled();
  });
});

describe('CashierService.listTransactions — gap #3 MIXED reconciliation', () => {
  it('déplie les composants MIXED dans les totaux par méthode', async () => {
    const prisma = makePrisma({
      plainTotals: [
        { type: 'TICKET', paymentMethod: 'CASH',         _sum: { amount: 10000 } },
        { type: 'TICKET', paymentMethod: 'MOBILE_MONEY', _sum: { amount:  5000 } },
      ],
      mixedComponents: [
        { paymentMethod: 'CASH',         amount: 3000, transaction: { type: 'TICKET' } },
        { paymentMethod: 'MOBILE_MONEY', amount: 2000, transaction: { type: 'TICKET' } },
      ],
    });
    const svc = build(prisma);

    const res = await svc.listTransactions(TENANT, REGISTER_ID, {
      scope: 'tenant', tenantId: TENANT, userId: ACTOR.id, agencyId: 'ag-1',
    } as any);

    // CASH : 10000 plain + 3000 mixed-component = 13000
    const cashRow = res.totals.find((t: any) => t.paymentMethod === 'CASH' && t.type === 'TICKET');
    expect(cashRow?._sum.amount).toBe(13000);

    // MOBILE_MONEY : 5000 plain + 2000 mixed-component = 7000
    const momoRow = res.totals.find((t: any) => t.paymentMethod === 'MOBILE_MONEY' && t.type === 'TICKET');
    expect(momoRow?._sum.amount).toBe(7000);

    // Aucune ligne 'MIXED' résiduelle dans les totaux (elle est dépliée)
    expect(res.totals.find((t: any) => t.paymentMethod === 'MIXED')).toBeUndefined();
  });
});
