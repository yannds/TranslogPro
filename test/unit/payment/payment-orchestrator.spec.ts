import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  PaymentOrchestrator,
  mapProviderStatusToAttempt,
  deriveIntentStatusFromProvider,
  isIntentTransitionAllowed,
} from '../../../src/infrastructure/payment/payment-orchestrator.service';

/**
 * Tests ciblent :
 *   - les helpers de transition de statut (pures)
 *   - les branches sûres de createIntent/refund/cancel qui court-circuitent
 *     avant tout appel réseau.
 *
 * Prisma et registry sont mockés — on vérifie le comportement logique.
 */

describe('Orchestrator — status mapping', () => {
  it('mapProviderStatusToAttempt couvre tous les statuts', () => {
    expect(mapProviderStatusToAttempt('SUCCESSFUL')).toBe('SUCCESSFUL');
    expect(mapProviderStatusToAttempt('FAILED')).toBe('FAILED');
    expect(mapProviderStatusToAttempt('CANCELLED')).toBe('CANCELLED');
    expect(mapProviderStatusToAttempt('REVERSED')).toBe('REVERSED');
    expect(mapProviderStatusToAttempt('PENDING')).toBe('PENDING');
  });

  it('deriveIntentStatusFromProvider mappe vers statuts Intent', () => {
    expect(deriveIntentStatusFromProvider('SUCCESSFUL')).toBe('SUCCEEDED');
    expect(deriveIntentStatusFromProvider('FAILED')).toBe('FAILED');
    expect(deriveIntentStatusFromProvider('CANCELLED')).toBe('CANCELLED');
    expect(deriveIntentStatusFromProvider('REVERSED')).toBe('REFUNDED');
    expect(deriveIntentStatusFromProvider('PENDING')).toBe('PROCESSING');
  });

  describe('isIntentTransitionAllowed', () => {
    it('autorise CREATED → PROCESSING → SUCCEEDED', () => {
      expect(isIntentTransitionAllowed('CREATED', 'PROCESSING')).toBe(true);
      expect(isIntentTransitionAllowed('PROCESSING', 'SUCCEEDED')).toBe(true);
    });
    it('refuse transition depuis état terminal vers non-refund', () => {
      expect(isIntentTransitionAllowed('SUCCEEDED', 'PROCESSING')).toBe(false);
      expect(isIntentTransitionAllowed('FAILED', 'PROCESSING')).toBe(false);
      expect(isIntentTransitionAllowed('CANCELLED', 'SUCCEEDED')).toBe(false);
    });
    it('autorise SUCCEEDED → REFUNDED / PARTIALLY_REFUNDED', () => {
      expect(isIntentTransitionAllowed('SUCCEEDED', 'REFUNDED')).toBe(true);
      expect(isIntentTransitionAllowed('SUCCEEDED', 'PARTIALLY_REFUNDED')).toBe(true);
    });
    it('refuse la transition neutre (from === to)', () => {
      expect(isIntentTransitionAllowed('SUCCEEDED', 'SUCCEEDED')).toBe(false);
    });
  });
});

describe('Orchestrator — validations amont', () => {
  let orchestrator: PaymentOrchestrator;
  let prisma: any;
  let registry: any;
  let router: any;
  let encryptor: any;

  beforeEach(() => {
    prisma = {
      paymentIntent:        { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      paymentAttempt:       { findFirst: jest.fn(), update: jest.fn() },
      paymentEvent:         { create: jest.fn(), createMany: jest.fn() },
      tenant:               { findUnique: jest.fn() },
      tenantPaymentConfig:  { findUnique: jest.fn() },
      tenantTax:            { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) =>
        typeof cb === 'function'
          ? cb({
              paymentIntent:  prisma.paymentIntent,
              paymentAttempt: prisma.paymentAttempt,
              paymentEvent:   prisma.paymentEvent,
            })
          : Promise.all(cb),
      ),
    };
    registry  = { get: jest.fn() };
    router    = { resolve: jest.fn() };
    encryptor = { encryptJson: jest.fn().mockResolvedValue(null), decryptJson: jest.fn() };

    // EventEmitter2 ajouté en 5e dépendance (event bus domaine pour PaymentSucceeded etc.)
    const events = { emit: jest.fn(), emitAsync: jest.fn() };
    // PaymentSplitService ajouté en 6e dépendance (calcul commission SaaS).
    // Mock par défaut → null (pas de split) pour ne pas casser les tests qui
    // ne ciblent pas le split.
    const splitter = { computeSplit: jest.fn().mockResolvedValue(null) };
    orchestrator = new PaymentOrchestrator(
      prisma, router, registry, encryptor, events as any, splitter as any,
    );
  });

  it('createIntent rejette si idempotencyKey manquant', async () => {
    await expect(orchestrator.createIntent('T1', {
      entityType: 'TICKET', subtotal: 1000, method: 'MOBILE_MONEY', idempotencyKey: '',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createIntent rejette si subtotal négatif', async () => {
    await expect(orchestrator.createIntent('T1', {
      entityType: 'TICKET', subtotal: -1, method: 'MOBILE_MONEY', idempotencyKey: 'k',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createIntent retourne l’existant si idempotencyKey déjà utilisé', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'INT1', status: 'SUCCEEDED', amount: 1180, currency: 'XAF',
      expiresAt: new Date('2026-05-01'),
      attempts: [{ paymentUrl: 'https://pay/1', providerKey: 'flutterwave_agg' }],
    });
    const res = await orchestrator.createIntent('T1', {
      entityType: 'TICKET', subtotal: 1000, method: 'MOBILE_MONEY', idempotencyKey: 'k1',
    });
    expect(res.intentId).toBe('INT1');
    expect(res.status).toBe('SUCCEEDED');
    expect(res.providerKey).toBe('flutterwave_agg');
    expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
    expect(router.resolve).not.toHaveBeenCalled();
  });

  it('cancel lève ConflictException si Intent déjà SUCCEEDED', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({ id: 'X', status: 'SUCCEEDED' });
    await expect(orchestrator.cancel('X', 'test')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancel passe l’intent en CANCELLED si CREATED', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({ id: 'X', status: 'CREATED' });
    const res = await orchestrator.cancel('X', 'user request');
    expect(res.status).toBe('CANCELLED');
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({ where: { id: 'X' }, data: { status: 'CANCELLED' } });
    expect(prisma.paymentEvent.create).toHaveBeenCalled();
  });

  it('refund rejette si Intent non SUCCEEDED / PARTIALLY_REFUNDED', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'X', status: 'FAILED', amount: 1000, attempts: [],
    });
    await expect(orchestrator.refund('X', { reason: 'test' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refund rejette si montant demandé > montant Intent', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'X', status: 'SUCCEEDED', amount: 1000,
      attempts: [{ id: 'A1', status: 'SUCCESSFUL', externalRef: 'ext1', providerKey: 'flw' }],
    });
    registry.get.mockReturnValue({ refund: jest.fn() });
    await expect(orchestrator.refund('X', { amount: 2000, reason: 'test' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
