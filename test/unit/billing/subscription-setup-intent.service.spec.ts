/**
 * SubscriptionCheckoutService.startSetupIntent + SubscriptionReconciliationService
 * branche setupOnly — tests unit.
 *
 * Couvre :
 *   1. startSetupIntent : montant micro par devise, metadata.setupOnly=true
 *   2. Reconciliation : savedMethods upsert + refund déclenché
 *   3. Reconciliation : pas de tokenisation → refund mais pas de save
 *   4. Reconciliation : échec refund loggé mais moyen sauvé quand même
 */
import { Logger } from '@nestjs/common';
import { SubscriptionCheckoutService } from '../../../src/modules/subscription-checkout/subscription-checkout.service';
import { SubscriptionReconciliationService } from '../../../src/modules/subscription-checkout/subscription-reconciliation.service';

const TENANT_ID = 'tenant-1';
const SUB_ID    = 'sub-1';

describe('SubscriptionCheckoutService.startSetupIntent', () => {
  function setup(currency = 'XAF') {
    const prisma = {
      platformSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id:       SUB_ID,
          tenantId: TENANT_ID,
          plan:     { price: 25000, currency, billingCycle: 'MONTHLY', slug: 'growth', name: 'Growth' },
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ email: 'admin@acme.cg', name: 'Admin' }),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency, name: 'Acme' }),
      },
    };
    const orchestrator = {
      createIntent: jest.fn().mockResolvedValue({
        intentId:    'int-1',
        paymentUrl:  'https://psp.test/pay/int-1',
        amount:      100,
        currency,
        expiresAt:   new Date('2026-04-23T12:00:00Z'),
        providerKey: 'flutterwave',
      }),
    };
    const config = { getNumber: jest.fn(), getString: jest.fn() };
    const svc = new SubscriptionCheckoutService(prisma as any, orchestrator as any, config as any);
    return { svc, prisma, orchestrator };
  }

  it('crée un intent microchargé à 100 XAF avec setupOnly=true', async () => {
    const { svc, orchestrator } = setup('XAF');
    const out = await svc.startSetupIntent(TENANT_ID, { method: 'CARD' });

    expect(orchestrator.createIntent).toHaveBeenCalledTimes(1);
    const [tenantId, dto] = orchestrator.createIntent.mock.calls[0];
    expect(tenantId).toBe(TENANT_ID);
    expect(dto.subtotal).toBe(100);
    expect(dto.currency).toBe('XAF');
    expect(dto.entityType).toBe('SUBSCRIPTION');
    expect(dto.entityId).toBe(SUB_ID);
    expect(dto.metadata.setupOnly).toBe(true);
    expect(dto.metadata.subscriptionId).toBe(SUB_ID);
    expect(out.setupOnly).toBe(true);
    expect(out.paymentUrl).toContain('https://');
  });

  it('utilise 1 USD pour un plan en USD', async () => {
    const { svc, orchestrator } = setup('USD');
    await svc.startSetupIntent(TENANT_ID, { method: 'CARD' });
    const [, dto] = orchestrator.createIntent.mock.calls[0];
    expect(dto.subtotal).toBe(1);
    expect(dto.currency).toBe('USD');
  });

  it('accepte MOBILE_MONEY comme méthode', async () => {
    const { svc, orchestrator } = setup('XAF');
    await svc.startSetupIntent(TENANT_ID, { method: 'MOBILE_MONEY' });
    const [, dto] = orchestrator.createIntent.mock.calls[0];
    expect(dto.method).toBe('MOBILE_MONEY');
  });

  it('clé idempotence unique par timestamp (jamais collision checkout)', async () => {
    const { svc, orchestrator } = setup('XAF');
    await svc.startSetupIntent(TENANT_ID, { method: 'CARD' });
    const [, dto] = orchestrator.createIntent.mock.calls[0];
    expect(dto.idempotencyKey).toMatch(new RegExp(`^sub-setup-${SUB_ID}-CARD-\\d+$`));
  });

  it('throw si aucune souscription', async () => {
    const { svc, prisma } = setup('XAF');
    prisma.platformSubscription.findUnique.mockResolvedValueOnce(null);
    await expect(svc.startSetupIntent(TENANT_ID, { method: 'CARD' })).rejects.toThrow(/souscription/i);
  });
});

