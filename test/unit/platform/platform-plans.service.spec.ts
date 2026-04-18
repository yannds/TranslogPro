/**
 * PlatformPlansService — tests unitaires
 *
 * Couvre :
 *   - create : slug unique, conflit 409
 *   - update : moduleKeys remplace l'ensemble (deleteMany + create)
 *   - remove : soft-delete si tenants/subscriptions > 0, hard sinon
 *   - attachModule / detachModule : idempotent
 *   - listCatalog : retourne uniquement isActive && isPublic
 */

import { PlatformPlansService } from '../../../src/modules/platform-plans/platform-plans.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    plan: {
      findUnique: jest.fn(),
      findMany:   jest.fn().mockResolvedValue([]),
      create:     jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'plan-1', modules: [], ...args.data })),
      update:     jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'plan-1', modules: [], ...args.data })),
      delete:     jest.fn().mockResolvedValue({ id: 'plan-1' }),
    },
    planModule: {
      create:     jest.fn().mockResolvedValue({ id: 'pm-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
}

describe('PlatformPlansService', () => {
  describe('create', () => {
    it('crée un plan avec modules associés', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue(null);
      const svc = new PlatformPlansService(prisma as never);

      await svc.create({
        slug:         'pro',
        name:         'Pro',
        price:        99,
        currency:     'EUR',
        billingCycle: 'MONTHLY',
        moduleKeys:   ['YIELD_ENGINE', 'GARAGE_PRO'],
      });

      expect(prisma.plan.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          slug: 'pro',
          modules: { create: [{ moduleKey: 'YIELD_ENGINE' }, { moduleKey: 'GARAGE_PRO' }] },
        }),
      }));
    });

    it('rejette un slug déjà existant (409)', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({ id: 'existing', slug: 'pro' });
      const svc = new PlatformPlansService(prisma as never);

      await expect(svc.create({
        slug: 'pro', name: 'Pro', price: 99, currency: 'EUR', billingCycle: 'MONTHLY',
      })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('moduleKeys fourni → remplace entièrement les modules (deleteMany + create)', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({ id: 'plan-1', slug: 'pro' });
      const svc = new PlatformPlansService(prisma as never);

      await svc.update('plan-1', { moduleKeys: ['YIELD_ENGINE'] });

      expect(prisma.plan.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'plan-1' },
        data: expect.objectContaining({
          modules: {
            deleteMany: {},
            create: [{ moduleKey: 'YIELD_ENGINE' }],
          },
        }),
      }));
    });

    it('moduleKeys absent → ne touche pas aux modules existants', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({ id: 'plan-1', slug: 'pro' });
      const svc = new PlatformPlansService(prisma as never);

      await svc.update('plan-1', { name: 'Pro+' });

      const call = prisma.plan.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data).not.toHaveProperty('modules');
    });

    it('404 si plan inconnu', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue(null);
      const svc = new PlatformPlansService(prisma as never);

      await expect(svc.update('ghost', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove — soft vs hard delete', () => {
    it('soft-delete (isActive=false) si des tenants utilisent le plan', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-1', _count: { tenants: 3, subscriptions: 5 },
      });
      const svc = new PlatformPlansService(prisma as never);

      await svc.remove('plan-1');

      expect(prisma.plan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data:  { isActive: false, isPublic: false },
      });
      expect(prisma.plan.delete).not.toHaveBeenCalled();
    });

    it('hard-delete si aucun tenant ni souscription', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-1', _count: { tenants: 0, subscriptions: 0 },
      });
      const svc = new PlatformPlansService(prisma as never);

      const res = await svc.remove('plan-1');

      expect(prisma.plan.delete).toHaveBeenCalledWith({ where: { id: 'plan-1' } });
      expect(res).toEqual({ id: 'plan-1', deleted: true });
    });
  });

  describe('attachModule / detachModule', () => {
    it('rejette un moduleKey qui n\'est pas UPPER_SNAKE_CASE', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({ id: 'plan-1' });
      const svc = new PlatformPlansService(prisma as never);

      await expect(svc.attachModule('plan-1', 'yield_engine')).rejects.toThrow(BadRequestException);
      await expect(svc.attachModule('plan-1', 'Yield Engine')).rejects.toThrow(BadRequestException);
    });

    it('attach est idempotent (catch silent unique constraint)', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({ id: 'plan-1' });
      prisma.planModule.create = jest.fn().mockRejectedValue(new Error('unique constraint'));
      const svc = new PlatformPlansService(prisma as never);

      // Ne doit pas throw malgré l'erreur unique
      await expect(svc.attachModule('plan-1', 'YIELD_ENGINE')).resolves.toBeDefined();
    });

    it('detach supprime la ligne correspondante', async () => {
      const prisma = createPrismaMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({ id: 'plan-1' });
      const svc = new PlatformPlansService(prisma as never);

      await svc.detachModule('plan-1', 'YIELD_ENGINE');
      expect(prisma.planModule.deleteMany).toHaveBeenCalledWith({
        where: { planId: 'plan-1', moduleKey: 'YIELD_ENGINE' },
      });
    });
  });

  describe('listCatalog', () => {
    it('filtre uniquement isActive && isPublic', async () => {
      const prisma = createPrismaMock();
      const svc = new PlatformPlansService(prisma as never);

      await svc.listCatalog();
      expect(prisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { isActive: true, isPublic: true },
      }));
    });
  });
});
