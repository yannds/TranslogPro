/**
 * CashierService — Tests unitaires (contrat Sprint 1 + audit sécurité).
 *
 * Ce qui est testé :
 *   - openRegister()       : création + conflit si déjà ouverte + audit.record
 *   - closeRegister()      : rapprochement, DISCREPANCY si écart, audit warn
 *   - recordTransaction()  :
 *       • TENANT ISOLATION — registerId d'un autre tenant → NotFound
 *       • status ≠ OPEN → BadRequest
 *       • scope 'own'    → register appartient à l'acteur
 *       • scope 'agency' → register appartient à l'agence
 *       • idempotence via externalRef
 *   - getMyOpenRegister()  : filtrage tenantId + agentId
 *   - listTransactions()   : scope own/agency refusé hors périmètre
 *   - getDailyReport()     : agrégats par type / méthode
 *
 * Mocks : PrismaService + AuditService — pas d'IO réelle.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CashierService } from '@modules/cashier/cashier.service';
import { PrismaService } from '@infra/database/prisma.service';
import { AuditService } from '@core/workflow/audit.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-cash-001';
const OTHER_TENANT = 'tenant-cash-OTHER';

const ACTOR = {
  id:        'agent-01',
  tenantId:  TENANT,
  roleId:    'role-cashier',
  agencyId:  'agency-01',
  roleName:  'Cashier',
};

const REGISTER = {
  id:             'reg-001',
  tenantId:       TENANT,
  agencyId:       'agency-01',
  agentId:        'agent-01',
  status:    'OPEN',
  initialBalance: 50_000,
  finalBalance:   null,
  openedAt:       new Date(),
  closedAt:       null,
};

const OPEN_DTO = { agencyId: 'agency-01', openingBalance: 50_000 };

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeAudit(): jest.Mocked<AuditService> {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
}

type RegisterFindFirstFn = (args: { where: { id?: string; tenantId?: string; agentId?: string; status?: string } }) => Promise<typeof REGISTER | null>;

function makePrisma(overrides: {
  register?:            typeof REGISTER | null;
  registerFindFirstFn?: RegisterFindFirstFn;
  txAggregateSum?:      number | null;
  txCount?:             number;
  txFindMany?:          unknown[];
  txCreate?:            Record<string, unknown>;
  txDup?:               Record<string, unknown> | null;
  groupBy?:             { type: string; paymentMethod: string; _sum: { amount: number | null } }[];
} = {}) {
  const reg = overrides.register === null
    ? null
    : (overrides.register ?? REGISTER);

  const cashRegisterFindFirst = overrides.registerFindFirstFn ?? jest.fn().mockResolvedValue(reg);

  return {
    cashRegister: {
      findFirst: cashRegisterFindFirst,
      create:    jest.fn().mockResolvedValue(reg ?? REGISTER),
      update:    jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...REGISTER, ...data })),
      findMany:  jest.fn().mockResolvedValue([{
        ...REGISTER,
        _count:       { transactions: 0 },
        transactions: [],
      }]),
    },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(overrides.txDup ?? null),
      create:    jest.fn().mockResolvedValue(overrides.txCreate ?? { id: 'tx-001', amount: 15_000 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: overrides.txAggregateSum ?? 15_000 } }),
      findMany:  jest.fn().mockResolvedValue(overrides.txFindMany ?? []),
      count:     jest.fn().mockResolvedValue(overrides.txCount ?? 0),
      groupBy:   jest.fn().mockResolvedValue(overrides.groupBy ?? []),
    },
    $transaction: jest.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as jest.Mocked<PrismaService>;
}

/**
 * Simule WorkflowEngine.transition : appelle la persist callback avec le VRAI
 * prisma mock (comme le ferait l'engine en prod avec le tx client). Le toState
 * est résolu depuis un mapping statique — correspond au WorkflowConfig seedé.
 */
