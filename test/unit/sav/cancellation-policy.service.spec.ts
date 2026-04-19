import { CancellationPolicyService } from '../../../src/modules/sav/cancellation-policy.service';
import { PenaltyActor } from '../../../src/common/constants/workflow-states';

/**
 * CancellationPolicyService — politique d'annulation / pénalité.
 *
 * Scénarios couverts :
 *   1. Sources de paliers : tenant JSON > trip override > legacy 2-tier
 *   2. Sélection palier selon heures avant départ
 *   3. appliesTo actor — si acteur hors liste, pénalité 0 %
 *   4. waive=true force 0 %
 *   5. Rétro-compat legacy (3 paliers inférés de cancellationFullRefundMinutes
 *      et cancellationPartialRefundMinutes).
 */
describe('CancellationPolicyService', () => {
  let prismaMock: any;
  let service:    CancellationPolicyService;

  const NOW = Date.now();

  function setDepartureIn(hoursFromNow: number) {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', departureScheduled: new Date(NOW + hoursFromNow * 3_600_000),
      cancellationPenaltyTiersOverride: null,
    });
  }

  beforeEach(() => {
    prismaMock = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'TK1', tripId: 'T', pricePaid: 10_000,
        }),
      },
      trip: {
        findFirst: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ currency: 'XAF' }),
      },
      tenantBusinessConfig: {
        findUnique: jest.fn(),
      },
    };
    service = new CancellationPolicyService(prismaMock);
  });

  // ─── N-tier tenant JSON ────────────────────────────────────────────────────

  it('applique les paliers tenant JSON — 50h avant → 0 % pénalité', async () => {
    setDepartureIn(50);
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [
        { hoursBeforeDeparture: 48, penaltyPct: 0 },
        { hoursBeforeDeparture: 24, penaltyPct: 0.1 },
        { hoursBeforeDeparture: 2,  penaltyPct: 0.3 },
        { hoursBeforeDeparture: 0,  penaltyPct: 0.5 },
      ],
      cancellationPenaltyAppliesTo: ['CUSTOMER', 'AGENT', 'ADMIN'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBe(0);
    expect(calc.refundPercent).toBe(1);
    expect(calc.refundAmount).toBe(10_000);
    expect(calc.source).toBe('tiers_json');
  });

  it('applique le bon palier — 10h avant → 30 %', async () => {
    setDepartureIn(10);
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [
        { hoursBeforeDeparture: 48, penaltyPct: 0 },
        { hoursBeforeDeparture: 24, penaltyPct: 0.1 },
        { hoursBeforeDeparture: 2,  penaltyPct: 0.3 },
        { hoursBeforeDeparture: 0,  penaltyPct: 0.5 },
      ],
      cancellationPenaltyAppliesTo: ['CUSTOMER', 'AGENT', 'ADMIN'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBe(0.3);
    expect(calc.refundAmount).toBe(7_000);
  });

  it('au-delà du palier 0 (départ imminent / passé) → pénalité max', async () => {
    setDepartureIn(0);
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [
        { hoursBeforeDeparture: 24, penaltyPct: 0.1 },
        { hoursBeforeDeparture: 0,  penaltyPct: 0.5 },
      ],
      cancellationPenaltyAppliesTo: ['CUSTOMER'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBe(0.5);
  });

  // ─── Trip override ─────────────────────────────────────────────────────────

  it('trip override prend le pas sur tenant JSON', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', departureScheduled: new Date(NOW + 10 * 3_600_000),
      cancellationPenaltyTiersOverride: [
        { hoursBeforeDeparture: 0, penaltyPct: 0 }, // override permissif
      ],
    });
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [
        { hoursBeforeDeparture: 2, penaltyPct: 0.3 }, // standard : 30%
      ],
      cancellationPenaltyAppliesTo: ['CUSTOMER'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBe(0);
    expect(calc.source).toBe('trip_override');
  });

  // ─── appliesTo actor ───────────────────────────────────────────────────────

  it('pas de pénalité si l\'acteur n\'est pas dans appliesTo', async () => {
    setDepartureIn(1);
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [{ hoursBeforeDeparture: 0, penaltyPct: 0.5 }],
      cancellationPenaltyAppliesTo: ['CUSTOMER'], // pas ADMIN
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calcAdmin = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.ADMIN);
    expect(calcAdmin.penaltyPct).toBe(0);

    const calcCustomer = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calcCustomer.penaltyPct).toBe(0.5);
  });

  // ─── waive ─────────────────────────────────────────────────────────────────

  it('waive=true force 0 % pénalité', async () => {
    setDepartureIn(0.5);
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [{ hoursBeforeDeparture: 0, penaltyPct: 1 }],
      cancellationPenaltyAppliesTo: ['CUSTOMER'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER, true);
    expect(calc.penaltyPct).toBe(0);
    expect(calc.refundAmount).toBe(10_000);
  });

  // ─── Legacy 2-tier (fallback) ──────────────────────────────────────────────

  it('legacy 2-tier : >= fullRefundMinutes → 0 % pénalité', async () => {
    setDepartureIn(25); // 1500 min ≥ 1440
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [], // vide
      cancellationPenaltyAppliesTo: ['CUSTOMER'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBe(0);
    expect(calc.source).toBe('legacy_2tier');
  });

  it('legacy 2-tier : palier partiel → 50 % pénalité (refund = 50%)', async () => {
    setDepartureIn(3); // 180 min ≥ 120
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [],
      cancellationPenaltyAppliesTo: ['CUSTOMER'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5, // refund 50% = pénalité 50%
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBeCloseTo(0.5);
    expect(calc.refundAmount).toBe(5_000);
  });

  it('legacy 2-tier : en-dessous palier partiel → 100 % pénalité (non remboursable)', async () => {
    setDepartureIn(1); // 60 min < 120
    prismaMock.tenantBusinessConfig.findUnique.mockResolvedValue({
      cancellationPenaltyTiers: [],
      cancellationPenaltyAppliesTo: ['CUSTOMER'],
      cancellationFullRefundMinutes: 1440,
      cancellationPartialRefundMinutes: 120,
      cancellationPartialRefundPct: 0.5,
    });
    const calc = await service.calculateRefundAmount('T1', 'TK1', PenaltyActor.CUSTOMER);
    expect(calc.penaltyPct).toBe(1);
    expect(calc.refundAmount).toBe(0);
  });
});
