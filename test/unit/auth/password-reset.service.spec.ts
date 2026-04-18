import { PasswordResetService } from '../../../src/modules/password-reset/password-reset.service';
import { HostConfigService } from '../../../src/core/tenancy/host-config.service';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException,
} from '@nestjs/common';

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Tests unitaires PasswordResetService — token hashé sha-256, one-shot,
 * expiration, non-énumération en self-service, garde anti-self-reset admin,
 * mode 'set' force la rotation + purge sessions.
 *
 * MISE À JOUR Phase 1 multi-tenant :
 *   - Le service prend maintenant AuthIdentityService + HostConfigService
 *   - initiateBySelf requiert (tenantId, tenantSlug, email, ip)
 *   - L'URL de reset est scoped au sous-domaine du tenant
 *
 * Prisma, AuthIdentity et HostConfig entièrement mockés. Pas de DB, pas de Redis.
 */
describe('PasswordResetService', () => {
  let prismaMock:   any;
  let identityMock: any;
  let hostConfig:   HostConfigService;
  let service:      PasswordResetService;

  beforeEach(() => {
    process.env.PLATFORM_BASE_DOMAIN = 'translog.test';
    process.env.ADMIN_SUBDOMAIN      = 'admin';

    prismaMock = {
      account: {
        findUnique: jest.fn(),
        findFirst:  jest.fn(),
        update:     jest.fn().mockResolvedValue({}),
      },
      user: {
        findFirst: jest.fn(),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (ops: any[]) => Promise.all(ops)),
    };

    identityMock = {
      findCredentialAccount: jest.fn(),
    };

    hostConfig = new HostConfigService();
    service = new PasswordResetService(prismaMock, identityMock, hostConfig);
  });

  // ─── initiateBySelf ─────────────────────────────────────────────────────────

  describe('initiateBySelf()', () => {
    it('ne révèle jamais l\'inexistence du compte (no-op silencieux)', async () => {
      identityMock.findCredentialAccount.mockResolvedValueOnce(null);
      await expect(
        service.initiateBySelf('T1', 'tenanta', 'unknown@x.com', '1.2.3.4'),
      ).resolves.toBeUndefined();
      expect(prismaMock.account.update).not.toHaveBeenCalled();
    });

    it('ne génère pas de token si le user est inactive', async () => {
      identityMock.findCredentialAccount.mockResolvedValueOnce({
        id: 'a1', user: { id: 'u1', tenantId: 'T1', email: 'x@x.com', isActive: false },
      });
      await service.initiateBySelf('T1', 'tenanta', 'x@x.com', '1.2.3.4');
      expect(prismaMock.account.update).not.toHaveBeenCalled();
    });

    it('stocke le HASH sha-256 du token, jamais le clair', async () => {
      identityMock.findCredentialAccount.mockResolvedValueOnce({
        id: 'a1', user: { id: 'u1', tenantId: 'T1', email: 'x@x.com', isActive: true },
      });
      await service.initiateBySelf('T1', 'tenanta', 'x@x.com', '1.2.3.4');

      expect(prismaMock.account.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          passwordResetTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          passwordResetExpiresAt: expect.any(Date),
        }),
      }));
    });

    it('écrit un audit log self-service', async () => {
      identityMock.findCredentialAccount.mockResolvedValueOnce({
        id: 'a1', user: { id: 'u1', tenantId: 'T1', email: 'x@x.com', isActive: true },
      });
      await service.initiateBySelf('T1', 'tenanta', 'x@x.com', '1.2.3.4');
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'auth.password_reset.request.self',
          tenantId: 'T1',
        }),
      }));
    });

    it('appelle AuthIdentityService avec le tenantId correct', async () => {
      identityMock.findCredentialAccount.mockResolvedValueOnce(null);
      await service.initiateBySelf('T-ALPHA', 'alpha', 'x@x.com', '1.2.3.4');
      expect(identityMock.findCredentialAccount).toHaveBeenCalledWith('T-ALPHA', 'x@x.com');
    });
  });

  // ─── initiateByAdmin ───────────────────────────────────────────────────────

  describe('initiateByAdmin()', () => {
    it('refuse qu\'un admin se reset lui-même', async () => {
      await expect(service.initiateByAdmin({
        actorTenantId: 'T1', actorId: 'same', targetUserId: 'same',
        mode: 'link', ipAddress: '1.2.3.4',
      })).rejects.toThrow(ForbiddenException);
    });

    it('refuse un targetUser hors tenant', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.initiateByAdmin({
        actorTenantId: 'T1', actorId: 'A', targetUserId: 'U-other',
        mode: 'link', ipAddress: '1.2.3.4',
      })).rejects.toThrow(NotFoundException);
    });

    it('refuse si aucun Account credential', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce({
        id: 'U1', email: 'u@x.com', tenantId: 'T1', isActive: true,
        tenant: { slug: 'tenanta' },
      });
      prismaMock.account.findFirst.mockResolvedValueOnce(null);
      await expect(service.initiateByAdmin({
        actorTenantId: 'T1', actorId: 'A', targetUserId: 'U1',
        mode: 'link', ipAddress: '1.2.3.4',
      })).rejects.toThrow(BadRequestException);
    });

    it('mode "link" retourne une URL sur le sous-domaine du tenant', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce({
        id: 'U1', email: 'u@x.com', tenantId: 'T1', isActive: true,
        tenant: { slug: 'tenanta' },
      });
      prismaMock.account.findFirst.mockResolvedValueOnce({ id: 'a1' });

      const res = await service.initiateByAdmin({
        actorTenantId: 'T1', actorId: 'A', targetUserId: 'U1',
        mode: 'link', ipAddress: '1.2.3.4',
      });

      expect(res.mode).toBe('link');
      expect(res.email).toBe('u@x.com');
      // URL scopée au sous-domaine du tenant — sécurité : chaque lien tenant-unique
      expect(res.resetUrl).toMatch(/^https:\/\/tenanta\.translog\.test\/auth\/reset\?token=/);
      expect(res.expiresAt).toBeInstanceOf(Date);
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'auth.password_reset.admin.link', level: 'warn' }),
      }));
    });

    it('mode "set" sans newPassword → BadRequest', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce({
        id: 'U1', email: 'u@x.com', tenantId: 'T1', isActive: true,
        tenant: { slug: 'tenanta' },
      });
      prismaMock.account.findFirst.mockResolvedValueOnce({ id: 'a1' });
      await expect(service.initiateByAdmin({
        actorTenantId: 'T1', actorId: 'A', targetUserId: 'U1',
        mode: 'set', ipAddress: '1.2.3.4',
      })).rejects.toThrow(BadRequestException);
    });

    it('mode "set" applique hash + force rotation + purge sessions', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce({
        id: 'U1', email: 'u@x.com', tenantId: 'T1', isActive: true,
        tenant: { slug: 'tenanta' },
      });
      prismaMock.account.findFirst.mockResolvedValueOnce({ id: 'a1' });

      await service.initiateByAdmin({
        actorTenantId: 'T1', actorId: 'A', targetUserId: 'U1',
        mode: 'set', newPassword: 'NewP@ssw0rd!', ipAddress: '1.2.3.4',
      });

      expect(prismaMock.account.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          password: expect.stringMatching(/^\$2[aby]\$/),  // bcrypt hash
          forcePasswordChange: true,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        }),
      }));
      expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'U1', tenantId: 'T1' } });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'auth.password_reset.admin.set', level: 'warn' }),
      }));
    });
  });

  // ─── complete ──────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('refuse un token inconnu', async () => {
      prismaMock.account.findUnique.mockResolvedValueOnce(null);
      await expect(service.complete('badtok', 'NewP@ssw0rd!', '1.2.3.4'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('refuse un token expiré', async () => {
      prismaMock.account.findUnique.mockResolvedValueOnce({
        id: 'a1',
        passwordResetExpiresAt: new Date(Date.now() - 1_000),
        user: { id: 'U1', tenantId: 'T1', email: 'x@x.com', isActive: true },
      });
      await expect(service.complete('tok', 'NewP@ssw0rd!', '1.2.3.4'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('refuse un user désactivé', async () => {
      prismaMock.account.findUnique.mockResolvedValueOnce({
        id: 'a1',
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
        user: { id: 'U1', tenantId: 'T1', email: 'x@x.com', isActive: false },
      });
      await expect(service.complete('tok', 'NewP@ssw0rd!', '1.2.3.4'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('applique hash + purge token + purge sessions en transaction', async () => {
      const tokenRaw  = 'abcdef123456';
      const tokenHash = hash(tokenRaw);

      prismaMock.account.findUnique.mockResolvedValueOnce({
        id: 'a1',
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
        user: { id: 'U1', tenantId: 'T1', email: 'x@x.com', isActive: true },
      });

      // Spy sur les opérations retournées à $transaction (elles sont composées en array)
      const accountUpdateRet = { __op: 'account.update' };
      const sessionDelRet    = { __op: 'session.deleteMany' };
      prismaMock.account.update.mockReturnValueOnce(accountUpdateRet);
      prismaMock.session.deleteMany.mockReturnValueOnce(sessionDelRet);

      await service.complete(tokenRaw, 'NewP@ssw0rd!', '1.2.3.4');

      expect(prismaMock.account.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { passwordResetTokenHash: tokenHash },
      }));
      expect(prismaMock.$transaction).toHaveBeenCalledWith([accountUpdateRet, sessionDelRet]);
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'auth.password_reset.complete' }),
      }));
    });

    it('vérifie que le mot de passe est bien hashé bcrypt (round ≥ 10)', async () => {
      prismaMock.account.findUnique.mockResolvedValueOnce({
        id: 'a1',
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
        user: { id: 'U1', tenantId: 'T1', email: 'x@x.com', isActive: true },
      });

      let capturedData: any = null;
      prismaMock.account.update.mockImplementationOnce((arg: any) => {
        capturedData = arg.data;
        return {};
      });

      await service.complete('tok', 'MySecurePwd123', '1.2.3.4');

      expect(capturedData.password).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(await bcrypt.compare('MySecurePwd123', capturedData.password)).toBe(true);
    });
  });

  // ─── initiateByAdminBatch ─────────────────────────────────────────────────

  describe('initiateByAdminBatch()', () => {
    it('retourne un résultat par user avec ok/reason', async () => {
      // 1er user OK
      prismaMock.user.findFirst.mockResolvedValueOnce({
        id: 'U1', email: 'a@x.com', tenantId: 'T1', isActive: true,
        tenant: { slug: 'tenanta' },
      });
      prismaMock.account.findFirst.mockResolvedValueOnce({ id: 'a1' });
      // 2e user introuvable
      prismaMock.user.findFirst.mockResolvedValueOnce(null);

      const res = await service.initiateByAdminBatch({
        actorTenantId: 'T1', actorId: 'A',
        targetUserIds: ['U1', 'U-missing'],
        ipAddress: '1.2.3.4',
      });

      expect(res.results).toHaveLength(2);
      expect(res.results[0]).toMatchObject({ userId: 'U1', ok: true, email: 'a@x.com' });
      expect(res.results[1]).toMatchObject({ userId: 'U-missing', ok: false });
      expect(res.results[1].reason).toBeDefined();
    });
  });
});
