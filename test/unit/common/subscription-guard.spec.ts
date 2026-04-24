import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionGuard } from '../../../src/common/guards/subscription.guard';

function buildCtx(user: { tenantId?: string } | undefined, path: string): ExecutionContext {
  const req = { user, path };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler:   () => ({}),
    getClass:     () => ({}),
  } as unknown as ExecutionContext;
}

function mocks(status: string | null) {
  const redis = {
    get:   jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
  const prisma = {
    platformSubscription: {
      findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
    },
  };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
  return { redis, prisma, reflector };
}

describe('SubscriptionGuard', () => {
  it('laisse passer si pas de tenantId dans req.user (non authentifié)', async () => {
    const m = mocks(null);
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx(undefined, '/api/trips');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('laisse passer le tenant plateforme (zeros UUID)', async () => {
    const m = mocks('SUSPENDED');
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx({ tenantId: '00000000-0000-0000-0000-000000000000' }, '/api/trips');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('TRIAL → accès complet à toutes les routes', async () => {
    const m = mocks('TRIAL');
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('ACTIVE → accès complet', async () => {
    const m = mocks('ACTIVE');
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/tickets');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('PAST_DUE → accès complet', async () => {
    const m = mocks('PAST_DUE');
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/parcels');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('GRACE_PERIOD → accès complet (trial expiré mais délai en cours)', async () => {
    const m = mocks('GRACE_PERIOD');
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  describe('SUSPENDED', () => {
    it('bloque les routes non whitelistées avec code SUBSCRIPTION_SUSPENDED', async () => {
      const m = mocks('SUSPENDED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('autorise /api/auth/*', async () => {
      const m = mocks('SUSPENDED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/auth/sign-out');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('autorise /api/subscription/*', async () => {
      const m = mocks('SUSPENDED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/subscription/checkout');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('autorise /api/subscription/payment-methods', async () => {
      const m = mocks('SUSPENDED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/subscription/payment-methods');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('autorise /api/backup/gdpr (export RGPD)', async () => {
      const m = mocks('SUSPENDED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/backup/gdpr');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('bloque /api/backup/jobs (backup non-gdpr) pour SUSPENDED', async () => {
      const m = mocks('SUSPENDED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/backup/jobs');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('CANCELLED', () => {
    it('bloque routes non whitelistées', async () => {
      const m = mocks('CANCELLED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('autorise GDPR export', async () => {
      const m = mocks('CANCELLED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/backup/gdpr');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('CHURNED', () => {
    it('toujours 403 avec code SUBSCRIPTION_CHURNED — même sur routes whitelistées', async () => {
      const m = mocks('CHURNED');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx1 = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
      await expect(guard.canActivate(ctx1)).rejects.toThrow(ForbiddenException);
      const ctx2 = buildCtx({ tenantId: 'tenant-1' }, '/api/subscription/checkout');
      await expect(guard.canActivate(ctx2)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cache Redis', () => {
    it('utilise le cache si présent (pas de query Prisma)', async () => {
      const m = mocks('ACTIVE');
      m.redis.get.mockResolvedValueOnce('ACTIVE');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
      await guard.canActivate(ctx);
      expect(m.prisma.platformSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('tape la DB + setex si cache miss', async () => {
      const m = mocks('ACTIVE');
      const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
      const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
      await guard.canActivate(ctx);
      expect(m.prisma.platformSubscription.findUnique).toHaveBeenCalled();
      expect(m.redis.setex).toHaveBeenCalledWith('sub:status:tenant-1', 60, 'ACTIVE');
    });
  });

  it('saute le guard si SkipSubscriptionGuard() métadonnée présente', async () => {
    const m = mocks('SUSPENDED');
    (m.reflector.getAllAndOverride as jest.Mock).mockReturnValueOnce(true);
    const guard = new SubscriptionGuard(m.prisma as any, m.redis as any, m.reflector);
    const ctx = buildCtx({ tenantId: 'tenant-1' }, '/api/trips');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
