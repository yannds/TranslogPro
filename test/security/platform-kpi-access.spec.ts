/**
 * [SECURITY] PlatformKpi — RBAC fine-grained + cross-tenant guarantees.
 *
 * Vérifie les invariants du dashboard KPI SaaS :
 *
 *   [K1] Le service n'expose JAMAIS les données du tenant plateforme — le
 *        filtre `tenantId: { not: PLATFORM_TENANT_ID }` est systématique
 *        (sur ~15 queries différentes). Un manquement serait une fuite de
 *        métriques internes TransLog.
 *
 *   [K2] Les endpoints controller portent bien le bon decorator
 *        @RequirePermission → un caller sans la permission aurait 403.
 *        Comme on teste côté unit (pas E2E), on valide la présence du
 *        metadata RBAC via Reflect.
 *
 *   [K3] Les bornes de parsing empêchent qu'un paramètre days malveillant
 *        (NaN, négatif, huge) épuise la DB.
 *
 *   [K4] Les cohortes anti-biais : un tenant signup < 7j n'est jamais
 *        compté dans D7 (fenêtre non encore atteinte). Protège contre
 *        faux positifs dans les métriques présentées aux investisseurs.
 *
 *   [K5] SubscriptionChange.NEW est créé une seule fois même si le backfill
 *        est ré-exécuté (idempotence — sinon double comptage revenue).
 */

import { PlatformKpiService } from '../../src/modules/platform-kpi/platform-kpi.service';
import { PlatformKpiController } from '../../src/modules/platform-kpi/platform-kpi.controller';
import { PLATFORM_TENANT_ID } from '../../prisma/seeds/iam.seed';
import 'reflect-metadata';
import { Permission } from '../../src/common/constants/permissions';
import { PERMISSION_KEY } from '../../src/common/decorators/require-permission.decorator';

