/**
 * Phase 2 — Impersonation cross-subdomain exchange.
 *
 * Test unitaire de ImpersonationService.exchangeTokenForSession avec :
 *   - Token valide → crée une Session DB + retourne sessionToken
 *   - Token déjà échangé → UnauthorizedException (one-shot)
 *   - Token signature invalide → UnauthorizedException (via verifyToken)
 *   - Token expiré → UnauthorizedException
 *   - Status ≠ ACTIVE → UnauthorizedException
 */

import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ImpersonationService } from '../../../src/core/iam/services/impersonation.service';
import { HostConfigService } from '../../../src/core/tenancy/host-config.service';

describe('ImpersonationService.exchangeTokenForSession — Phase 2 cross-subdomain', () => {
  let service:    ImpersonationService;
  let hostConfig: HostConfigService;
  let prismaMock: any;
  let secretMock: any;

  const FAKE_KEY = 'a'.repeat(64);   // >= 32 chars (validation service)

  // Fabrique un token signé de test (duplique la logique signPayload)
  function buildToken(payload: any): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig  = createHmac('sha256', FAKE_KEY).update(data).digest('hex');
    return `${data}.${sig}`;
  }

  beforeEach(() => {
    process.env.PLATFORM_BASE_DOMAIN = 'translog.test';

    prismaMock = {
      impersonationSession: {
        findUnique: jest.fn(),
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create:     jest.fn().mockResolvedValue({}),
      },
      session:  { create: jest.fn().mockResolvedValue({}) },
      tenant:   { findFirst: jest.fn() },
      auditLog: { create:    jest.fn().mockResolvedValue({}) },
    };

    secretMock = {
      getSecretObject: jest.fn().mockResolvedValue({ KEY: FAKE_KEY }),
    };

    hostConfig = new HostConfigService();
    service = new ImpersonationService(prismaMock, secretMock, hostConfig);
  });

  const makeValidSession = (overrides: any = {}) => ({
    id:             'session-1',
    status:         'ACTIVE',
    expiresAt:      new Date(Date.now() + 10 * 60_000),
    targetTenantId: 'tenant-a-id',
    actorId:        'actor-admin',
    actorTenantId:  '00000000-0000-0000-0000-000000000000',
    exchangedAt:    null,
    ...overrides,
  });

  it('échange un token valide → crée Session DB + retourne sessionToken', async () => {
    const payload = {
      sessionId: 'session-1', actorId: 'actor-admin',
      actorTenantId: '00000000-0000-0000-0000-000000000000',
      targetTenantId: 'tenant-a-id',
      iat: Date.now(), exp: Date.now() + 600_000,
    };
    const token = buildToken(payload);

    prismaMock.impersonationSession.findUnique.mockResolvedValue(makeValidSession());

    const res = await service.exchangeTokenForSession(token, '1.2.3.4', 'UA');

    expect(res.sessionToken).toMatch(/^[a-f0-9]{64}$/);   // 256 bits hex
    expect(res.targetTenantId).toBe('tenant-a-id');
    expect(res.actorId).toBe('actor-admin');

    // Session DB créée avec les bons tenant/user
    expect(prismaMock.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId:   'actor-admin',
        tenantId: 'tenant-a-id',
        token:    res.sessionToken,
      }),
    }));

    // Marqué comme EXCHANGED atomiquement
    expect(prismaMock.impersonationSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status:      'ACTIVE',
          exchangedAt: null,
          expiresAt:   { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          exchangedAt: expect.any(Date),
          status:      'EXCHANGED',
        }),
      }),
    );

    // Audit critique écrit
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'control.impersonation.exchange.global',
        level:  'critical',
      }),
    }));
  });

  it('rejette un token déjà échangé (one-shot / anti-replay)', async () => {
    const payload = {
      sessionId: 'session-1', actorId: 'actor-admin',
      actorTenantId: '00000000-0000-0000-0000-000000000000',
      targetTenantId: 'tenant-a-id',
      iat: Date.now(), exp: Date.now() + 600_000,
    };
    const token = buildToken(payload);

    // Premier lookup dans verifyToken retourne la session ACTIVE — OK
    prismaMock.impersonationSession.findUnique.mockResolvedValue(makeValidSession());
    // Mais updateMany retourne count=0 car exchangedAt != null entre-temps
    // (ou status != ACTIVE)
    prismaMock.impersonationSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.exchangeTokenForSession(token, '1.2.3.4', 'UA'),
    ).rejects.toThrow(UnauthorizedException);
    // Pas de Session créée
    expect(prismaMock.session.create).not.toHaveBeenCalled();
  });

  it('rejette un token à signature invalide', async () => {
    const payload = { sessionId: 's', actorId: 'a', actorTenantId: 'p',
                      targetTenantId: 't', iat: Date.now(), exp: Date.now() + 600_000 };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const badToken = `${data}.deadbeefdeadbeef`;   // signature bidon

    await expect(
      service.exchangeTokenForSession(badToken, '1.2.3.4', 'UA'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un token expiré (payload.exp dans le passé)', async () => {
    const payload = {
      sessionId: 'session-1', actorId: 'actor-admin',
      actorTenantId: '00000000-0000-0000-0000-000000000000',
      targetTenantId: 'tenant-a-id',
      iat: Date.now() - 1_000_000,
      exp: Date.now() - 1_000,    // expired
    };
    const token = buildToken(payload);

    await expect(
      service.exchangeTokenForSession(token, '1.2.3.4', 'UA'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un token d\'une session révoquée', async () => {
    const payload = {
      sessionId: 'session-1', actorId: 'actor-admin',
      actorTenantId: '00000000-0000-0000-0000-000000000000',
      targetTenantId: 'tenant-a-id',
      iat: Date.now(), exp: Date.now() + 600_000,
    };
    const token = buildToken(payload);

    prismaMock.impersonationSession.findUnique.mockResolvedValue(
      makeValidSession({ status: 'REVOKED' }),
    );

    await expect(
      service.exchangeTokenForSession(token, '1.2.3.4', 'UA'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
