/**
 * TenantModuleService — unit tests.
 *
 * Cible : tracer précisément activation / désactivation d'un module (qui,
 * quand, dans quel sens). Garantit que :
 *   - À l'activation, `activatedAt` est horodaté, `deactivatedAt` remis à null
 *   - À la désactivation, `deactivatedAt` + `deactivatedBy` sont renseignés
 *   - L'upsert fonctionne en création (ligne inexistante) comme en update
 *   - Le cache Redis `module:{tenantId}:{moduleKey}` est invalidé à chaque write
 *   - L'actorId optionnel est respecté (null accepté pour scripts système)
 */

import { TenantModuleService } from '../../../src/modules/tenant/tenant-module.service';

function makePrismaMock(upsertReturn: Partial<any> = {}) {
  return {
    installedModule: {
      upsert: jest.fn().mockResolvedValue({
        moduleKey: 'ticketing', isActive: true, config: {},
        activatedAt: new Date('2026-04-20'), activatedBy: 'user-1',
        deactivatedAt: null, deactivatedBy: null,
        ...upsertReturn,
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeRedisMock() {
  return { del: jest.fn().mockResolvedValue(1) };
}

function makePlatformConfigMock(enabled = true) {
  return {
    getBoolean: jest.fn().mockResolvedValue(enabled),
  };
}

describe('TenantModuleService.setActive', () => {
  it('active un module et horodate activatedAt + activatedBy', async () => {
    const prisma = makePrismaMock();
    const redis  = makeRedisMock();
    const svc    = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, redis as any);

    const result = await svc.setActive('tenant-1', 'ticketing', true, 'user-admin');

    expect(result.isActive).toBe(true);
    expect(prisma.installedModule.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.installedModule.upsert.mock.calls[0][0];
    expect(call.update.isActive).toBe(true);
    expect(call.update.activatedAt).toBeInstanceOf(Date);
    expect(call.update.activatedBy).toBe('user-admin');
    expect(call.update.deactivatedAt).toBeNull();
    expect(call.update.deactivatedBy).toBeNull();
  });

  it('désactive un module et horodate deactivatedAt + deactivatedBy', async () => {
    const prisma = makePrismaMock({
      isActive: false,
      deactivatedAt: new Date('2026-04-20'), deactivatedBy: 'user-admin',
    });
    const redis  = makeRedisMock();
    const svc    = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, redis as any);

    const result = await svc.setActive('tenant-1', 'ticketing', false, 'user-admin');

    expect(result.isActive).toBe(false);
    expect(result.deactivatedBy).toBe('user-admin');
    const call = prisma.installedModule.upsert.mock.calls[0][0];
    expect(call.update.isActive).toBe(false);
    expect(call.update.deactivatedAt).toBeInstanceOf(Date);
    expect(call.update.deactivatedBy).toBe('user-admin');
    // L'update ne touche PAS activatedAt (on conserve l'horodatage originel)
    expect(call.update.activatedAt).toBeUndefined();
    expect(call.update.activatedBy).toBeUndefined();
  });

  it('supporte actorId null (scripts système, seed, backfill)', async () => {
    const prisma = makePrismaMock();
    const redis  = makeRedisMock();
    const svc    = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, redis as any);

    await svc.setActive('tenant-1', 'parcels', true);

    const call = prisma.installedModule.upsert.mock.calls[0][0];
    expect(call.update.activatedBy).toBeNull();
    expect(call.create.activatedBy).toBeNull();
  });

  it('invalide le cache Redis après chaque write', async () => {
    const prisma = makePrismaMock();
    const redis  = makeRedisMock();
    const svc    = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, redis as any);

    await svc.setActive('tenant-42', 'qhse', true, 'user-x');

    expect(redis.del).toHaveBeenCalledWith('module:tenant-42:qhse');
  });

  it("n'échoue pas si Redis est indisponible (warn only)", async () => {
    const prisma = makePrismaMock();
    const redis  = { del: jest.fn().mockRejectedValue(new Error('boom')) };
    const svc    = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, redis as any);

    await expect(svc.setActive('tenant-1', 'ticketing', true, 'user-1'))
      .resolves.toBeDefined();
  });

  it('branche create : active → activatedAt/By set, deactivated null', async () => {
    const prisma = makePrismaMock();
    const redis  = makeRedisMock();
    const svc    = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, redis as any);

    await svc.setActive('tenant-1', 'parcels', true, 'user-x');
    const call = prisma.installedModule.upsert.mock.calls[0][0];
    expect(call.create.isActive).toBe(true);
    expect(call.create.activatedAt).toBeInstanceOf(Date);
    expect(call.create.activatedBy).toBe('user-x');
    expect(call.create.deactivatedAt).toBeNull();
    expect(call.create.deactivatedBy).toBeNull();
  });
});

describe('TenantModuleService.listForTenant', () => {
  it('retourne tous les champs de traçabilité', async () => {
    const prisma = {
      installedModule: {
        findMany: jest.fn().mockResolvedValue([
          {
            moduleKey: 'ticketing', isActive: true, config: {},
            activatedAt: new Date('2026-01-01'), activatedBy: 'user-1',
            deactivatedAt: null, deactivatedBy: null,
          },
          {
            moduleKey: 'qhse', isActive: false, config: {},
            activatedAt: new Date('2026-02-01'), activatedBy: 'user-1',
            deactivatedAt: new Date('2026-04-10'), deactivatedBy: 'user-2',
          },
        ]),
        upsert: jest.fn(),
      },
    };
    const svc = new TenantModuleService(prisma as any, makePlatformConfigMock() as any, makeRedisMock() as any);

    const list = await svc.listForTenant('tenant-1');

    expect(list).toHaveLength(2);
    expect(list[0].activatedBy).toBe('user-1');
    expect(list[1].deactivatedBy).toBe('user-2');
    expect(list[1].isActive).toBe(false);
  });
});
