/**
 * PasswordResetService.initiateByPlatformAdmin — cross-tenant unit test
 *
 * - actorId === targetUserId → 403 (utilise forgot-password pour soi-même)
 * - target introuvable → 404
 * - mode 'set' sans newPassword → 400
 * - mode 'set' OK → forcePasswordChange=true, sessions purgées
 * - mode 'link' OK → token sha256 stocké, URL générée vers sous-domaine target
 *
 * Permet de réinitialiser le mdp d'un user de n'importe quel tenant (pas de
 * contrainte actorTenantId === target.tenantId, contrairement à initiateByAdmin).
 */
import * as bcrypt from 'bcryptjs';
import {
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PasswordResetService } from '../../../src/modules/password-reset/password-reset.service';

describe('PasswordResetService.initiateByPlatformAdmin', () => {
  let prismaMock:   any;
  let hostConfig:   any;
  let service:      PasswordResetService;

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        findFirst:  jest.fn(),
      },
      account: {
        findFirst: jest.fn(),
        update:    jest.fn().mockResolvedValue({}),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    hostConfig = {
      buildTenantUrl: jest.fn((slug: string, path: string) =>
        `https://${slug}.translog.test${path}`),
    };

    service = new PasswordResetService(prismaMock, { } as any, hostConfig);
  });

  it('refuse le reset de son propre compte (403)', async () => {
    await expect(
      service.initiateByPlatformAdmin({
        actorId: 'u1', targetUserId: 'u1', mode: 'link', ipAddress: '10.0.0.1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throw NotFound si target user inexistant', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      service.initiateByPlatformAdmin({
        actorId: 'sa1', targetUserId: 'missing', mode: 'link', ipAddress: '10.0.0.1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mode "set" sans newPassword → 400', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 't1', email: 'a@b.c', isActive: true,
      tenant: { slug: 'acme' },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 't1', email: 'a@b.c', isActive: true,
      tenant: { slug: 'acme' },
    });
    prismaMock.account.findFirst.mockResolvedValue({ id: 'a1' });

    await expect(
      service.initiateByPlatformAdmin({
        actorId: 'sa1', targetUserId: 'u1', mode: 'set', ipAddress: '10.0.0.1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mode "set" cross-tenant : hash + forcePasswordChange=true + sessions purgées + audit "platform.set"', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@client.io', isActive: true,
      tenant: { slug: 'client' },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@client.io', isActive: true,
      tenant: { slug: 'client' },
    });
    prismaMock.account.findFirst.mockResolvedValue({ id: 'a1' });

    const out = await service.initiateByPlatformAdmin({
      actorId:      'sa1',
      targetUserId: 'u1',
      mode:         'set',
      newPassword:  'TempPwd987!',
      ipAddress:    '10.0.0.1',
    });

    expect(out).toEqual({ email: 'bob@client.io', mode: 'set' });
    const accountUpdate = prismaMock.account.update.mock.calls[0][0];
    expect(accountUpdate.data.forcePasswordChange).toBe(true);
    expect(accountUpdate.data.passwordResetTokenHash).toBeNull();
    expect(await bcrypt.compare('TempPwd987!', accountUpdate.data.password)).toBe(true);

    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action:   'auth.password_reset.platform.set',
        level:    'warn',
        tenantId: 't2',
      }),
    }));
  });

  it('mode "link" cross-tenant : stocke tokenHash, renvoie URL sous-domaine target', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@client.io', isActive: true,
      tenant: { slug: 'client' },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@client.io', isActive: true,
      tenant: { slug: 'client' },
    });
    prismaMock.account.findFirst.mockResolvedValue({ id: 'a1' });

    const out = await service.initiateByPlatformAdmin({
      actorId:      'sa1',
      targetUserId: 'u1',
      mode:         'link',
      ipAddress:    '10.0.0.1',
    });

    expect(out.mode).toBe('link');
    expect(out.rawToken).toBeDefined();
    expect(out.rawToken!.length).toBeGreaterThan(32);
    expect(out.resetUrl).toContain('https://client.translog.test/auth/reset?token=');
    // Le tokenHash stocké est sha256(rawToken) — donc ≠ rawToken
    const accountUpdate = prismaMock.account.update.mock.calls[0][0];
    expect(accountUpdate.data.passwordResetTokenHash).toBeDefined();
    expect(accountUpdate.data.passwordResetTokenHash).not.toEqual(out.rawToken);

    // Audit cross-tenant
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action:   'auth.password_reset.platform.link',
        tenantId: 't2',
      }),
    }));
  });
});
