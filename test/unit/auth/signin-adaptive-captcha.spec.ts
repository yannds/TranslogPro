import { AuthService } from '../../../src/modules/auth/auth.service';

/**
 * Tests unit — CAPTCHA adaptatif sur /auth/sign-in (2026-04-20).
 *
 * Politique NIST SP 800-63B + OWASP ASVS V2.2.1 :
 *   - 0-2 échecs dans la fenêtre 15min → pas de CAPTCHA, user nominal non impacté
 *   - ≥3 échecs (par IP OU par email) → 400 avec { requireCaptcha: true }
 *   - Succès → compteurs IP + email reset → prochain login normal
 */
describe('AuthService.signIn — CAPTCHA adaptatif', () => {
  function makeService(opts: { ipFails?: number; emailFails?: number; captchaValid?: boolean; captchaConfigured?: boolean }) {
    const ipFails    = opts.ipFails    ?? 0;
    const emailFails = opts.emailFails ?? 0;

    const redis: any = {
      store: new Map<string, string>(),
      get: jest.fn().mockImplementation(async (key: string) => {
        if (key.startsWith('auth:fail:ip:')) return ipFails > 0 ? String(ipFails) : null;
        if (key.startsWith('auth:fail:email:')) return emailFails > 0 ? String(emailFails) : null;
        return null;
      }),
      del: jest.fn().mockResolvedValue(0),
      multi: jest.fn().mockReturnValue({
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    const turnstile: any = {
      isConfigured: jest.fn().mockResolvedValue(opts.captchaConfigured ?? true),
      verify:       jest.fn().mockResolvedValue({ ok: opts.captchaValid ?? false, reason: opts.captchaValid ? undefined : 'cloudflare_rejected' }),
    };

    const prisma: any = {
      user:    { update: jest.fn() },
      session: { create: jest.fn().mockResolvedValue({ token: 'sess', id: 's1' }) },
      authLog: { create: jest.fn() },
    };
    const modules: any = { listActiveKeys: jest.fn().mockResolvedValue([]) };
    const mfa: any = { verifyLoginCode: jest.fn() };
    const identity: any = {
      findCredentialAccount: jest.fn().mockResolvedValue({
        id: 'acc-1',
        userId: 'u-1',
        password: '$2a$12$FAKEHASHtheusualbcrypt.padding.padding.padding',
        user: {
          id: 'u-1', tenantId: 'T1', email: 'x@y.com', name: 'X', isActive: true, mfaEnabled: false,
          userType: 'TENANT_ADMIN', roleId: 'r1', customerProfile: null,
        },
      }),
    };

    const service = new AuthService(prisma, modules, mfa, identity, turnstile, redis);
    return { service, redis, turnstile };
  }

  it('0 échec précédent → pas de CAPTCHA demandé (user nominal)', async () => {
    const { service, turnstile } = makeService({});
    // Password compare va échouer (hash fake) → UnauthorizedException attendue
    await expect(service.signIn('T1', 'x@y.com', 'wrong', '1.2.3.4', 'ua', undefined))
      .rejects.toThrow('Identifiants invalides');
    expect(turnstile.verify).not.toHaveBeenCalled();
  });

  it('3 échecs IP sans token → 400 requireCaptcha', async () => {
    const { service, turnstile } = makeService({ ipFails: 3 });
    try {
      await service.signIn('T1', 'x@y.com', 'wrong', '1.2.3.4', 'ua', undefined);
      fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(400);
      expect(err.response.requireCaptcha).toBe(true);
    }
    expect(turnstile.verify).not.toHaveBeenCalled();
  });

  it('3 échecs email (rotation IP) sans token → 400 requireCaptcha', async () => {
    const { service } = makeService({ ipFails: 0, emailFails: 3 });
    try {
      await service.signIn('T1', 'target@victim.com', 'wrong', '99.99.99.99', 'ua');
      fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(400);
      expect(err.response.requireCaptcha).toBe(true);
    }
  });

  it('3 échecs + token invalide → 400 avec requireCaptcha + reason', async () => {
    const { service, turnstile } = makeService({ ipFails: 3, captchaValid: false });
    try {
      await service.signIn('T1', 'x@y.com', 'wrong', '1.2.3.4', 'ua', 'bad-token');
      fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(400);
      expect(err.response.requireCaptcha).toBe(true);
      expect(err.response.reason).toBe('cloudflare_rejected');
    }
    expect(turnstile.verify).toHaveBeenCalledWith('bad-token', '1.2.3.4');
  });

  it('3 échecs + token valide + mauvais password → 401 Identifiants invalides', async () => {
    const { service, turnstile } = makeService({ ipFails: 3, captchaValid: true });
    await expect(service.signIn('T1', 'x@y.com', 'wrong', '1.2.3.4', 'ua', 'valid-token'))
      .rejects.toThrow('Identifiants invalides');
    expect(turnstile.verify).toHaveBeenCalled();
  });

  it('service non configuré (Vault absent) → fail-open, pas de CAPTCHA exigé', async () => {
    const { service, turnstile } = makeService({ ipFails: 10, captchaConfigured: false });
    // Sans captcha, l'auth continue normalement et échoue sur password
    await expect(service.signIn('T1', 'x@y.com', 'wrong', '1.2.3.4', 'ua'))
      .rejects.toThrow('Identifiants invalides');
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(turnstile.isConfigured).toHaveBeenCalled();
  });
});
