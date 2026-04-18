import { BadRequestException } from '@nestjs/common';
import { PaymentRouter } from '../../../src/infrastructure/payment/payment-router.service';
import {
  IPaymentProvider,
  PaymentProviderMeta,
  SupportsQuery,
} from '../../../src/infrastructure/payment/providers/types';

/**
 * Tests de la priorité de résolution :
 *   1. choix explicite TenantPaymentConfig.defaultProviderByMethod
 *   2. fallbackChainByMethod
 *   3. scan global supports() + mode != DISABLED
 *
 * Le registry est mocké — on exerce uniquement la logique du router.
 */

function makeProvider(
  meta: Partial<PaymentProviderMeta> & { key: string },
  supportsFn?: (q: SupportsQuery) => boolean,
): IPaymentProvider {
  const fullMeta: PaymentProviderMeta = {
    key:                 meta.key,
    displayName:         meta.displayName         ?? meta.key,
    supportedMethods:    meta.supportedMethods    ?? ['MOBILE_MONEY'],
    supportedCountries:  meta.supportedCountries  ?? ['CG'],
    supportedCurrencies: meta.supportedCurrencies ?? ['XAF'],
    defaultVaultPath:    meta.defaultVaultPath    ?? `platform/payments/${meta.key}`,
  };
  return {
    meta:        fullMeta,
    isEnabled:   true,
    webhookSignatureHeader: 'x-test-signature',
    supports:    supportsFn ?? ((q) =>
      fullMeta.supportedMethods.includes(q.method) &&
      fullMeta.supportedCountries.includes(q.country) &&
      fullMeta.supportedCurrencies.includes(q.currency)),
    healthcheck: jest.fn(),
    initiate:    jest.fn(),
    verify:      jest.fn(),
    verifyWebhook: jest.fn(),
    refund:      jest.fn(),
  };
}

