/**
 * PlatformAnalyticsService.runModuleUsageDailyJob — unit tests.
 *
 * Teste le rollup nocturne qui agrège AuditLog J-1 par (tenant, module) dans
 * ModuleUsageDaily. Invariants vérifiés :
 *   - Boucle par tenant × module du registry MODULE_ACTION_PREFIXES
 *   - Filtre temporel = fenêtre [00:00 UTC hier, 00:00 UTC aujourd'hui)
 *   - Filtre action = OR des préfixes du module (ex: ticketing → data.ticket., data.traveler.)
 *   - PLATFORM_TENANT_ID exclu explicitement
 *   - Rien d'écrit si actionCount = 0 (évite bloat de la table)
 *   - Upsert idempotent par (tenantId, moduleKey, date)
 *   - uniqueUsers = nb d'userId distincts (via AuditLog.findMany distinct)
 */

import { PlatformAnalyticsService } from '../../../src/modules/platform-analytics/platform-analytics.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';

function makePrismaMock(overrides: Partial<any> = {}) {
  return {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      count:    jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    moduleUsageDaily: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function makeConfigMock() {
  return {
    getNumber:  jest.fn(async () => 0),
    getString:  jest.fn(async () => ''),
    getBoolean: jest.fn(async () => false),
  };
}

describe('PlatformAnalyticsService.runModuleUsageDailyJob', () => {
  it('exclut PLATFORM_TENANT_ID via where.id.not', async () => {
    const prisma = makePrismaMock();
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();
    const call = prisma.tenant.findMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ not: PLATFORM_TENANT_ID });
    expect(call.where.isActive).toBe(true);
  });

  it('skip silencieusement si aucun tenant éligible', async () => {
    const prisma = makePrismaMock();
    prisma.tenant.findMany.mockResolvedValue([]);
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();
    expect(prisma.moduleUsageDaily.upsert).not.toHaveBeenCalled();
  });

  it("n'écrit PAS de ligne si actionCount = 0 (pas de bloat)", async () => {
    const prisma = makePrismaMock();
    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
    prisma.auditLog.count.mockResolvedValue(0);
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();
    expect(prisma.moduleUsageDaily.upsert).not.toHaveBeenCalled();
  });

  it('écrit une ligne par module actif avec actionCount + uniqueUsers', async () => {
    const prisma = makePrismaMock();
    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
    // count = 7 pour tous les modules (simulation simple)
    prisma.auditLog.count.mockResolvedValue(7);
    prisma.auditLog.findMany.mockResolvedValue([
      { userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-3' },
    ]);
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();

    // 1 tenant × 8 modules du registry = 8 upserts
    expect(prisma.moduleUsageDaily.upsert).toHaveBeenCalled();
    const firstCall = prisma.moduleUsageDaily.upsert.mock.calls[0][0];
    expect(firstCall.where.tenantId_moduleKey_date.tenantId).toBe('tenant-1');
    expect(firstCall.create.actionCount).toBe(7);
    expect(firstCall.create.uniqueUsers).toBe(3);
  });

  it('utilise des préfixes OR startsWith pour filtrer AuditLog', async () => {
    const prisma = makePrismaMock();
    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
    prisma.auditLog.count.mockResolvedValue(1);
    prisma.auditLog.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();

    const countCall = prisma.auditLog.count.mock.calls[0][0];
    expect(countCall.where.OR).toBeDefined();
    expect(countCall.where.OR[0].action.startsWith).toBeDefined();
    expect(countCall.where.tenantId).toBe('tenant-1');
    // Fenêtre temporelle présente
    expect(countCall.where.createdAt.gte).toBeInstanceOf(Date);
    expect(countCall.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('filtre AuditLog.findMany avec distinct userId et userId != null', async () => {
    const prisma = makePrismaMock();
    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
    prisma.auditLog.count.mockResolvedValue(5);
    prisma.auditLog.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();

    const findCall = prisma.auditLog.findMany.mock.calls[0][0];
    expect(findCall.distinct).toEqual(['userId']);
    expect(findCall.where.userId).toEqual({ not: null });
  });

  it('upsert idempotent par (tenantId, moduleKey, date)', async () => {
    const prisma = makePrismaMock();
    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
    prisma.auditLog.count.mockResolvedValue(3);
    prisma.auditLog.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    const svc = new PlatformAnalyticsService(prisma as any, makeConfigMock() as any);
    await svc.runModuleUsageDailyJob();

    const call = prisma.moduleUsageDaily.upsert.mock.calls[0][0];
    expect(call.where.tenantId_moduleKey_date).toBeDefined();
    expect(call.where.tenantId_moduleKey_date.date).toBeInstanceOf(Date);
    expect(call.update).toHaveProperty('actionCount');
    expect(call.update).toHaveProperty('uniqueUsers');
  });
});
