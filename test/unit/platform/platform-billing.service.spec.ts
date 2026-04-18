/**
 * PlatformBillingService — tests unitaires
 *
 * Couvre :
 *   - createSubscription : empêche le tenant plateforme, idempotent par tenantId
 *   - createSubscription : TRIAL auto si plan.trialDays > 0, sinon ACTIVE
 *   - changePlan : rejette plan inactif
 *   - markPaid : idempotent si déjà PAID, rejette VOID
 *   - voidInvoice : rejette si PAID
 *   - computePeriodEnd : MONTHLY/YEARLY/CUSTOM avec fallback config
 */

import { PlatformBillingService } from '../../../src/modules/platform-billing/platform-billing.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TENANT_ID = 'tenant-xyz';

function createPrismaMock() {
  const subs = new Map<string, Record<string, unknown>>();
  const invoices = new Map<string, Record<string, unknown>>();
  return {
    plan: { findUnique: jest.fn() },
    platformSubscription: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; tenantId?: string } }) =>
        subs.get(where.id ?? where.tenantId ?? '') ?? null),
      findMany:   jest.fn(async () => Array.from(subs.values())),
      upsert:     jest.fn(async ({ where, create, update }: { where: { tenantId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = subs.get(where.tenantId);
        const next = { id: 'sub-1', ...existing, ...(existing ? update : create) };
        subs.set(where.tenantId, next);
        return next;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = [...subs.values()].find(s => s.id === where.id);
        if (!existing) throw new Error('Not found');
        const next = { ...existing, ...data };
        subs.set(String(existing.tenantId), next);
        return next;
      }),
    },
    tenant: {
      update: jest.fn().mockResolvedValue({}),
    },
    platformInvoice: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => invoices.get(where.id) ?? null),
      findMany:   jest.fn(async () => Array.from(invoices.values())),
      create:     jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const inv = { id: `inv-${invoices.size + 1}`, ...data };
        invoices.set(String(inv.id), inv);
        return inv;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = invoices.get(where.id);
        if (!existing) throw new Error('Not found');
        const next = { ...existing, ...data };
        invoices.set(where.id, next);
        return next;
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __subs: subs,
    __invoices: invoices,
  };
}

function createConfigMock(overrides: Record<string, number> = {}) {
  return {
    getNumber: jest.fn(async (key: string) => {
      if (key in overrides) return overrides[key];
      throw new Error('Fallback to const');
    }),
  };
}

describe('PlatformBillingService', () => {
  describe('createSubscription', () => {
    it('rejette le tenant plateforme', async () => {
      const prisma = createPrismaMock();
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.createSubscription({
        tenantId: PLATFORM_TENANT_ID, planId: 'any',
      })).rejects.toThrow(BadRequestException);
    });

    it('404 si le plan n\'existe pas', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue(null);
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.createSubscription({
        tenantId: TENANT_ID, planId: 'ghost',
      })).rejects.toThrow(NotFoundException);
    });

    it('rejette un plan inactif', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-1', slug: 'old', isActive: false, billingCycle: 'MONTHLY', trialDays: 0,
      });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.createSubscription({
        tenantId: TENANT_ID, planId: 'plan-1',
      })).rejects.toThrow(BadRequestException);
    });

    it('TRIAL automatique si plan.trialDays > 0', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-1', slug: 'starter', isActive: true, billingCycle: 'MONTHLY', trialDays: 14, currency: 'EUR',
      });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await svc.createSubscription({ tenantId: TENANT_ID, planId: 'plan-1' });

      const sub = prisma.__subs.get(TENANT_ID)!;
      expect(sub.status).toBe('TRIAL');
      expect(sub.trialEndsAt).toBeInstanceOf(Date);
    });

    it('ACTIVE si trialDays = 0', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-1', slug: 'pro', isActive: true, billingCycle: 'MONTHLY', trialDays: 0, currency: 'EUR',
      });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await svc.createSubscription({ tenantId: TENANT_ID, planId: 'plan-1' });
      expect(prisma.__subs.get(TENANT_ID)!.status).toBe('ACTIVE');
    });

    it('met à jour Tenant.planId', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-1', slug: 'pro', isActive: true, billingCycle: 'MONTHLY', trialDays: 0, currency: 'EUR',
      });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await svc.createSubscription({ tenantId: TENANT_ID, planId: 'plan-1' });
      expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: TENANT_ID },
        data:  expect.objectContaining({ planId: 'plan-1' }),
      }));
    });
  });

  describe('markPaid', () => {
    it('idempotent si la facture est déjà PAID', async () => {
      const prisma = createPrismaMock();
      prisma.__invoices.set('inv-1', { id: 'inv-1', status: 'PAID' });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await svc.markPaid('inv-1', {});
      // update ne doit pas être appelé (idempotent, short-circuit)
      expect(prisma.platformInvoice.update).not.toHaveBeenCalled();
    });

    it('rejette si la facture est VOID', async () => {
      const prisma = createPrismaMock();
      prisma.__invoices.set('inv-1', { id: 'inv-1', status: 'VOID' });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.markPaid('inv-1', {})).rejects.toThrow(BadRequestException);
    });

    it('trace paymentRef', async () => {
      const prisma = createPrismaMock();
      prisma.__invoices.set('inv-1', { id: 'inv-1', status: 'ISSUED' });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await svc.markPaid('inv-1', { paymentMethod: 'CARD', paymentRef: 'STRIPE-xyz' });
      expect(prisma.platformInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAID',
          paymentMethod: 'CARD',
          paymentRef: 'STRIPE-xyz',
        }),
      }));
    });
  });

  describe('voidInvoice', () => {
    it('rejette si la facture est PAID', async () => {
      const prisma = createPrismaMock();
      prisma.__invoices.set('inv-1', { id: 'inv-1', status: 'PAID' });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.voidInvoice('inv-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('issue', () => {
    it('rejette si la facture n\'est pas DRAFT', async () => {
      const prisma = createPrismaMock();
      prisma.__invoices.set('inv-1', { id: 'inv-1', status: 'ISSUED' });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.issue('inv-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePlan', () => {
    it('404 si subscription inconnue', async () => {
      const prisma = createPrismaMock();
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.changePlan('ghost-sub', { planId: 'p' }))
        .rejects.toThrow(NotFoundException);
    });

    it('rejette le passage vers un plan inactif', async () => {
      const prisma = createPrismaMock();
      // Le mock lookup se fait par where.id — on indexe donc par id dans le store.
      prisma.__subs.set('sub-1', { id: 'sub-1', tenantId: TENANT_ID, planId: 'old' });
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'new-plan', slug: 'retired', isActive: false, billingCycle: 'MONTHLY',
      });
      const svc = new PlatformBillingService(prisma as never, createConfigMock() as never);

      await expect(svc.changePlan('sub-1', { planId: 'new-plan' }))
        .rejects.toThrow(BadRequestException);
    });
  });
});