describe('PaymentRouter.resolve', () => {
  let mtn: IPaymentProvider;
  let airtel: IPaymentProvider;
  let flw: IPaymentProvider;
  let prisma: any;
  let registry: any;
  let router: PaymentRouter;

  beforeEach(() => {
    mtn    = makeProvider({ key: 'mtn_momo_cg' });
    airtel = makeProvider({ key: 'airtel_cg' });
    flw    = makeProvider({
      key: 'flutterwave_agg',
      supportedMethods:    ['MOBILE_MONEY', 'CARD'],
      supportedCountries:  ['CG', 'CI', 'SN'],
      supportedCurrencies: ['XAF', 'XOF'],
    });

    prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ country: 'CG', currency: 'XAF' }),
      },
      tenantPaymentConfig: {
        findUnique: jest.fn().mockResolvedValue({
          defaultProviderByMethod: {},
          fallbackChainByMethod:   {},
          minAmountByMethod:       {},
          maxAmountByMethod:       {},
          allowedCurrencies:       ['XAF'],
        }),
      },
    };

    registry = {
      get: jest.fn((key: string) => ({ mtn_momo_cg: mtn, airtel_cg: airtel, flutterwave_agg: flw }[key])),
      list: jest.fn(() => [mtn, airtel, flw]),
      getEffectiveState: jest.fn(),
    };

    router = new PaymentRouter(prisma, registry);
  });

  it('priorité 1 : choix explicite tenant gagne', async () => {
    prisma.tenantPaymentConfig.findUnique.mockResolvedValueOnce({
      defaultProviderByMethod: { MOBILE_MONEY: 'airtel_cg' },
      fallbackChainByMethod:   {},
      minAmountByMethod: {}, maxAmountByMethod: {}, allowedCurrencies: ['XAF'],
    });
    registry.getEffectiveState.mockResolvedValue({
      providerKey: 'airtel_cg', mode: 'SANDBOX', vaultPath: 'x',
      displayName: 'Airtel', scopedToTenant: false, meta: airtel.meta,
    });

    const res = await router.resolve({ tenantId: 'T1', method: 'MOBILE_MONEY' });
    expect(res.providerKey).toBe('airtel_cg');
  });

  it('priorité 2 : fallback chain si choix explicite DISABLED', async () => {
    prisma.tenantPaymentConfig.findUnique.mockResolvedValueOnce({
      defaultProviderByMethod: { MOBILE_MONEY: 'mtn_momo_cg' },
      fallbackChainByMethod:   { MOBILE_MONEY: ['airtel_cg', 'flutterwave_agg'] },
      minAmountByMethod: {}, maxAmountByMethod: {}, allowedCurrencies: ['XAF'],
    });
    registry.getEffectiveState.mockImplementation((key: string) => {
      if (key === 'mtn_momo_cg')    return Promise.resolve({ mode: 'DISABLED', vaultPath: 'x', providerKey: key, displayName: '', scopedToTenant: false, meta: mtn.meta });
      if (key === 'airtel_cg')      return Promise.resolve({ mode: 'SANDBOX', vaultPath: 'x', providerKey: key, displayName: '', scopedToTenant: false, meta: airtel.meta });
      return Promise.resolve(null);
    });

    const res = await router.resolve({ tenantId: 'T1', method: 'MOBILE_MONEY' });
    expect(res.providerKey).toBe('airtel_cg');
  });

  it('priorité 3 : scan global si ni explicite ni fallback', async () => {
    registry.getEffectiveState.mockImplementation((key: string) => {
      if (key === 'flutterwave_agg') return Promise.resolve({ mode: 'LIVE', vaultPath: 'x', providerKey: key, displayName: '', scopedToTenant: false, meta: flw.meta });
      return Promise.resolve({ mode: 'DISABLED', vaultPath: 'x', providerKey: key, displayName: '', scopedToTenant: false, meta: { key } as any });
    });

    const res = await router.resolve({ tenantId: 'T1', method: 'MOBILE_MONEY' });
    expect(res.providerKey).toBe('flutterwave_agg');
    expect(res.mode).toBe('LIVE');
  });

  it('aucun provider dispo → BadRequestException', async () => {
    registry.getEffectiveState.mockResolvedValue({ mode: 'DISABLED', vaultPath: 'x', providerKey: 'x', displayName: '', scopedToTenant: false, meta: {} as any });

    await expect(router.resolve({ tenantId: 'T1', method: 'MOBILE_MONEY' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('devise non autorisée → BadRequestException', async () => {
    prisma.tenantPaymentConfig.findUnique.mockResolvedValueOnce({
      defaultProviderByMethod: {}, fallbackChainByMethod: {},
      minAmountByMethod: {}, maxAmountByMethod: {}, allowedCurrencies: ['XAF'],
    });
    await expect(router.resolve({ tenantId: 'T1', method: 'CARD', currency: 'USD' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('montant < min → BadRequestException', async () => {
    prisma.tenantPaymentConfig.findUnique.mockResolvedValueOnce({
      defaultProviderByMethod: {}, fallbackChainByMethod: {},
      minAmountByMethod: { MOBILE_MONEY: 100 }, maxAmountByMethod: {}, allowedCurrencies: ['XAF'],
    });
    await expect(router.resolve({ tenantId: 'T1', method: 'MOBILE_MONEY', amount: 50 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('montant > max → BadRequestException', async () => {
    prisma.tenantPaymentConfig.findUnique.mockResolvedValueOnce({
      defaultProviderByMethod: {}, fallbackChainByMethod: {},
      minAmountByMethod: {}, maxAmountByMethod: { MOBILE_MONEY: 2_000_000 }, allowedCurrencies: ['XAF'],
    });
    await expect(router.resolve({ tenantId: 'T1', method: 'MOBILE_MONEY', amount: 5_000_000 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('provider ne supporte pas le pays/devise → skip', async () => {
    // flw supporte CI/SN mais pas le couple demandé (devise non match)
    registry.getEffectiveState.mockImplementation((key: string) =>
      Promise.resolve({ mode: 'LIVE', vaultPath: 'x', providerKey: key, displayName: '', scopedToTenant: false, meta: {} as any })
    );
    prisma.tenant.findUnique.mockResolvedValueOnce({ country: 'CG', currency: 'XAF' });
    // on force mtn et airtel à ne pas supporter CARD → seul flw pourrait, mais flw ne supporte pas CARD ici
    mtn.supports = () => false;
    airtel.supports = () => false;
    flw.supports = () => false;

    await expect(router.resolve({ tenantId: 'T1', method: 'CARD' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
