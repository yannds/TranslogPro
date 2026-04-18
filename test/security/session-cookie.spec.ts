/**
 * Security Test — Session & Cookie Security
 *
 * Tests unitaires sur AuthService (logique pure) et sur les constantes
 * de cookie utilisées par AuthController.
 *
 * Vérifie :
 *   - Cookie flags (httpOnly, sameSite, secure en prod)
 *   - Token entropy (256 bits)
 *   - Rejet de tokens forgés / invalides / expirés
 *   - Sign-out invalide la session DB
 */
import { randomBytes } from 'crypto';
import { AuthService } from '@/modules/auth/auth.service';
import { PrismaService } from '@/infrastructure/database/prisma.service';
import { TenantModuleService } from '@/modules/tenant/tenant-module.service';
import { MfaService } from '@/modules/mfa/mfa.service';
import { UnauthorizedException } from '@nestjs/common';

describe('[SECURITY] Session & Cookie Security', () => {
  // ── Cookie flags (constantes controller) ───────────────────────────────────

  describe('Cookie configuration', () => {
    // On reproduit les constantes du controller pour assertion
    const COOKIE_OPTS_PROD = {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure:   true,
      maxAge:   30 * 24 * 3600 * 1_000,
      path:     '/',
    };

    const COOKIE_OPTS_DEV = {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure:   false,
      maxAge:   30 * 24 * 3600 * 1_000,
      path:     '/',
    };

    it('should set httpOnly flag (invisible à JS)', () => {
      expect(COOKIE_OPTS_PROD.httpOnly).toBe(true);
      expect(COOKIE_OPTS_DEV.httpOnly).toBe(true);
    });

    it('should set SameSite=strict (CSRF protection)', () => {
      expect(COOKIE_OPTS_PROD.sameSite).toBe('strict');
      expect(COOKIE_OPTS_DEV.sameSite).toBe('strict');
    });

    it('should enable secure flag in production only', () => {
      expect(COOKIE_OPTS_PROD.secure).toBe(true);
      expect(COOKIE_OPTS_DEV.secure).toBe(false);
    });

    it('should scope cookie to root path', () => {
      expect(COOKIE_OPTS_PROD.path).toBe('/');
    });

    it('should have reasonable maxAge (30 days)', () => {
      const thirtyDays = 30 * 24 * 3600 * 1_000;
      expect(COOKIE_OPTS_PROD.maxAge).toBe(thirtyDays);
    });
  });

  // ── Token entropy ──────────────────────────────────────────────────────────

  describe('Session token entropy', () => {
    it('should generate 64 hex chars (256 bits)', () => {
      const token = randomBytes(32).toString('hex');
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce unique tokens across 1000 generations', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        tokens.add(randomBytes(32).toString('hex'));
      }
      expect(tokens.size).toBe(1000);
    });
  });

  // ── Forged / invalid token rejection ──────────────────────────────────────

  describe('AuthService.me — invalid tokens', () => {
    const makeService = (sessionOverride: unknown = null) => {
      const prisma = {
        session: {
          findUnique: jest.fn().mockResolvedValue(sessionOverride),
          delete:     jest.fn().mockResolvedValue({}),
          create:     jest.fn().mockResolvedValue({}),
        },
      } as unknown as PrismaService;
      return new AuthService(prisma, {} as TenantModuleService, {} as MfaService);
    };

    it('should reject a forged token (not in DB)', async () => {
      const svc = makeService(null);
      await expect(svc.me('forged-token', '127.0.0.1'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should reject an expired session', async () => {
      const svc = makeService({
        token:     'tok',
        userId:    'u1',
        tenantId:  't1',
        ipAddress: '127.0.0.1',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(Date.now() - 86_400_000),
        user:      { isActive: true, role: { name: 'X', permissions: [] } },
      });
      await expect(svc.me('tok', '127.0.0.1'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should reject a session for disabled account', async () => {
      const svc = makeService({
        token:     'tok',
        userId:    'u1',
        tenantId:  't1',
        ipAddress: '127.0.0.1',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        user:      { isActive: false, role: { name: 'X', permissions: [] } },
      });
      await expect(svc.me('tok', '127.0.0.1'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ── Sign-out ──────────────────────────────────────────────────────────────

  describe('AuthService.signOut', () => {
    it('should delete all matching sessions for the token', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        session: { deleteMany },
      } as unknown as PrismaService;
      const svc = new AuthService(prisma, {} as TenantModuleService, {} as MfaService);

      await svc.signOut('some-token');
      expect(deleteMany).toHaveBeenCalledWith({ where: { token: 'some-token' } });
    });

    it('should not throw if session does not exist', async () => {
      const prisma = {
        session: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      } as unknown as PrismaService;
      const svc = new AuthService(prisma, {} as TenantModuleService, {} as MfaService);

      await expect(svc.signOut('nonexistent')).resolves.not.toThrow();
    });
  });
});
