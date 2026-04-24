/**
 * RefundService — Gap B5 voucher fallback on REJECT.
 *
 * Isole le comportement `maybeIssueFallbackVoucher` : doit émettre un voucher
 * de courtoisie après un Refund REJECTED si `TenantBusinessConfig.voucherFallbackOnRejectEnabled`
 * est activé. Sinon no-op. Un échec d'émission ne bloque pas le REJECT qui reste acquis.
 */
import { RefundService } from '../../../src/modules/sav/refund.service';
import { RefundAction } from '../../../src/common/constants/workflow-states';

const TENANT = 'tenant-fallback-001';
const REFUND_ID = 'refund-001';
const ACTOR = { id: 'user-admin', tenantId: TENANT, roleId: 'role-admin' } as any;

function makePrisma(overrides: {
  configFallbackEnabled?: boolean;
  configPct?:             number;
  configValidityDays?:    number;
  refundAmount?:          number;
  ticketFound?:           boolean;
} = {}) {
  return {
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue({
        voucherFallbackOnRejectEnabled:      overrides.configFallbackEnabled ?? false,
        voucherFallbackOnRejectPct:          overrides.configPct ?? 0.5,
        voucherFallbackOnRejectValidityDays: overrides.configValidityDays ?? 90,
      }),
    },
    refund: {
      findFirst: jest.fn().mockResolvedValue({
        id:       REFUND_ID,
        amount:   overrides.refundAmount ?? 10000,
        currency: 'XAF',
        ticketId: 'ticket-001',
        tripId:   'trip-001',
        status:   'REJECTED',
      }),
    },
    ticket: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.ticketFound === false ? null : {
          customerId:      'customer-001',
          passengerPhone:  '+242061234567',
          passengerEmail:  'alice@example.com',
        },
      ),
    },
  };
}

function makeWorkflow() {
  return {
    transition: jest.fn().mockResolvedValue({ entity: { id: REFUND_ID, status: 'REJECTED' }, toState: 'REJECTED', fromState: 'PENDING' }),
  };
}

function makeCashier() {
  return {
    recordTransaction:          jest.fn(),
    getOrCreateVirtualRegister: jest.fn(),
  };
}

function makeVoucher() {
  return {
    issue: jest.fn().mockResolvedValue({ id: 'voucher-001', code: 'V-ABC123', amount: 5000 }),
  };
}

function build(overrides: Parameters<typeof makePrisma>[0] = {}) {
  const prisma   = makePrisma(overrides);
  const workflow = makeWorkflow();
  const policy   = {} as any;
  const bus      = { publish: jest.fn(), subscribe: jest.fn() };
  const cashier  = makeCashier();
  const voucher  = makeVoucher();
  const payout   = { executeRefundPayout: jest.fn().mockResolvedValue({ status: 'SKIPPED' }) };
  const service  = new RefundService(
    prisma as any,
    workflow as any,
    policy,
    bus as any,
    cashier as any,
    voucher as any,
    payout as any,
  );
  return { service, prisma, workflow, voucher, cashier, payout };
}

describe('RefundService.reject — gap B5 voucher fallback', () => {
  it('noop si voucherFallbackOnRejectEnabled=false (défaut)', async () => {
    const { service, voucher } = build({ configFallbackEnabled: false });
    await service.reject(TENANT, REFUND_ID, ACTOR, 'Hors délai');
    expect(voucher.issue).not.toHaveBeenCalled();
  });

  it('émet voucher GESTURE = refund × pct si config activée', async () => {
    const { service, voucher } = build({
      configFallbackEnabled: true,
      configPct:             0.5,
      configValidityDays:    120,
      refundAmount:          10000,
    });
    await service.reject(TENANT, REFUND_ID, ACTOR);
    expect(voucher.issue).toHaveBeenCalledWith(expect.objectContaining({
      tenantId:       TENANT,
      amount:         5000,         // 10000 * 0.5
      currency:       'XAF',
      validityDays:   120,
      usageScope:     'SAME_COMPANY',
      origin:         'GESTURE',
      sourceTicketId: 'ticket-001',
      sourceTripId:   'trip-001',
      customerId:     'customer-001',
      recipientPhone: '+242061234567',
      metadata:       expect.objectContaining({ sourceRefundId: REFUND_ID, reason: 'REFUND_REJECTED_FALLBACK' }),
    }));
  });

  it('skip émission si pct=0 (amount=0)', async () => {
    const { service, voucher } = build({ configFallbackEnabled: true, configPct: 0 });
    await service.reject(TENANT, REFUND_ID, ACTOR);
    expect(voucher.issue).not.toHaveBeenCalled();
  });

  it('clamp pct si >1 : utilise 1.0 (refund entier en voucher)', async () => {
    const { service, voucher } = build({
      configFallbackEnabled: true,
      configPct:             2.5,          // hors bornes → clamp
      refundAmount:          8000,
    });
    await service.reject(TENANT, REFUND_ID, ACTOR);
    expect(voucher.issue).toHaveBeenCalledWith(expect.objectContaining({ amount: 8000 }));
  });

  it('ticket orphelin : voucher émis avec customerId null (shadow)', async () => {
    const { service, voucher } = build({
      configFallbackEnabled: true,
      ticketFound:           false,
    });
    await service.reject(TENANT, REFUND_ID, ACTOR);
    expect(voucher.issue).toHaveBeenCalledWith(expect.objectContaining({
      customerId:     null,
      recipientPhone: null,
      recipientEmail: null,
    }));
  });

  it('échec voucher.issue() ne bloque PAS le REJECT (best-effort)', async () => {
    const { service, voucher, workflow } = build({ configFallbackEnabled: true });
    (voucher.issue as jest.Mock).mockRejectedValue(new Error('DB down'));
    // Ne throw PAS — le reject doit aboutir proprement
    await expect(service.reject(TENANT, REFUND_ID, ACTOR)).resolves.toBeDefined();
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: RefundAction.REJECT }),
      expect.anything(),
    );
  });
});
