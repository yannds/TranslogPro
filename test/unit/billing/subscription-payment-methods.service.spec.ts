import { NotFoundException } from '@nestjs/common';
import { SubscriptionPaymentMethodsService } from '../../../src/modules/subscription-checkout/subscription-payment-methods.service';
import type { SavedMethodEntry } from '../../../src/modules/subscription-checkout/subscription-reconciliation.service';

function createPrismaMock(externalRefs: unknown) {
  return {
    platformSubscription: {
      findUnique: jest.fn().mockResolvedValue({ id: 'sub1', externalRefs }),
      update:     jest.fn().mockResolvedValue({}),
    },
  };
}

const TENANT_ID = 'tenant-1';

describe('SubscriptionPaymentMethodsService', () => {
  const baseMethod = (patch: Partial<SavedMethodEntry> = {}): SavedMethodEntry => ({
    id:          'pm_base',
    method:      'CARD',
    provider:    'stripe',
    brand:       'VISA',
    last4:       '4242',
    maskedPhone: null,
    tokenRef:    'tok_abc',
    customerRef: 'cus_abc',
    isDefault:   false,
    lastUsedAt:  '2026-04-20T10:00:00Z',
    createdAt:   '2026-04-01T10:00:00Z',
    ...patch,
  });

  describe('list', () => {
    it('returns [] if no subscription externalRefs', async () => {
      const prisma = createPrismaMock({});
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      expect(await svc.list(TENANT_ID)).toEqual([]);
    });

    it('returns savedMethods sorted : default first, then lastUsedAt desc', async () => {
      const methods = [
        baseMethod({ id: 'm1', isDefault: false, lastUsedAt: '2026-04-10T00:00:00Z' }),
        baseMethod({ id: 'm2', isDefault: true,  lastUsedAt: '2026-04-20T00:00:00Z' }),
        baseMethod({ id: 'm3', isDefault: false, lastUsedAt: '2026-04-22T00:00:00Z' }),
      ];
      const prisma = createPrismaMock({ savedMethods: methods });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      const out = await svc.list(TENANT_ID);
      expect(out.map(m => m.id)).toEqual(['m2', 'm3', 'm1']); // default → m2 first, then m3 (recent), m1
    });

    it('legacy fallback : builds a single entry from lastMethod when savedMethods absent', async () => {
      const prisma = createPrismaMock({
        lastMethod:     'MOBILE_MONEY',
        lastProvider:   'wave',
        methodLast4:    null,
        methodToken:    'tok_legacy',
        lastSuccessAt:  '2026-04-15T00:00:00Z',
      });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      const out = await svc.list(TENANT_ID);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe('legacy');
      expect(out[0].method).toBe('MOBILE_MONEY');
      expect(out[0].isDefault).toBe(true);
    });

    it('throws NotFound si aucune souscription', async () => {
      const prisma = {
        platformSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
      } as any;
      const svc = new SubscriptionPaymentMethodsService(prisma);
      await expect(svc.list('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setDefault', () => {
    it('throws NotFound if method id absent', async () => {
      const prisma = createPrismaMock({ savedMethods: [baseMethod({ id: 'm1' })] });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await expect(svc.setDefault(TENANT_ID, 'inexistant')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('no-op si la méthode est déjà default', async () => {
      const prisma = createPrismaMock({
        savedMethods: [baseMethod({ id: 'm1', isDefault: true })],
      });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await svc.setDefault(TENANT_ID, 'm1');
      expect(prisma.platformSubscription.update).not.toHaveBeenCalled();
    });

    it('promeut correctement (flip isDefault sur tous)', async () => {
      const methods = [
        baseMethod({ id: 'm1', isDefault: true  }),
        baseMethod({ id: 'm2', isDefault: false }),
      ];
      const prisma = createPrismaMock({ savedMethods: methods });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await svc.setDefault(TENANT_ID, 'm2');
      const call = prisma.platformSubscription.update.mock.calls[0][0];
      const written = call.data.externalRefs.savedMethods;
      expect(written.find((m: SavedMethodEntry) => m.id === 'm1').isDefault).toBe(false);
      expect(written.find((m: SavedMethodEntry) => m.id === 'm2').isDefault).toBe(true);
    });
  });

  describe('remove', () => {
    it('throws NotFound si méthode absente', async () => {
      const prisma = createPrismaMock({ savedMethods: [baseMethod({ id: 'm1' })] });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await expect(svc.remove(TENANT_ID, 'bad')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retire la méthode et conserve les autres', async () => {
      const methods = [
        baseMethod({ id: 'm1', isDefault: false }),
        baseMethod({ id: 'm2', isDefault: true  }),
      ];
      const prisma = createPrismaMock({ savedMethods: methods });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await svc.remove(TENANT_ID, 'm1');
      const written = prisma.platformSubscription.update.mock.calls[0][0].data.externalRefs.savedMethods;
      expect(written.map((m: SavedMethodEntry) => m.id)).toEqual(['m2']);
    });

    it('promeut auto un autre moyen default si on retire le default courant', async () => {
      const methods = [
        baseMethod({ id: 'm_default', isDefault: true,  lastUsedAt: '2026-04-10T00:00:00Z' }),
        baseMethod({ id: 'm_recent',  isDefault: false, lastUsedAt: '2026-04-20T00:00:00Z' }),
        baseMethod({ id: 'm_old',     isDefault: false, lastUsedAt: '2026-04-01T00:00:00Z' }),
      ];
      const prisma = createPrismaMock({ savedMethods: methods });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await svc.remove(TENANT_ID, 'm_default');
      const written = prisma.platformSubscription.update.mock.calls[0][0].data.externalRefs.savedMethods;
      // m_recent (plus récent) devient default
      expect(written.find((m: SavedMethodEntry) => m.id === 'm_recent').isDefault).toBe(true);
      expect(written.find((m: SavedMethodEntry) => m.id === 'm_old').isDefault).toBe(false);
    });

    it('retirer la dernière méthode ne promeut rien', async () => {
      const prisma = createPrismaMock({
        savedMethods: [baseMethod({ id: 'solo', isDefault: true })],
      });
      const svc = new SubscriptionPaymentMethodsService(prisma as any);
      await svc.remove(TENANT_ID, 'solo');
      const written = prisma.platformSubscription.update.mock.calls[0][0].data.externalRefs.savedMethods;
      expect(written).toEqual([]);
    });
  });
});
