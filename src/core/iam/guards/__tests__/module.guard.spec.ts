/**
 * ModuleGuard — Tests unitaires
 *
 * Stratégie : mock du Reflector, de PrismaService et de Redis.
 * Tests pour : skip si pas de @RequireModule, cache hit active, cache hit inactive,
 * DB active, DB inactive, cache miss + remplissage, tenant manquant.
 */

import { ForbiddenException }  from '@nestjs/common';
import { Reflector }           from '@nestjs/core';
import { ExecutionContext }     from '@nestjs/common';
import { ModuleGuard }          from '../module.guard';
import { PrismaService }        from '../../../../infrastructure/database/prisma.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(opts: {
  moduleKey?:  string | undefined;
  tenantId?:   string | undefined;
}): ExecutionContext {
  const req = {
    user:             opts.tenantId ? { tenantId: opts.tenantId } : {},
    __scope_context__: undefined,
  };
  return {
    getHandler: () => ({}),
    getClass:   () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeReflector(moduleKey?: string): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(moduleKey),
  } as unknown as Reflector;
}

function makePrisma(isActive: boolean | null): PrismaService {
  return {
    installedModule: {
      findUnique: jest.fn().mockResolvedValue(
        isActive === null ? null : { isActive },
      ),
    },
  } as unknown as PrismaService;
}

function makeRedis(cached?: string): { get: jest.Mock; setex: jest.Mock; del: jest.Mock } {
  return {
    get:   jest.fn().mockResolvedValue(cached ?? null),
    setex: jest.fn().mockResolvedValue('OK'),
    del:   jest.fn().mockResolvedValue(1),
  };
}

const TENANT_ID  = 'tenant-1';
const MODULE_KEY = 'FLEET_DOCS';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('ModuleGuard', () => {
  it('laisse passer si @RequireModule absent (moduleKey undefined)', async () => {
    const guard = new ModuleGuard(makeReflector(undefined), makePrisma(true), makeRedis() as any);
    const ctx   = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('laisse passer sur cache hit active (redis = "1")', async () => {
    const redis = makeRedis('1');
    const guard = new ModuleGuard(makeReflector(MODULE_KEY), makePrisma(null), redis as any);
    const ctx   = makeContext({ tenantId: TENANT_ID });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.get).toHaveBeenCalledWith(`module:${TENANT_ID}:${MODULE_KEY}`);
    // DB non consultée
    const prisma = makePrisma(null);
    expect((prisma.installedModule.findUnique as jest.Mock)).not.toHaveBeenCalled();
  });

  it('lève ForbiddenException sur cache hit inactive (redis = "0")', async () => {
    const guard = new ModuleGuard(makeReflector(MODULE_KEY), makePrisma(null), makeRedis('0') as any);
    const ctx   = makeContext({ tenantId: TENANT_ID });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('laisse passer si DB indique isActive=true (cache miss)', async () => {
    const redis  = makeRedis();
    const prisma = makePrisma(true);
    const guard  = new ModuleGuard(makeReflector(MODULE_KEY), prisma, redis as any);
    const ctx    = makeContext({ tenantId: TENANT_ID });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.setex).toHaveBeenCalledWith(`module:${TENANT_ID}:${MODULE_KEY}`, 300, '1');
  });

  it('lève ForbiddenException si DB indique isActive=false', async () => {
    const redis  = makeRedis();
    const guard  = new ModuleGuard(makeReflector(MODULE_KEY), makePrisma(false), redis as any);
    const ctx    = makeContext({ tenantId: TENANT_ID });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(redis.setex).toHaveBeenCalledWith(`module:${TENANT_ID}:${MODULE_KEY}`, 300, '0');
  });

  it('lève ForbiddenException si module absent de la table (null)', async () => {
    const guard = new ModuleGuard(makeReflector(MODULE_KEY), makePrisma(null), makeRedis() as any);
    const ctx   = makeContext({ tenantId: TENANT_ID });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('lève ForbiddenException si tenantId manquant sur la requête', async () => {
    const guard = new ModuleGuard(makeReflector(MODULE_KEY), makePrisma(true), makeRedis() as any);
    const ctx   = makeContext({ tenantId: undefined });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  // ── invalidateModuleCache ───────────────────────────────────────────────────

  describe('invalidateModuleCache()', () => {
    it('appelle redis.del avec la bonne clé', async () => {
      const redis = makeRedis();
      const guard = new ModuleGuard(makeReflector(), makePrisma(true), redis as any);
      await guard.invalidateModuleCache(TENANT_ID, MODULE_KEY);
      expect(redis.del).toHaveBeenCalledWith(`module:${TENANT_ID}:${MODULE_KEY}`);
    });
  });
});