function makeWorkflow(prisma: jest.Mocked<PrismaService>) {
  const transitionMap: Record<string, string> = {
    close: 'CLOSED', flag: 'DISCREPANCY', open: 'OPEN', resolve: 'CLOSED',
  };
  return {
    transition: jest.fn().mockImplementation(async (entity: any, input: any, config: any) => {
      const toState = transitionMap[input.action] ?? entity.status;
      const updated = await config.persist(entity, toState, prisma);
      return { entity: updated, toState, fromState: entity.status };
    }),
  } as any;
}

function makeProviderRegistry(opts: {
  verifyResult?: {
    status:   'SUCCESSFUL' | 'FAILED' | 'PENDING';
    amount:   number;
  };
  verifyThrows?: boolean;
  missingProvider?: boolean;
} = {}) {
  const provider = {
    verify: jest.fn().mockImplementation(async () => {
      if (opts.verifyThrows) throw new Error('provider unavailable');
      return opts.verifyResult ?? { status: 'SUCCESSFUL', amount: 15_000 };
    }),
  };
  return {
    get: jest.fn().mockImplementation(() => opts.missingProvider ? undefined : provider),
  } as any;
}

function buildService(
  prisma?: jest.Mocked<PrismaService>,
  audit?: jest.Mocked<AuditService>,
  providers?: any,
) {
  const p = prisma ?? makePrisma();
  const a = audit ?? makeAudit();
  const w = makeWorkflow(p);
  const r = providers ?? makeProviderRegistry();
  return {
    service: new CashierService(p, a, w, r),
    prisma: p, audit: a, workflow: w, providers: r,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CashierService', () => {

  // ── openRegister() ─────────────────────────────────────────────────────────
  describe('openRegister()', () => {
    it("crée la caisse + écrit un audit si aucune n'est ouverte", async () => {
      const prisma = makePrisma({ register: null });
      const audit = makeAudit();
      const { service } = buildService(prisma, audit);
      await service.openRegister(TENANT, OPEN_DTO, ACTOR as any, '127.0.0.1');
      expect(prisma.cashRegister.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT, agentId: ACTOR.id }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: TENANT, action: 'data.cashier.open.own', userId: ACTOR.id,
      }));
    });

    it("lève Conflict si l'agent a déjà une caisse ouverte", async () => {
      const { service } = buildService();
      await expect(service.openRegister(TENANT, OPEN_DTO, ACTOR as any))
        .rejects.toThrow(ConflictException);
    });
  });

  // ── closeRegister() ────────────────────────────────────────────────────────
  describe('closeRegister()', () => {
    it('CLOSED si countedBalance match et DISCREPANCY si écart', async () => {
      const { service, prisma } = buildService();
      const scope = { scope: 'tenant', userId: ACTOR.id, tenantId: TENANT, agencyId: undefined } as any;
      await service.closeRegister(TENANT, REGISTER.id, { countedBalance: 65_000 }, ACTOR as any, scope);
      expect(prisma.cashRegister.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', finalBalance: 65_000 }) }),
      );

      const { service: svc2, prisma: prisma2 } = buildService();
      await svc2.closeRegister(TENANT, REGISTER.id, { countedBalance: 64_500 }, ACTOR as any, scope);
      expect(prisma2.cashRegister.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DISCREPANCY', finalBalance: 64_500 }) }),
      );
    });

    it('lève NotFound si caisse absente', async () => {
      const prisma = makePrisma({ register: null });
      const { service } = buildService(prisma);
      const scope = { scope: 'tenant', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.closeRegister(TENANT, 'absent', {}, ACTOR as any, scope))
        .rejects.toThrow(NotFoundException);
    });

    it('lève Forbidden si scope=agency et agencyId ≠ register.agencyId', async () => {
      const prisma = makePrisma({ register: { ...REGISTER, agencyId: 'agency-AUTRE' } });
      const { service } = buildService(prisma);
      const scope = { scope: 'agency', agencyId: 'agency-01', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.closeRegister(TENANT, REGISTER.id, {}, ACTOR as any, scope))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // ── resolveDiscrepancy() — workflow DISCREPANCY → CLOSED avec justification
  describe('resolveDiscrepancy()', () => {
    const discrepancyReg = {
      ...REGISTER,
      status:       'DISCREPANCY',
      finalBalance: 63_000,   // théorique = 50_000 + 15_000 = 65_000, écart = -2000
    };
    const tenantScope = { scope: 'tenant', userId: ACTOR.id, tenantId: TENANT } as any;

    it('résout l\'écart avec justification + audit level warn + update resolutionNote', async () => {
      const prisma = makePrisma({ register: discrepancyReg as any });
      const { service, audit } = buildService(prisma);
      await service.resolveDiscrepancy(
        TENANT,
        REGISTER.id,
        { resolutionNote: 'Billet 2000 XAF retrouvé sous le tiroir à 18h15' },
        ACTOR as any,
        tenantScope,
      );
      expect(prisma.cashRegister.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status:         'CLOSED',
            resolutionNote: 'Billet 2000 XAF retrouvé sous le tiroir à 18h15',
            resolvedById:   ACTOR.id,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'data.cashier.resolve.agency',
        level:  'warn',
        newValue: expect.objectContaining({ status: 'CLOSED' }),
      }));
    });

    it('refuse la résolution si caisse n\'est pas DISCREPANCY (BadRequest)', async () => {
      const prisma = makePrisma({ register: { ...REGISTER, status: 'CLOSED' } });
      const { service } = buildService(prisma);
      await expect(service.resolveDiscrepancy(
        TENANT, REGISTER.id,
        { resolutionNote: 'Justification valide suffisamment longue' },
        ACTOR as any, tenantScope,
      )).rejects.toThrow(BadRequestException);
    });

    it('lève Forbidden si scope=agency et agencyId ≠ register.agencyId', async () => {
      const prisma = makePrisma({ register: { ...discrepancyReg, agencyId: 'agency-x' } as any });
      const { service } = buildService(prisma);
      const scope = { scope: 'agency', agencyId: 'agency-01', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.resolveDiscrepancy(
        TENANT, REGISTER.id,
        { resolutionNote: 'Justification valide suffisamment longue' },
        ACTOR as any, scope,
      )).rejects.toThrow(ForbiddenException);
    });

    it('lève NotFound si caisse absente', async () => {
      const prisma = makePrisma({ register: null });
      const { service } = buildService(prisma);
      await expect(service.resolveDiscrepancy(
        TENANT, 'absent',
        { resolutionNote: 'Justification valide suffisamment longue' },
        ACTOR as any, tenantScope,
      )).rejects.toThrow(NotFoundException);
    });
  });

  // ── verifyTransactionProof() — vérification post-saisie contre provider ──
  describe('verifyTransactionProof()', () => {
    const TX = {
      id:            'tx-momo-1',
      tenantId:      TENANT,
      cashRegisterId: REGISTER.id,
      amount:        15_000,
      paymentMethod: 'MOBILE_MONEY',
      proofCode:     'MP260524.OK',
      proofType:     'MOMO_CODE',
      proofVerifiedStatus: null,
    };

    function makePrismaForVerify(tx: any) {
      const base = makePrisma();
      (base.transaction as any).findFirst = jest.fn().mockResolvedValue(tx);
      (base.transaction as any).update    = jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...tx, ...data }),
      );
      return base;
    }

    it('VERIFIED quand provider répond SUCCESSFUL + amount match', async () => {
      const prisma = makePrismaForVerify(TX);
      const providers = makeProviderRegistry({
        verifyResult: { status: 'SUCCESSFUL', amount: 15_000 },
      });
      const { service, audit } = buildService(prisma, undefined, providers);
      const res = await service.verifyTransactionProof(
        TENANT, TX.id, 'mtn-momo-cg', ACTOR as any,
      );
      expect((res as any).proofVerifiedStatus).toBe('VERIFIED');
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proofVerifiedStatus: 'VERIFIED' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'data.cashier.proof.verify.agency',
        level:  'info',
      }));
    });

    it('FAILED quand montant provider ≠ montant transaction', async () => {
      const prisma = makePrismaForVerify(TX);
      const providers = makeProviderRegistry({
        verifyResult: { status: 'SUCCESSFUL', amount: 10_000 }, // ≠ 15 000
      });
      const { service, audit } = buildService(prisma, undefined, providers);
      await service.verifyTransactionProof(TENANT, TX.id, 'mtn-momo-cg', ACTOR as any);
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proofVerifiedStatus: 'FAILED' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
    });

    it('PENDING quand provider throw (injoignable) — retry plus tard', async () => {
      const prisma = makePrismaForVerify(TX);
      const providers = makeProviderRegistry({ verifyThrows: true });
      const { service } = buildService(prisma, undefined, providers);
      await service.verifyTransactionProof(TENANT, TX.id, 'mtn-momo-cg', ACTOR as any);
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proofVerifiedStatus: 'PENDING' }),
        }),
      );
    });

    it('idempotence — re-verifier VERIFIED ne rappelle pas le provider', async () => {
      const verified = { ...TX, proofVerifiedStatus: 'VERIFIED' };
      const prisma = makePrismaForVerify(verified);
      const providers = makeProviderRegistry();
      const { service } = buildService(prisma, undefined, providers);
      await service.verifyTransactionProof(TENANT, TX.id, 'mtn-momo-cg', ACTOR as any);
      expect(providers.get).not.toHaveBeenCalled();
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('BadRequest si transaction sans proofCode', async () => {
      const prisma = makePrismaForVerify({ ...TX, proofCode: null });
      const { service } = buildService(prisma);
      await expect(service.verifyTransactionProof(
        TENANT, TX.id, 'mtn-momo-cg', ACTOR as any,
      )).rejects.toThrow(BadRequestException);
    });

    it('BadRequest si providerKey inconnu', async () => {
      const prisma = makePrismaForVerify(TX);
      const providers = makeProviderRegistry({ missingProvider: true });
      const { service } = buildService(prisma, undefined, providers);
      await expect(service.verifyTransactionProof(
        TENANT, TX.id, 'inexistant', ACTOR as any,
      )).rejects.toThrow(BadRequestException);
    });

    it('NotFound si transaction absente (tenant isolation)', async () => {
      const prisma = makePrismaForVerify(null);
      const { service } = buildService(prisma);
      await expect(service.verifyTransactionProof(
        TENANT, 'ghost', 'mtn-momo-cg', ACTOR as any,
      )).rejects.toThrow(NotFoundException);
    });
  });

  // ── recordTransaction() — AUDIT SÉCURITÉ ──────────────────────────────────
  describe('recordTransaction() — tenant isolation + scopes', () => {
    const dto = {
      type:          'TICKET' as const,
      amount:        15_000,
      paymentMethod: 'CASH' as const,
      externalRef:   'ticket:t-1',
      referenceType: 'TICKET',
      referenceId:   't-1',
    };

    it('TENANT ISOLATION — register d\'un autre tenant → NotFound (pas de leak)', async () => {
      // Le where { id, tenantId } retourne null côté prisma réel ; on simule.
      const prisma = makePrisma({ register: null });
      const { service } = buildService(prisma);
      await expect(service.recordTransaction(OTHER_TENANT, REGISTER.id, dto, ACTOR as any))
        .rejects.toThrow(NotFoundException);
      // Aucune écriture ne doit fuiter
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('BadRequest si caisse fermée', async () => {
      const prisma = makePrisma({ register: { ...REGISTER, status: 'CLOSED' } });
      const { service } = buildService(prisma);
      await expect(service.recordTransaction(TENANT, REGISTER.id, dto, ACTOR as any))
        .rejects.toThrow(BadRequestException);
    });

    it("scope 'own' — rejette si le register n'appartient pas à l'acteur", async () => {
      const prisma = makePrisma({ register: { ...REGISTER, agentId: 'autre-agent' } });
      const { service } = buildService(prisma);
      const scope = { scope: 'own', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.recordTransaction(TENANT, REGISTER.id, dto, ACTOR as any, scope))
        .rejects.toThrow(ForbiddenException);
    });

    it("scope 'agency' — rejette si l'agence du register diffère", async () => {
      const prisma = makePrisma({ register: { ...REGISTER, agencyId: 'ag-autre' } });
      const { service } = buildService(prisma);
      const scope = { scope: 'agency', agencyId: 'agency-01', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.recordTransaction(TENANT, REGISTER.id, dto, ACTOR as any, scope))
        .rejects.toThrow(ForbiddenException);
    });

    it('crée la transaction + audit', async () => {
      const { service, prisma, audit } = buildService();
      const scope = { scope: 'own', userId: ACTOR.id, tenantId: TENANT } as any;
      await service.recordTransaction(TENANT, REGISTER.id, dto, ACTOR as any, scope);
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            cashRegisterId: REGISTER.id,
            type:          'TICKET',
            amount:        15_000,
            paymentMethod: 'CASH',
            externalRef:   'ticket:t-1',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'data.cashier.transaction.own',
      }));
    });

    it('idempotence — retourne TX existante si externalRef dup', async () => {
      const dup = { id: 'tx-dup', amount: 15_000 };
      const prisma = makePrisma({ txDup: dup });
      const { service } = buildService(prisma);
      const res = await service.recordTransaction(TENANT, REGISTER.id, dto, ACTOR as any);
      expect(res).toEqual(dup);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('refund → audit level warn', async () => {
      const { service, audit } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...dto, type: 'REFUND', externalRef: 'refund:1' },
        ACTOR as any,
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
    });
  });

  // ── recordTransaction() — ESPÈCES tendered/change ─────────────────────────
  describe('recordTransaction() — espèces (tendered/change)', () => {
    const baseCash = {
      type:          'TICKET' as const,
      amount:        8_000,
      paymentMethod: 'CASH' as const,
      externalRef:   'ticket:cash-1',
      referenceType: 'TICKET',
      referenceId:   't-cash-1',
    };

    it('CASH + tendered > amount → persiste tenderedAmount + changeAmount (scénario 10000/8000/2000)', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseCash, tenderedAmount: 10_000 },
        ACTOR as any,
      );
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount:         8_000,
            tenderedAmount: 10_000,
            changeAmount:   2_000,
          }),
        }),
      );
    });

    it('CASH + tendered === amount → changeAmount = 0', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseCash, tenderedAmount: 8_000 },
        ACTOR as any,
      );
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenderedAmount: 8_000, changeAmount: 0 }),
        }),
      );
    });

    it('CASH + tendered < amount → BadRequest (rien n\'est créé)', async () => {
      const { service, prisma } = buildService();
      await expect(service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseCash, tenderedAmount: 5_000 },
        ACTOR as any,
      )).rejects.toThrow(BadRequestException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('batchTotal utilisé pour la validation et le calcul de monnaie (N tickets)', async () => {
      const { service, prisma } = buildService();
      // 1re tx d'un batch : amount = prix 1er ticket (3000), batchTotal = 8000, tendered = 10000
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseCash, amount: 3_000, tenderedAmount: 10_000, batchTotal: 8_000 },
        ACTOR as any,
      );
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount:         3_000,       // prix du ticket individuel, pas du batch
            tenderedAmount: 10_000,
            changeAmount:   2_000,       // = tendered - batchTotal, pas tendered - amount
          }),
        }),
      );
    });

    it('MOBILE_MONEY → tenderedAmount ignoré (pas de monnaie à rendre)', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseCash, paymentMethod: 'MOBILE_MONEY', tenderedAmount: 10_000 },
        ACTOR as any,
      );
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod:  'MOBILE_MONEY',
            tenderedAmount: null,
            changeAmount:   null,
          }),
        }),
      );
    });

    it('CASH sans tendered → tenderedAmount et changeAmount restent null (rétro-compat)', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(TENANT, REGISTER.id, baseCash, ACTOR as any);
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenderedAmount: null, changeAmount: null }),
        }),
      );
    });
  });

  // ── recordTransaction() — PREUVE paiement hors-POS (proofCode/proofType) ──
  describe('recordTransaction() — preuve paiement hors-POS', () => {
    const baseMomo = {
      type:          'TICKET' as const,
      amount:        12_000,
      paymentMethod: 'MOBILE_MONEY' as const,
      externalRef:   'ticket:momo-1',
      referenceType: 'TICKET',
      referenceId:   't-momo-1',
    };

    it('MOBILE_MONEY + proofCode → persiste proofCode + proofType', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseMomo, proofCode: 'MP260524.ABC123', proofType: 'MOMO_CODE' },
        ACTOR as any,
      );
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: 'MOBILE_MONEY',
            proofCode:     'MP260524.ABC123',
            proofType:     'MOMO_CODE',
          }),
        }),
      );
    });

    it('CASH + proofCode → proofCode est IGNORÉ (cash n\'a pas besoin de preuve)', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        {
          ...baseMomo,
          paymentMethod: 'CASH',
          proofCode:     'DOIT-ETRE-IGNORE',
          proofType:     'MOMO_CODE',
        },
        ACTOR as any,
      );
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: 'CASH',
            proofCode:     null,
            proofType:     null,
          }),
        }),
      );
    });

    it('MOBILE_MONEY sans proofCode → proofCode null (rétro-compat portail/webhook)', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(TENANT, REGISTER.id, baseMomo, ACTOR as any);
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proofCode: null, proofType: null }),
        }),
      );
    });

    it('audit enregistre proofCode + proofType dans newValue', async () => {
      const { service, audit } = buildService();
      await service.recordTransaction(
        TENANT, REGISTER.id,
        { ...baseMomo, proofCode: 'CARD-AUTH-42', proofType: 'CARD_AUTH' },
        ACTOR as any,
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        newValue: expect.objectContaining({
          proofCode: 'CARD-AUTH-42',
          proofType: 'CARD_AUTH',
        }),
      }));
    });
  });

  // ── listTransactions() ─────────────────────────────────────────────────────
  describe('listTransactions() — scope', () => {
    it("scope 'own' rejette si register pas au user", async () => {
      const prisma = makePrisma({ register: { ...REGISTER, agentId: 'autre' } });
      const { service } = buildService(prisma);
      const scope = { scope: 'own', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.listTransactions(TENANT, REGISTER.id, scope))
        .rejects.toThrow(ForbiddenException);
    });

    it("scope 'agency' rejette si register pas à l'agence", async () => {
      const prisma = makePrisma({ register: { ...REGISTER, agencyId: 'ag-x' } });
      const { service } = buildService(prisma);
      const scope = { scope: 'agency', agencyId: 'agency-01', userId: ACTOR.id, tenantId: TENANT } as any;
      await expect(service.listTransactions(TENANT, REGISTER.id, scope))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // ── getDailyReport() ───────────────────────────────────────────────────────
  describe('getDailyReport()', () => {
    it('agrège par type et par méthode', async () => {
      const prisma = makePrisma();
      (prisma.cashRegister.findMany as jest.Mock).mockResolvedValue([{
        ...REGISTER,
        _count: { transactions: 2 },
        transactions: [
          { type: 'TICKET', amount: 10_000, paymentMethod: 'CASH' },
          { type: 'REFUND', amount: -3_000, paymentMethod: 'MOBILE_MONEY' },
        ],
      }]);
      const { service } = buildService(prisma);
      const res = await service.getDailyReport(TENANT, 'agency-01', new Date('2026-05-01'));
      expect(res.totals.byType.TICKET).toBe(10_000);
      expect(res.totals.byType.REFUND).toBe(-3_000);
      expect(res.totals.byMethod.CASH).toBe(10_000);
      expect(res.totals.byMethod.MOBILE_MONEY).toBe(-3_000);
      expect(res.totals.grossTotal).toBe(7_000);
    });
  });
});
