/**
 * AuthService.signIn — MFA branching unit test
 *
 * Quand user.mfaEnabled = true, signIn doit :
 *   - Ne PAS créer de Session
 *   - Créer un MfaChallenge (TTL 5 min, token 256 bits)
 *   - Retourner { kind: 'mfaChallenge', challengeToken, expiresAt }
 *
 * Quand user.mfaEnabled = false (flow standard) → { kind: 'session', ... }
 */
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../../../src/modules/auth/auth.service';

describe('AuthService.signIn — MFA wire', () => {
  let prismaMock: any;
  let identityMock: any;
  let service:    AuthService;

  const BASE_USER = {
    id: 'u1', tenantId: 't1', email: 'a@b.c', name: 'Alice',
    isActive: true, roleId: 'r1', userType: 'STAFF',
    preferences: {},
    role: { name: 'TENANT_ADMIN', permissions: [] },
  };

  beforeEach(() => {
    prismaMock = {
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create:     jest.fn().mockResolvedValue({}),
      },
      user: {
        update:     jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ preferences: {}, mfaEnabled: false }),
      },
      staff: { findFirst: jest.fn().mockResolvedValue(null) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ onboardingCompletedAt: null, businessActivity: null }) },
      platformSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
      account: { findFirst: jest.fn().mockResolvedValue({ forcePasswordChange: false }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      mfaChallenge: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create:     jest.fn().mockResolvedValue({}),
      },
    };

    identityMock = {
      findCredentialAccount: jest.fn(),
    };

    service = new AuthService(
      prismaMock,
      { listActiveKeys: jest.fn().mockResolvedValue([]) } as any,
      { verifyLoginCode: jest.fn() } as any,
      identityMock,
    );
  });

  it('mfaEnabled=true → retourne mfaChallenge et ne crée PAS de session', async () => {
    const hash = await bcrypt.hash('GoodPwd!', 10);
    identityMock.findCredentialAccount.mockResolvedValue({
      userId:   'u1',
      password: hash,
      user:     { ...BASE_USER, mfaEnabled: true },
    });

    const result = await service.signIn(
      't1', 'a@b.c', 'GoodPwd!', '10.0.0.1', 'jest-agent',
    );

    expect(result.kind).toBe('mfaChallenge');
    if (result.kind !== 'mfaChallenge') throw new Error('type narrowing');
    expect(typeof result.challengeToken).toBe('string');
    expect(result.challengeToken.length).toBeGreaterThan(32);
    expect(result.expiresAt).toBeInstanceOf(Date);

    // Aucune Session créée — la session sera créée après /mfa/verify
    expect(prismaMock.session.create).not.toHaveBeenCalled();
    // Un MfaChallenge a été créé
    expect(prismaMock.mfaChallenge.create).toHaveBeenCalled();
  });

  it('mfaEnabled=false → flow standard (session + tracking activité)', async () => {
    const hash = await bcrypt.hash('GoodPwd!', 10);
    identityMock.findCredentialAccount.mockResolvedValue({
      userId:   'u1',
      password: hash,
      user:     { ...BASE_USER, mfaEnabled: false },
    });

    const result = await service.signIn(
      't1', 'a@b.c', 'GoodPwd!', '10.0.0.1', 'jest-agent',
    );

    expect(result.kind).toBe('session');
    if (result.kind !== 'session') throw new Error('type narrowing');
    expect(prismaMock.session.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.mfaChallenge.create).not.toHaveBeenCalled();
    // Tracking lastLoginAt + loginCount++
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data:  expect.objectContaining({ loginCount: { increment: 1 } }),
    }));
  });
});
