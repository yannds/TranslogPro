import { PaymentReconciliationService } from '../../../src/infrastructure/payment/payment-reconciliation.service';

describe('PaymentReconciliationService', () => {
  let svc: PaymentReconciliationService;
  let prisma: any;
  let orchestrator: any;
  let registry: any;

  beforeEach(() => {
    prisma = {
      paymentIntent:  { findMany: jest.fn(), update: jest.fn() },
      paymentEvent:   { create: jest.fn() },
      platformPaymentConfig: { findUnique: jest.fn().mockResolvedValue({ reconciliationCronEnabled: true, reconciliationLagMinutes: 30 }) },
      $transaction:   jest.fn(async (cb: any) =>
        typeof cb === 'function'
          ? cb({ paymentIntent: prisma.paymentIntent, paymentEvent: prisma.paymentEvent })
          : Promise.all(cb),
      ),
    };
    orchestrator = { applyWebhook: jest.fn() };
    registry     = { get: jest.fn() };
    svc = new PaymentReconciliationService(prisma, orchestrator, registry);
  });

  describe('expirePast', () => {
    it('marque EXPIRED les intents périmés', async () => {
      prisma.paymentIntent.findMany.mockResolvedValue([
        { id: 'I1', status: 'PROCESSING' },
        { id: 'I2', status: 'CREATED' },
      ]);
      const n = await svc.expirePast();
      expect(n).toBe(2);
      expect(prisma.paymentIntent.update).toHaveBeenCalledTimes(2);
      expect(prisma.paymentEvent.create).toHaveBeenCalledTimes(2);
      expect(prisma.paymentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: 'EXPIRED', source: 'CRON' }),
      }));
    });

    it('ne touche rien si aucun intent périmé', async () => {
      prisma.paymentIntent.findMany.mockResolvedValue([]);
      const n = await svc.expirePast();
      expect(n).toBe(0);
      expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
    });
  });

  describe('reconcileStale', () => {
    it('interroge provider.verify + applyWebhook', async () => {
      const provider = {
        verify: jest.fn().mockResolvedValue({
          txRef: 'T1', externalRef: 'E1', status: 'SUCCESSFUL', amount: 1000, currency: 'XAF', providerName: 'mtn_momo_cg',
        }),
      };
      registry.get.mockReturnValue(provider);
      prisma.paymentIntent.findMany.mockResolvedValue([
        { id: 'I1', attempts: [{ externalRef: 'E1', providerKey: 'mtn_momo_cg' }] },
      ]);
      const n = await svc.reconcileStale(30);
      expect(n).toBe(1);
      expect(provider.verify).toHaveBeenCalledWith('E1');
      expect(orchestrator.applyWebhook).toHaveBeenCalledWith('mtn_momo_cg', expect.objectContaining({ isValid: true, status: 'SUCCESSFUL' }));
    });

    it('ignore les intents sans externalRef', async () => {
      prisma.paymentIntent.findMany.mockResolvedValue([{ id: 'I1', attempts: [{ externalRef: null, providerKey: 'x' }] }]);
      const n = await svc.reconcileStale(30);
      expect(n).toBe(0);
    });

    it('continue même si un provider échoue', async () => {
      const good = { verify: jest.fn().mockResolvedValue({
        txRef: 'T', externalRef: 'E', status: 'PENDING', amount: 1, currency: 'XAF', providerName: 'g',
      }) };
      const bad  = { verify: jest.fn().mockRejectedValue(new Error('network')) };
      registry.get.mockImplementation((k: string) => k === 'good' ? good : bad);
      prisma.paymentIntent.findMany.mockResolvedValue([
        { id: 'I1', attempts: [{ externalRef: 'E1', providerKey: 'bad'  }] },
        { id: 'I2', attempts: [{ externalRef: 'E2', providerKey: 'good' }] },
      ]);
      const n = await svc.reconcileStale(30);
      expect(n).toBe(1);
    });
  });

  describe('runCron', () => {
    it('skip si reconciliationCronEnabled=false', async () => {
      prisma.platformPaymentConfig.findUnique.mockResolvedValue({ reconciliationCronEnabled: false });
      prisma.paymentIntent.findMany.mockResolvedValue([]);
      await svc.runCron();
      expect(prisma.paymentIntent.findMany).not.toHaveBeenCalled();
    });

    it('appelle expirePast puis reconcileStale', async () => {
      const spyExp = jest.spyOn(svc, 'expirePast').mockResolvedValue(0);
      const spyRec = jest.spyOn(svc, 'reconcileStale').mockResolvedValue(0);
      await svc.runCron();
      expect(spyExp).toHaveBeenCalled();
      expect(spyRec).toHaveBeenCalled();
    });
  });
});
