/**
 * Security Test — Session Token Rotation (P3)
 *
 * Vérifie le mécanisme de rotation des tokens de session à mi-TTL.
 *
 * Invariants :
 *   - Une session < 15 jours NE déclenche PAS de rotation (rotatedToken undefined)
 *   - Une session ≥ 15 jours DÉCLENCHE une rotation
 *   - Le nouveau token est différent de l'ancien (256 bits d'entropie)
 *   - L'ancienne session est supprimée après création de la nouvelle
 *   - La nouvelle session reprend ipAddress et tenantId/userId
 *   - Une session expirée rejette sans rotation (UnauthorizedException)
 */

import { AuthService } from '@/modules/auth/auth.service';
import { PrismaService } from '@/infrastructure/database/prisma.service';
import { TenantModuleService } from '@/modules/tenant/tenant-module.service';
import { MfaService } from '@/modules/mfa/mfa.service';
import { AuthIdentityService } from '@/core/identity/auth-identity.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

const FIFTEEN_DAYS_MS = 15 * 24 * 3600 * 1_000;
const SIXTEEN_DAYS_MS = 16 * 24 * 3600 * 1_000;
const FIVE_DAYS_MS    =  5 * 24 * 3600 * 1_000;

describe('[SECURITY] Session Token Rotation (P3)', () => {
  const USER_ID    = 'u1b2c3d4-0000-0000-0000-000000000001';
  const TENANT_ID  = 'a1b2c3d4-0000-0000-0000-000000000001';
  const ROLE_ID    = 'r1b2c3d4-0000-0000-0000-000000000001';
  const OLD_TOKEN  = 'old-token-' + 'a'.repeat(54);

  const makeMocks = (sessionCreatedAt: Date, extra: Record<string, unknown> = {}) => {
    const session = {
      id:        'sess-01',
      token:     OLD_TOKEN,
      userId:    USER_ID,
      tenantId:  TENANT_ID,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      createdAt: sessionCreatedAt,
      expiresAt: new Date(Date.now() + 10 * 86_400_000), // 10 jours restants
      user: {
        id:       USER_ID,
        email:    'test@example.com',
        name:     'Test User',
        tenantId: TENANT_ID,
        roleId:   ROLE_ID,
        userType: 'STAFF',
        isActive: true,
        role:     { name: 'ADMIN', permissions: [] },
      },
      ...extra,
    };

    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue(session),
        create:     jest.fn().mockResolvedValue({}),
        delete:     jest.fn().mockResolvedValue(session),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      staff: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // Tenant lookup utilisé par toDto() pour exposer businessActivity + onboardingCompletedAt.
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tenant-x', slug: 'tenant-x', name: 'Tenant X',
          onboardingCompletedAt: new Date(), businessActivity: 'TICKETING',
        }),
      },
      // Subscription lookup utilisé par toDto() pour le gate SUSPENDED.
      platformSubscription: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      // Account lookup — forcePasswordChange flag côté toDto().
      account: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // User lookup — préférences locale/timezone côté toDto().
      user: {
        findUnique: jest.fn().mockResolvedValue({
          locale:   null,
          timezone: null,
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;

    const modules = {
      listActiveKeys: jest.fn().mockResolvedValue([]),
    } as unknown as TenantModuleService;

    const mfa = {} as MfaService;

    // Phase 1 multi-tenant : AuthService dépend maintenant de AuthIdentityService
    // pour toute recherche tenant-scoped. Non utilisé par `me()` (seul le
    // session.findUnique suffit), donc un mock vide convient.
    const identity = {} as AuthIdentityService;

    return { prisma, modules, mfa, identity, session };
  };

  // ── No rotation below threshold ────────────────────────────────────────────

  it('should NOT rotate a fresh session (< 15 days)', async () => {
    const fiveDaysAgo = new Date(Date.now() - FIVE_DAYS_MS);
    const { prisma, modules, mfa, identity } = makeMocks(fiveDaysAgo);

    const svc = new AuthService(prisma, modules, mfa, identity);
    const result = await svc.me(OLD_TOKEN, '127.0.0.1', 'test-agent');

    expect(result.user).toBeDefined();
    expect(result.rotatedToken).toBeUndefined();
    expect(result.rotatedExpiresAt).toBeUndefined();
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(prisma.session.delete).not.toHaveBeenCalled();
  });

  // ── Rotation at threshold ──────────────────────────────────────────────────

  it('should rotate a session aged exactly 15 days', async () => {
    const fifteenDaysAgo = new Date(Date.now() - FIFTEEN_DAYS_MS);
    const { prisma, modules, mfa, identity } = makeMocks(fifteenDaysAgo);

    const svc = new AuthService(prisma, modules, mfa, identity);
    const result = await svc.me(OLD_TOKEN, '127.0.0.1', 'test-agent');

    expect(result.rotatedToken).toBeDefined();
    expect(result.rotatedToken).toHaveLength(64); // 256 bits hex
    expect(result.rotatedToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rotatedToken).not.toBe(OLD_TOKEN);
    expect(result.rotatedExpiresAt).toBeInstanceOf(Date);

    // Nouvelle session créée AVANT suppression de l'ancienne
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(prisma.session.delete).toHaveBeenCalledWith({ where: { token: OLD_TOKEN } });

    // Ordre d'appel : create avant delete
    const createOrder = (prisma.session.create as jest.Mock).mock.invocationCallOrder[0];
    const deleteOrder = (prisma.session.delete as jest.Mock).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(deleteOrder);
  });

  it('should rotate a session older than 15 days', async () => {
    const sixteenDaysAgo = new Date(Date.now() - SIXTEEN_DAYS_MS);
    const { prisma, modules, mfa, identity } = makeMocks(sixteenDaysAgo);

    const svc = new AuthService(prisma, modules, mfa, identity);
    const result = await svc.me(OLD_TOKEN, '127.0.0.1', 'test-agent');

    expect(result.rotatedToken).toBeDefined();

    // Vérifier les champs de la nouvelle session
    const createCall = (prisma.session.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.userId).toBe(USER_ID);
    expect(createCall.data.tenantId).toBe(TENANT_ID);
    expect(createCall.data.token).toBe(result.rotatedToken);
    expect(createCall.data.ipAddress).toBe('127.0.0.1');
  });

  // ── Token entropy — each rotation produces a unique token ──────────────────

  it('should produce different tokens on repeated rotations', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { prisma, modules, mfa, identity } = makeMocks(new Date(Date.now() - SIXTEEN_DAYS_MS));
      const svc = new AuthService(prisma, modules, mfa, identity);
      const result = await svc.me(OLD_TOKEN, '127.0.0.1', 'test-agent');
      tokens.add(result.rotatedToken!);
    }
    // Probabilité de collision sur 256 bits sur 10 tirages ≈ 0
    expect(tokens.size).toBe(10);
  });

  // ── Expired session — no rotation, throw ───────────────────────────────────

  it('should throw UnauthorizedException on expired session (no rotation)', async () => {
    const sixteenDaysAgo = new Date(Date.now() - SIXTEEN_DAYS_MS);
    const { prisma, modules, mfa, identity } = makeMocks(sixteenDaysAgo, {
      expiresAt: new Date(Date.now() - 1000), // expirée il y a 1s
    });

    const svc = new AuthService(prisma, modules, mfa, identity);
    await expect(svc.me(OLD_TOKEN, '127.0.0.1', 'test-agent'))
      .rejects.toThrow(UnauthorizedException);

    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  // ── IP mismatch — no rotation, session invalidated ─────────────────────────

  it('should reject rotation if IP changed (session hijacking protection)', async () => {
    const sixteenDaysAgo = new Date(Date.now() - SIXTEEN_DAYS_MS);
    const { prisma, modules, mfa, identity } = makeMocks(sixteenDaysAgo, {
      ipAddress: '203.0.113.42', // IP publique d'origine
    });

    const svc = new AuthService(prisma, modules, mfa, identity);
    await expect(svc.me(OLD_TOKEN, '198.51.100.7', 'test-agent'))
      .rejects.toThrow(ForbiddenException);

    // Ancienne session supprimée, pas de nouvelle session créée
    expect(prisma.session.delete).toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  // ── Disabled account — no rotation ─────────────────────────────────────────

  it('should reject rotation if user account is disabled', async () => {
    const sixteenDaysAgo = new Date(Date.now() - SIXTEEN_DAYS_MS);
    const { prisma, modules, mfa, identity, session } = makeMocks(sixteenDaysAgo);
    session.user.isActive = false;

    const svc = new AuthService(prisma, modules, mfa, identity);
    await expect(svc.me(OLD_TOKEN, '127.0.0.1', 'test-agent'))
      .rejects.toThrow(UnauthorizedException);

    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
