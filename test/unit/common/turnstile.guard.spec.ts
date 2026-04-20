import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TurnstileGuard, REQUIRE_CAPTCHA_KEY } from '../../../src/common/captcha/turnstile.guard';

/**
 * Tests unit — TurnstileGuard (2026-04-20).
 * Scénarios couverts :
 *   - Pas de @RequireCaptcha() → passage libre
 *   - Tenant avec captchaEnabled=false → passage libre (feature flag OFF)
 *   - Service non configuré (Vault absent) → fail-open avec log warn
 *   - Tenant captchaEnabled=true + service configuré + token valide → OK
 *   - Token manquant → 403
 */
describe('TurnstileGuard', () => {
  function makeCtx(opts: {
    requireCaptcha: boolean;
    tenantId?:      string;
    tenantSlug?:    string;
    token?:         string | null;
  }): ExecutionContext {
    const reflector = { get: jest.fn((key) => key === REQUIRE_CAPTCHA_KEY ? opts.requireCaptcha : undefined) } as unknown as Reflector;
    (makeCtx as any).__reflector = reflector;
    const req: any = {
      headers: opts.token ? { 'x-captcha-token': opts.token } : {},
      params:  { tenantId: opts.tenantId, tenantSlug: opts.tenantSlug },
      body:    {},
      socket:  { remoteAddress: '1.2.3.4' },
    };
    return {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  function makeGuard(opts: {
    captchaEnabled?: boolean | null;
    isConfigured:   boolean;
    verifyOk?:      boolean;
    tenantIdFromSlug?: string;
  }) {
    const turnstile = {
      isConfigured: jest.fn().mockResolvedValue(opts.isConfigured),
      verify:       jest.fn().mockResolvedValue({ ok: opts.verifyOk ?? true }),
    };
    const prisma: any = {
      tenantBusinessConfig: {
        findUnique: jest.fn().mockResolvedValue(
          opts.captchaEnabled === null ? null : { captchaEnabled: opts.captchaEnabled ?? false },
        ),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(opts.tenantIdFromSlug ? { id: opts.tenantIdFromSlug } : null),
      },
    };
    const reflector = new Reflector();
    return { guard: new TurnstileGuard(reflector, turnstile as any, prisma), turnstile, prisma };
  }

  it('laisse passer si @RequireCaptcha() absent', async () => {
    const { guard } = makeGuard({ isConfigured: true });
    const ctx = makeCtx({ requireCaptcha: false, tenantId: 't1' });
    // Simule le reflector qui retourne undefined
    (guard as any).reflector = { get: () => undefined };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('laisse passer si tenant.captchaEnabled=false', async () => {
    const { guard, turnstile } = makeGuard({ captchaEnabled: false, isConfigured: true });
    const ctx = makeCtx({ requireCaptcha: true, tenantId: 't1' });
    (guard as any).reflector = { get: () => true };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(turnstile.verify).not.toHaveBeenCalled();
  });

  it('fail-open avec log si service non configuré', async () => {
    const { guard, turnstile } = makeGuard({ captchaEnabled: true, isConfigured: false });
    const ctx = makeCtx({ requireCaptcha: true, tenantId: 't1' });
    (guard as any).reflector = { get: () => true };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(turnstile.verify).not.toHaveBeenCalled();
  });

  it('bloque 403 si token manquant (captchaEnabled + configured)', async () => {
    const { guard } = makeGuard({ captchaEnabled: true, isConfigured: true, verifyOk: false });
    const ctx = makeCtx({ requireCaptcha: true, tenantId: 't1', token: null });
    (guard as any).reflector = { get: () => true };
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('passe si token validé par service', async () => {
    const { guard } = makeGuard({ captchaEnabled: true, isConfigured: true, verifyOk: true });
    const ctx = makeCtx({ requireCaptcha: true, tenantId: 't1', token: 'valid-token' });
    (guard as any).reflector = { get: () => true };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('résout tenantId depuis tenantSlug si fourni', async () => {
    const { guard, prisma } = makeGuard({ captchaEnabled: false, isConfigured: true, tenantIdFromSlug: 't-resolved' });
    const ctx = makeCtx({ requireCaptcha: true, tenantSlug: 'trans-express' });
    (guard as any).reflector = { get: () => true };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: 'trans-express' },
    }));
  });
});