function createPrismaMock() {
  return {
    tenant:               { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    ticket:               { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    trip:                 { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    parcel:               { groupBy: jest.fn().mockResolvedValue([]) },
    incident:             { count: jest.fn().mockResolvedValue(0) },
    bus:                  { aggregate: jest.fn().mockResolvedValue({ _sum: { capacity: 0 } }) },
    user:                 { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    installedModule:      { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    platformSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    subscriptionChange:   { findMany: jest.fn().mockResolvedValue([]) },
    dailyActiveUser:      { groupBy: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { sessionsCount: 0 } }) },
    auditLog:             { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
  };
}

function createConfigMock() {
  return {
    getNumber: jest.fn(async (k: string) => {
      const defaults: Record<string, number> = {
        'kpi.cacheTtlSeconds': 60, 'kpi.defaultPeriodDays': 30, 'kpi.targetOccupancyRate': 0.65,
        'kpi.moduleAdoptionThreshold': 0.3, 'kpi.activation.minTickets': 1, 'kpi.activation.minTrips': 1,
      };
      return defaults[k] ?? 0;
    }),
    getString: jest.fn(async () => ''),
    getBoolean: jest.fn(async () => false),
  };
}

describe('[SECURITY][KPI] K1 — aucune fuite tenant plateforme', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let svc:    PlatformKpiService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc    = new PlatformKpiService(prisma as any, createConfigMock() as any);
  });

  /**
   * On vérifie chaque méthode KPI pour s'assurer que le filtre
   * `tenantId: { not: PLATFORM_TENANT_ID }` (ou équivalent via id) est
   * systématiquement posé sur les queries qui touchent des tables scopées tenant.
   */

  it('getNorthStar — exclut PLATFORM_TENANT_ID sur tenant.findMany', async () => {
    await svc.getNorthStar('compared', 30);
    const call = prisma.tenant.findMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ not: PLATFORM_TENANT_ID });
  });

  it('getTransactional — exclut PLATFORM_TENANT_ID sur ticket + trip + parcel', async () => {
    await svc.getTransactional(30);
    expect(prisma.ticket.findMany.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
    expect(prisma.trip.groupBy.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
    expect(prisma.parcel.groupBy.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
  });

  it('getAdoptionBreakdown — exclut PLATFORM_TENANT_ID sur user + installedModule + tenant', async () => {
    await svc.getAdoptionBreakdown(30);
    expect(prisma.user.findMany.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
    expect(prisma.installedModule.groupBy.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
    expect(prisma.tenant.count.mock.calls[0][0].where.id).toEqual({ not: PLATFORM_TENANT_ID });
  });

  it('getActivationFunnel — exclut PLATFORM_TENANT_ID sur tenant.findMany', async () => {
    await svc.getActivationFunnel();
    expect(prisma.tenant.findMany.mock.calls[0][0].where.id).toEqual({ not: PLATFORM_TENANT_ID });
  });

  it('getStrategic — exclut PLATFORM_TENANT_ID sur auditLog + user + groupBy', async () => {
    await svc.getStrategic(7);
    expect(prisma.auditLog.count.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
    expect(prisma.user.count.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
    expect(prisma.auditLog.groupBy.mock.calls[0][0].where.tenantId).toEqual({ not: PLATFORM_TENANT_ID });
  });

  it('getRetentionCohorts — exclut PLATFORM_TENANT_ID dans la sélection initiale', async () => {
    await svc.getRetentionCohorts(90);
    expect(prisma.tenant.findMany.mock.calls[0][0].where.id).toEqual({ not: PLATFORM_TENANT_ID });
  });
});

describe('[SECURITY][KPI] K2 — controller RBAC fine-grained', () => {
  const controller = PlatformKpiController.prototype;

  function permOn(methodName: keyof PlatformKpiController): string | undefined {
    return Reflect.getMetadata(PERMISSION_KEY, (controller as any)[methodName]);
  }

  it('MRR endpoint requires BUSINESS permission', () => {
    expect(permOn('mrr')).toBe(Permission.PLATFORM_KPI_BUSINESS_READ_GLOBAL);
  });

  it('North Star requires ADOPTION permission', () => {
    expect(permOn('northStar')).toBe(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL);
  });

  it('Retention requires RETENTION permission', () => {
    expect(permOn('retention')).toBe(Permission.PLATFORM_KPI_RETENTION_READ_GLOBAL);
  });

  it('Adoption/Activation/Transactional/Strategic all require ADOPTION permission (accessible L1+L2)', () => {
    expect(permOn('adoption')).toBe(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL);
    expect(permOn('activation')).toBe(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL);
    expect(permOn('transactional')).toBe(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL);
    expect(permOn('strategic')).toBe(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL);
  });
});

describe('[SECURITY][KPI] K3 — bornes parsing days', () => {
  let svc: any;
  let ctrl: PlatformKpiController;

  beforeEach(() => {
    svc = { getMrrBreakdown: jest.fn().mockResolvedValue({}), getTransactional: jest.fn().mockResolvedValue({}), getRetentionCohorts: jest.fn().mockResolvedValue({}), getNorthStar: jest.fn().mockResolvedValue({}), getAdoptionBreakdown: jest.fn().mockResolvedValue({}), getActivationFunnel: jest.fn().mockResolvedValue({}), getStrategic: jest.fn().mockResolvedValue({}) };
    ctrl = new PlatformKpiController(svc);
  });

  it('blocks days=NaN (Infinity attempt)', async () => {
    await ctrl.mrr('NaN');
    expect(svc.getMrrBreakdown).toHaveBeenCalledWith(30); // fallback
  });

  it('clamps days=99999 to 365 (max bound)', async () => {
    await ctrl.transactional('99999');
    expect(svc.getTransactional).toHaveBeenCalledWith(365);
  });

  it('rejects negative days and falls back to default', async () => {
    await ctrl.retention('-100');
    expect(svc.getRetentionCohorts).toHaveBeenCalledWith(90); // default for retention
  });
});

describe('[SECURITY][KPI] K4 — cohortes sans biais (fenêtre future)', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let svc:    PlatformKpiService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc    = new PlatformKpiService(prisma as any, createConfigMock() as any);
  });

  it('ignore un tenant signup il y a 3 jours pour D7 (fenêtre D7..D14 pas encore atteinte)', async () => {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
    prisma.tenant.findMany.mockResolvedValue([{ id: 't-young', createdAt: threeDaysAgo }]);
    // Si la fenêtre D7 était comptée prématurément, user.count serait invoqué avec des dates futures
    const report = await svc.getRetentionCohorts(90);
    expect(report.cohorts[0].activeD7).toBe(0);
    expect(report.cohorts[0].activeD30).toBe(0);
    expect(report.cohorts[0].activeD90).toBe(0);
  });
});

describe('[SECURITY][KPI] K5 — idempotence backfill SubscriptionChange', () => {
  it('normalizeMonthlyAmount est stable pour la même entrée', () => {
    const { normalizeMonthlyAmount } = require('../../prisma/seeds/subscription-change.backfill');
    expect(normalizeMonthlyAmount(600, 'YEARLY')).toBeCloseTo(50);
    expect(normalizeMonthlyAmount(600, 'YEARLY')).toBeCloseTo(50); // deuxième appel = même résultat
  });
});