describe('SubscriptionReconciliationService — branche setupOnly', () => {
  function setup() {
    const prisma = {
      platformSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id:           SUB_ID,
          tenantId:     TENANT_ID,
          status:       'ACTIVE',
          externalRefs: {},
          plan:         { billingCycle: 'MONTHLY' },
          currentPeriodStart: new Date(),
          currentPeriodEnd:   new Date('2099-01-01'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentIntent: {
        findUnique: jest.fn().mockResolvedValue({ method: 'CARD' }),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue({ externalRef: 'ext-1', providerKey: 'flutterwave' }),
      },
      tenant: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const orchestrator = {
      refund: jest.fn().mockResolvedValue({ status: 'REFUNDED', refundedAmount: 100 }),
    };
    const svc = new SubscriptionReconciliationService(prisma as any, orchestrator as any);
    // Silence le logger pour garder les tests propres
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    return { svc, prisma, orchestrator };
  }

  const baseCardPayload = {
    tenantId:   TENANT_ID,
    intentId:   'int-1',
    entityType: 'SUBSCRIPTION',
    entityId:   SUB_ID,
    amount:     100,
    currency:   'XAF',
    metadata:   { setupOnly: true, subscriptionId: SUB_ID },
    tokenization: {
      customerRef: 'cus_xyz',
      methodToken: 'tok_abc',
      methodLast4: '4242',
      methodBrand: 'VISA',
    },
  };

  it('enregistre le moyen CARD et déclenche le refund', async () => {
    const { svc, prisma, orchestrator } = setup();
    await svc.onPaymentSucceeded(baseCardPayload);

    // Moyen ajouté mais pas de transition de statut
    expect(prisma.platformSubscription.update).toHaveBeenCalledTimes(1);
    const updateCall = prisma.platformSubscription.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();           // pas de changement
    expect(updateCall.data.currentPeriodEnd).toBeUndefined(); // pas de prolongation
    expect(updateCall.data.externalRefs.savedMethods).toHaveLength(1);
    expect(updateCall.data.externalRefs.savedMethods[0].last4).toBe('4242');
    expect(updateCall.data.externalRefs.savedMethods[0].isDefault).toBe(true);
    expect(updateCall.data.externalRefs.savedMethods[0].lastUsedAt).toBeNull();

    // Refund appelé avec le bon motif
    expect(orchestrator.refund).toHaveBeenCalledWith('int-1', { reason: 'SETUP_INTENT_AUTO_REFUND' });
  });

  it('enregistre le moyen MOBILE_MONEY via maskedPhone', async () => {
    const { svc, prisma, orchestrator } = setup();
    const payload = {
      ...baseCardPayload,
      tokenization: {
        customerRef: '242061234567',
        maskedPhone: '+242 ••••• 4567',
      },
    };
    await svc.onPaymentSucceeded(payload);

    const updateCall = prisma.platformSubscription.update.mock.calls[0][0];
    expect(updateCall.data.externalRefs.savedMethods[0].maskedPhone).toBe('+242 ••••• 4567');
    expect(updateCall.data.externalRefs.savedMethods[0].customerRef).toBe('242061234567');
    expect(orchestrator.refund).toHaveBeenCalled();
  });

  it('refund appelé même sans tokenisation — moyen PAS enregistré', async () => {
    const { svc, prisma, orchestrator } = setup();
    const payload = { ...baseCardPayload, tokenization: undefined };
    await svc.onPaymentSucceeded(payload);

    expect(prisma.platformSubscription.update).not.toHaveBeenCalled();
    expect(orchestrator.refund).toHaveBeenCalled();
  });

  it('ne bascule PAS la subscription ACTIVE en cas de setupOnly (idempotence)', async () => {
    const { svc, prisma } = setup();
    await svc.onPaymentSucceeded(baseCardPayload);
    const updateCall = prisma.platformSubscription.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('si refund échoue, le moyen reste enregistré (log seulement)', async () => {
    const { svc, prisma, orchestrator } = setup();
    orchestrator.refund.mockRejectedValueOnce(new Error('provider_down'));
    await svc.onPaymentSucceeded(baseCardPayload);

    expect(prisma.platformSubscription.update).toHaveBeenCalledTimes(1); // moyen enregistré
    expect(orchestrator.refund).toHaveBeenCalledTimes(1);                // refund tenté
    // Pas de throw — reconciliation doit rester idempotente côté webhook
  });

  it('ignore les intents non-SUBSCRIPTION', async () => {
    const { svc, prisma, orchestrator } = setup();
    await svc.onPaymentSucceeded({ ...baseCardPayload, entityType: 'TICKET' });
    expect(prisma.platformSubscription.update).not.toHaveBeenCalled();
    expect(orchestrator.refund).not.toHaveBeenCalled();
  });

  it('cross-tenant mismatch → abort silencieux', async () => {
    const { svc, prisma, orchestrator } = setup();
    prisma.platformSubscription.findUnique.mockResolvedValueOnce({
      id:           SUB_ID,
      tenantId:     'other-tenant',  // différent du payload
      status:       'ACTIVE',
      externalRefs: {},
      plan:         { billingCycle: 'MONTHLY' },
    });
    await svc.onPaymentSucceeded(baseCardPayload);
    expect(prisma.platformSubscription.update).not.toHaveBeenCalled();
    expect(orchestrator.refund).not.toHaveBeenCalled();
  });
});
