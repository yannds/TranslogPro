/**
 * CashierService — Tests unitaires
 *
 * Ce qui est testé :
 *   - openRegister()       : ConflictException si déjà une caisse ouverte
 *   - closeRegister()      : ForbiddenException si scope=agency hors agence,
 *                            NotFoundException si caisse absente,
 *                            calcul finalBalance = initialBalance + somme transactions
 *   - recordTransaction()  : création transaction simple
 *   - getDailyReport()     : filtrage par date (gte/lte)
 *
 * Mock : PrismaService uniquement (pas de WorkflowEngine — CashierService n'en a pas)
 */

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CashierService } from '@modules/cashier/cashier.service';
import { PrismaService } from '@infra/database/prisma.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT   = 'tenant-cash-001';
const ACTOR    = { id: 'agent-01', tenantId: TENANT, roleId: 'role-cashier', agencyId: 'agency-01', roleName: 'Cashier' };
const REGISTER = {
  id:             'reg-001',
  tenantId:       TENANT,
  agencyId:       'agency-01',
  agentId:        'agent-01',
  auditStatus:    'OPEN',
  initialBalance: 50_000,
  finalBalance:   null,
  openedAt:       new Date(),
  closedAt:       null,
};

const DTO_OPEN = { agencyId: 'agency-01', openingBalance: 50_000 };

// ─── Mock factory ──────────────────────────────────────────────────────────────

function makePrisma(register = REGISTER): jest.Mocked<PrismaService> {
  return {
    cashRegister: {
      findFirst: jest.fn().mockResolvedValue(register),
      create:    jest.fn().mockResolvedValue(register),
      update:    jest.fn().mockResolvedValue({ ...register, auditStatus: 'CLOSED', finalBalance: 65_000 }),
      findMany:  jest.fn().mockResolvedValue([register]),
    },
    transaction: {
      create:    jest.fn().mockResolvedValue({ id: 'tx-001', amount: 15_000, type: 'TICKET_SALE' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 15_000 } }),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function buildService(prisma?: jest.Mocked<PrismaService>) {
  const p = prisma ?? makePrisma();
  return { service: new CashierService(p), prisma: p };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CashierService', () => {

  // ── openRegister() ─────────────────────────────────────────────────────────

  describe('openRegister()', () => {
    it('crée une caisse si aucune ouverte', async () => {
      const prisma = makePrisma();
      prisma.cashRegister.findFirst = jest.fn().mockResolvedValue(null); // pas de caisse ouverte
      const { service } = buildService(prisma);
      await service.openRegister(TENANT, DTO_OPEN as any, ACTOR as any);
      expect(prisma.cashRegister.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId:       TENANT,
            agentId:        ACTOR.id,
            initialBalance: DTO_OPEN.openingBalance,
          }),
        }),
      );
    });

    it('lève ConflictException si l\'agent a déjà une caisse ouverte', async () => {
      const { service } = buildService(); // findFirst retourne un register par défaut
      await expect(service.openRegister(TENANT, DTO_OPEN as any, ACTOR as any)).rejects.toThrow(ConflictException);
    });
  });

  // ── closeRegister() ────────────────────────────────────────────────────────

  describe('closeRegister()', () => {
    it('ferme la caisse et calcule finalBalance = initial + sum(transactions)', async () => {
      const { service, prisma } = buildService();
      const scope = { scope: 'tenant', agencyId: undefined };
      await service.closeRegister(TENANT, 'reg-001', ACTOR as any, scope as any);
      expect(prisma.transaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, cashRegisterId: 'reg-001' } }),
      );
      expect(prisma.cashRegister.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reg-001' },
          data:  expect.objectContaining({
            auditStatus:  'CLOSED',
            finalBalance: 65_000, // 50_000 + 15_000
          }),
        }),
      );
    });

    it('lève NotFoundException si aucune caisse ouverte avec cet id', async () => {
      const prisma = makePrisma();
      prisma.cashRegister.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService(prisma);
      const scope = { scope: 'tenant', agencyId: undefined };
      await expect(
        service.closeRegister(TENANT, 'absent', ACTOR as any, scope as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('lève ForbiddenException si scope=agency et agencyId ne correspond pas', async () => {
      const registerAutreAgence = { ...REGISTER, agencyId: 'agency-AUTRE' };
      const prisma = makePrisma(registerAutreAgence);
      const { service } = buildService(prisma);
      const scope = { scope: 'agency', agencyId: 'agency-01' };
      await expect(
        service.closeRegister(TENANT, 'reg-001', ACTOR as any, scope as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepte la clôture si scope=agency et agencyId correspond', async () => {
      const { service } = buildService();
      const scope = { scope: 'agency', agencyId: 'agency-01' };
      await expect(
        service.closeRegister(TENANT, 'reg-001', ACTOR as any, scope as any),
      ).resolves.toBeDefined();
    });

    it('finalBalance = initialBalance si aucune transaction (sum=null)', async () => {
      const prisma = makePrisma();
      prisma.transaction.aggregate = jest.fn().mockResolvedValue({ _sum: { amount: null } });
      const { service } = buildService(prisma);
      const scope = { scope: 'tenant', agencyId: undefined };
      await service.closeRegister(TENANT, 'reg-001', ACTOR as any, scope as any);
      expect(prisma.cashRegister.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ finalBalance: 50_000 }), // 50_000 + 0
        }),
      );
    });
  });

  // ── recordTransaction() ────────────────────────────────────────────────────

  describe('recordTransaction()', () => {
    it('crée une transaction avec les bons champs', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(TENANT, 'reg-001', 'TICKET_SALE', 15_000, 'CASH', 'ref-001');
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: {
          tenantId:       TENANT,
          cashRegisterId: 'reg-001',
          type:           'TICKET_SALE',
          amount:         15_000,
          paymentMethod:  'CASH',
          externalRef:    'ref-001',
        },
      });
    });

    it('crée sans externalRef si non fourni', async () => {
      const { service, prisma } = buildService();
      await service.recordTransaction(TENANT, 'reg-001', 'TICKET_SALE', 15_000, 'CASH');
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ externalRef: undefined }) }),
      );
    });
  });

  // ── getDailyReport() ───────────────────────────────────────────────────────

  describe('getDailyReport()', () => {
    it('filtre par agencyId et plage horaire 00:00–23:59', async () => {
      const { service, prisma } = buildService();
      const date = new Date('2026-05-01');
      await service.getDailyReport(TENANT, 'agency-01', date);
      const call = (prisma.cashRegister.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.tenantId).toBe(TENANT);
      expect(call.where.agencyId).toBe('agency-01');
      expect(call.where.openedAt.gte.getHours()).toBe(0);
      expect(call.where.openedAt.lte.getHours()).toBe(23);
    });
  });
});
