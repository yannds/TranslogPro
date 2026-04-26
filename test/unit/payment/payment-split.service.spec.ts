/**
 * PaymentSplitService — calcul du plan commission SaaS (split).
 *
 * Couvre :
 *   - PERCENT par défaut (300 bps = 3 %)
 *   - Override tenant
 *   - Politique FLAT
 *   - Garde-fou : platformAmount cap à amount-1
 *   - bps=0 + flat=0 → null (commission désactivée)
 *   - tenantSubaccountId propagé quand renseigné
 */
import { PaymentSplitService } from '../../../src/infrastructure/payment/payment-split.service';

function makePrisma(overrides: {
  platform?: Record<string, unknown>;
  tenant?:   Record<string, unknown> | null;
} = {}) {
  return {
    platformPaymentConfig: {
      upsert: jest.fn().mockResolvedValue({
        platformFeeBps:             300,
        platformFeePolicy:          'PERCENT',
        platformFeeFlatMinor:       0,
        platformPayoutSubaccountId: null,
        ...overrides.platform,
      }),
    },
    tenantPaymentConfig: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.tenant === null
          ? null
          : { payoutSubaccountId: null, platformFeeBpsOverride: null, ...overrides.tenant },
      ),
    },
  } as any;
}

describe('PaymentSplitService.computeSplit', () => {
  it('PERCENT 3 % par défaut', async () => {
    const svc = new PaymentSplitService(makePrisma());
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r).not.toBeNull();
    expect(r!.platformAmount).toBe(300);
    expect(r!.tenantAmount).toBe(9_700);
    expect(r!.policyTrace).toContain('PERCENT bps=300');
  });

  it('override tenant prime sur défaut plateforme', async () => {
    const svc = new PaymentSplitService(makePrisma({
      tenant: { platformFeeBpsOverride: 150 }, // 1.5 %
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r!.platformAmount).toBe(150);
    expect(r!.tenantAmount).toBe(9_850);
    expect(r!.policyTrace).toContain('(override)');
  });

  it('PERCENT + flat additionnel', async () => {
    const svc = new PaymentSplitService(makePrisma({
      platform: { platformFeeBps: 200, platformFeeFlatMinor: 100 },
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    // 2% de 10000 = 200 + flat 100 = 300
    expect(r!.platformAmount).toBe(300);
    expect(r!.tenantAmount).toBe(9_700);
  });

  it('FLAT : montant fixe quel que soit le ticket', async () => {
    const svc = new PaymentSplitService(makePrisma({
      platform: { platformFeePolicy: 'FLAT', platformFeeFlatMinor: 250 },
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r!.platformAmount).toBe(250);
    expect(r!.tenantAmount).toBe(9_750);
    expect(r!.policyTrace).toBe('FLAT 250');
  });

  it('cap : platformAmount ne peut absorber tout le paiement', async () => {
    const svc = new PaymentSplitService(makePrisma({
      platform: { platformFeePolicy: 'FLAT', platformFeeFlatMinor: 5_000 },
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 1_000 });
    expect(r!.platformAmount).toBe(999);
    expect(r!.tenantAmount).toBe(1);
  });

  it('null quand commission désactivée (bps=0 et flat=0)', async () => {
    const svc = new PaymentSplitService(makePrisma({
      platform: { platformFeeBps: 0, platformFeeFlatMinor: 0 },
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r).toBeNull();
  });

  it('tenantSubaccountId propagé pour split natif', async () => {
    const svc = new PaymentSplitService(makePrisma({
      tenant: { payoutSubaccountId: 'RS_TENANT_42', platformFeeBpsOverride: null },
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r!.tenantSubaccountId).toBe('RS_TENANT_42');
  });

  it('absence de subaccount tenant → tenantSubaccountId undefined (mode legacy en aval)', async () => {
    const svc = new PaymentSplitService(makePrisma({
      tenant: { payoutSubaccountId: null },
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r!.tenantSubaccountId).toBeUndefined();
  });

  it('arrondi entier — pas de centimes parasites', async () => {
    const svc = new PaymentSplitService(makePrisma({
      platform: { platformFeeBps: 333 }, // 3.33 %
    }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    // 333/10000 * 10000 = 333 exactement
    expect(r!.platformAmount).toBe(333);
    expect(r!.tenantAmount).toBe(9_667);
  });

  it('aucun TenantPaymentConfig en DB → utilise les défauts plateforme', async () => {
    const svc = new PaymentSplitService(makePrisma({ tenant: null }));
    const r = await svc.computeSplit({ tenantId: 't1', amount: 10_000 });
    expect(r!.platformAmount).toBe(300);
  });
});
