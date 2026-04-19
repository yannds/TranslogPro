import { IncidentCompensationService } from '../../../src/modules/incident-compensation/incident-compensation.service';
import { TripAction, CompensationForm } from '../../../src/common/constants/workflow-states';

/**
 * IncidentCompensationService — tests orchestration suspend/resume/cancel/delay.
 * Couvre le plus important : sélection palier compensation (délai → pct + snack),
 * fan-out tickets, override trip > tenant config, forme compensation (monétaire /
 * voucher / mixed / snack).
 */
describe('IncidentCompensationService', () => {
  let prismaMock:   any;
  let workflowMock: any;
  let voucherMock:  any;
  let refundMock:   any;
  let service:      IncidentCompensationService;

  beforeEach(() => {
    prismaMock = {
      trip: {
        findFirst: jest.fn(),
        update:    jest.fn(),
      },
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ currency: 'XAF' }),
      },
      tenantBusinessConfig: {
        findUniqueOrThrow: jest.fn(),
      },
      compensationItem: {
        create: jest.fn(),
      },
    };
    workflowMock = {
      transition: jest.fn().mockImplementation((_entity, _input, cfg) => cfg.persist(_entity, 'SUSPENDED', prismaMock)),
    };
    voucherMock = {
      issue: jest.fn().mockResolvedValue({ id: 'V1' }),
    };
    refundMock = {
      createRefund: jest.fn().mockResolvedValue({ id: 'R1' }),
    };
    service = new IncidentCompensationService(prismaMock, workflowMock, voucherMock, refundMock);
  });

  // ─── suspend ───────────────────────────────────────────────────────────────

  it('suspendTrip : transition via engine action SUSPEND + stamp reason', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({ id: 'T', tenantId: 'T1', status: 'IN_PROGRESS' });
    await service.suspendTrip('T1', 'T', 'panne moteur', { id: 'U1', tenantId: 'T1', roleId: 'R' } as any);
    expect(workflowMock.transition.mock.calls[0][1].action).toBe(TripAction.SUSPEND);
    expect(prismaMock.trip.update.mock.calls[0][0].data).toMatchObject({
      suspendedReason: 'panne moteur',
      suspendedById:   'U1',
    });
  });

  // ─── cancel in transit ────────────────────────────────────────────────────

  it('cancelInTransit : prorata km → refund partiel pour chaque ticket actif', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({ id: 'T', tenantId: 'T1', status: 'IN_PROGRESS' });
    prismaMock.tenantBusinessConfig.findUniqueOrThrow.mockResolvedValue({
      incidentRefundProrataEnabled: true,
      incidentCompensationEnabled: false,
    });
    prismaMock.ticket.findMany.mockResolvedValue([
      { id: 'TK1', pricePaid: 10_000, status: 'BOARDED' },
      { id: 'TK2', pricePaid: 8_000,  status: 'BOARDED' },
    ]);
    await service.cancelInTransit('T1', 'T',
      { id: 'U1', tenantId: 'T1', roleId: 'R' } as any,
      { distanceTraveledKm: 40, totalDistanceKm: 100, reason: 'panne irrécupérable' },
    );
    // ratio = 1 - 40/100 = 0.6 → TK1 refund 6000, TK2 refund 4800
    const calls = refundMock.createRefund.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0].amount).toBe(6000);
    expect(calls[1][0].amount).toBe(4800);
  });

  it('cancelInTransit : sans prorata → 100 % refund', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({ id: 'T', tenantId: 'T1' });
    prismaMock.tenantBusinessConfig.findUniqueOrThrow.mockResolvedValue({
      incidentRefundProrataEnabled: false,
    });
    prismaMock.ticket.findMany.mockResolvedValue([
      { id: 'TK1', pricePaid: 5_000, status: 'CONFIRMED' },
    ]);
    await service.cancelInTransit('T1', 'T',
      { id: 'U1', tenantId: 'T1', roleId: 'R' } as any,
      { reason: 'accident' },
    );
    expect(refundMock.createRefund.mock.calls[0][0].amount).toBe(5_000);
    expect(refundMock.createRefund.mock.calls[0][0].policyPercent).toBe(1);
  });

  // ─── declareMajorDelay ────────────────────────────────────────────────────

  it('declareMajorDelay : sélectionne le bon palier délai et émet voucher', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', tenantId: 'T1', compensationPolicyOverride: null, compensationFormOverride: null,
    });
    prismaMock.tenantBusinessConfig.findUniqueOrThrow.mockResolvedValue({
      incidentCompensationEnabled: true,
      incidentCompensationFormDefault: CompensationForm.VOUCHER,
      incidentCompensationDelayTiers: [
        { delayMinutes: 30,  compensationPct: 0,    snackBundle: null },
        { delayMinutes: 60,  compensationPct: 0.1,  snackBundle: 'SNACK_LIGHT' },
        { delayMinutes: 120, compensationPct: 0.25, snackBundle: 'SNACK_FULL' },
        { delayMinutes: 240, compensationPct: 0.5,  snackBundle: 'MEAL' },
      ],
      incidentVoucherValidityDays: 180,
      incidentVoucherUsageScope: 'SAME_COMPANY',
    });
    prismaMock.ticket.findMany.mockResolvedValue([
      { id: 'TK1', pricePaid: 10_000, passengerName: 'X', passengerPhone: '+241',
        passengerEmail: null, customerId: null, status: 'BOARDED' },
    ]);
    const result = await service.declareMajorDelay('T1', 'T', 150,
      { id: 'U1', tenantId: 'T1', roleId: 'R' } as any);
    // 150 min → palier 120 (match), compensationPct 0.25 → voucher 2500
    expect(result.tierApplied?.delayMinutes).toBe(120);
    expect(result.tierApplied?.compensationPct).toBe(0.25);
    expect(voucherMock.issue).toHaveBeenCalledWith(expect.objectContaining({
      amount:       2500,
      origin:       'MAJOR_DELAY',
      usageScope:   'SAME_COMPANY',
      validityDays: 180,
    }));
    // Snack bundle présent → CompensationItem créé
    expect(prismaMock.compensationItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ itemType: 'SNACK_FULL' }),
    }));
    expect(result.compensations).toBe(1);
  });

  it('declareMajorDelay : form=MIXED → split refund 50% + voucher 50%', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', tenantId: 'T1', compensationPolicyOverride: null, compensationFormOverride: null,
    });
    prismaMock.tenantBusinessConfig.findUniqueOrThrow.mockResolvedValue({
      incidentCompensationEnabled: true,
      incidentCompensationFormDefault: CompensationForm.MIXED,
      incidentCompensationDelayTiers: [{ delayMinutes: 60, compensationPct: 0.2, snackBundle: null }],
      incidentVoucherValidityDays: 30,
      incidentVoucherUsageScope: 'SAME_COMPANY',
    });
    prismaMock.ticket.findMany.mockResolvedValue([
      { id: 'TK1', pricePaid: 10_000, passengerName: 'X', passengerPhone: null,
        passengerEmail: null, customerId: null, status: 'BOARDED' },
    ]);
    await service.declareMajorDelay('T1', 'T', 90, { id: 'U1', tenantId: 'T1', roleId: 'R' } as any);
    // compAmount = 2000. MIXED : refund 1000 + voucher 1000.
    expect(refundMock.createRefund.mock.calls[0][0].amount).toBe(1000);
    expect(voucherMock.issue.mock.calls[0][0].amount).toBe(1000);
  });

  it('declareMajorDelay : trip compensationPolicyOverride prend le pas sur config tenant', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', tenantId: 'T1',
      compensationPolicyOverride: [{ delayMinutes: 30, compensationPct: 0.5, snackBundle: null }], // override VIP
      compensationFormOverride:   null,
    });
    prismaMock.tenantBusinessConfig.findUniqueOrThrow.mockResolvedValue({
      incidentCompensationEnabled: true,
      incidentCompensationFormDefault: CompensationForm.VOUCHER,
      incidentCompensationDelayTiers: [{ delayMinutes: 60, compensationPct: 0.1, snackBundle: null }],
      incidentVoucherValidityDays: 30,
      incidentVoucherUsageScope: 'SAME_COMPANY',
    });
    prismaMock.ticket.findMany.mockResolvedValue([
      { id: 'TK1', pricePaid: 10_000, passengerName: 'X', customerId: null, status: 'BOARDED' },
    ]);
    const res = await service.declareMajorDelay('T1', 'T', 45, { id: 'U1', tenantId: 'T1', roleId: 'R' } as any);
    // 45 min : override palier 30 → 0.5 (50%) s'applique, PAS le tenant palier 60 (0.1)
    expect(res.tierApplied?.compensationPct).toBe(0.5);
    expect(voucherMock.issue.mock.calls[0][0].amount).toBe(5000);
  });

  it('declareMajorDelay : délai sous tous les paliers → aucune compensation', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', tenantId: 'T1', compensationPolicyOverride: null, compensationFormOverride: null,
    });
    prismaMock.tenantBusinessConfig.findUniqueOrThrow.mockResolvedValue({
      incidentCompensationEnabled: true,
      incidentCompensationFormDefault: CompensationForm.VOUCHER,
      incidentCompensationDelayTiers: [{ delayMinutes: 60, compensationPct: 0.1, snackBundle: null }],
      incidentVoucherValidityDays: 30,
      incidentVoucherUsageScope: 'SAME_COMPANY',
    });
    const res = await service.declareMajorDelay('T1', 'T', 20, { id: 'U1', tenantId: 'T1', roleId: 'R' } as any);
    expect(res.compensations).toBe(0);
    expect(voucherMock.issue).not.toHaveBeenCalled();
    expect(refundMock.createRefund).not.toHaveBeenCalled();
  });

  it('declareMajorDelay : rejette delayMinutes < 0', async () => {
    await expect(service.declareMajorDelay('T1', 'T', -10, { id: 'U1', tenantId: 'T1', roleId: 'R' } as any))
      .rejects.toThrow('delayMinutes');
  });
});
