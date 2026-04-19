/**
 * Security Test — Reset mot de passe cross-tenant plateforme
 *
 * Vérifie les invariants de sécurité du nouvel endpoint
 * `POST /platform/iam/users/:userId/reset-password` :
 *
 *   [S1] Self-reset interdit (acteur = cible → forgot-password à la place)
 *   [S2] Target introuvable → 404
 *   [S3] Mode 'set' sans newPassword → 400 (validation ctrl côté service)
 *   [S4] Mode 'link' génère un token sha256 hashé — JAMAIS le raw en DB
 *   [S5] Mode 'set' invalide TOUTES les sessions actives du target
 *   [S6] Mode 'set' force rotation au prochain login (forcePasswordChange=true)
 *   [S7] Audit log créé avec action 'auth.password_reset.platform.{set|link}'
 *
 * Le check de permission (control.platform.user.reset-password.global) est
 * appliqué en amont par PermissionGuard au niveau HTTP — il est couvert par
 * `authorization-escalation.spec.ts`. Ici on teste les invariants de la logique
 * métier elle-même.
 */
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PasswordResetService } from '../../src/modules/password-reset/password-reset.service';

describe('[Security] Platform cross-tenant password reset', () => {
  let prisma: any;
  let host:   any;
  let svc:    PasswordResetService;

  beforeEach(() => {
    prisma = {
      user:    { findUnique: jest.fn(), findFirst: jest.fn() },
      account: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    host = { buildTenantUrl: (s: string, p: string) => `https://${s}.test${p}` };
    svc = new PasswordResetService(prisma, {} as any, host);
  });

  // ── S1 ────────────────────────────────────────────────────────────────────
  it('S1 — refuse le self-reset (même id actor ↔ target)', async () => {
    await expect(svc.initiateByPlatformAdmin({
      actorId: 'sa1', targetUserId: 'sa1', mode: 'link', ipAddress: '10.0.0.1',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── S2 ────────────────────────────────────────────────────────────────────
  it('S2 — target introuvable → 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.initiateByPlatformAdmin({
      actorId: 'sa1', targetUserId: 'missing', mode: 'link', ipAddress: '10.0.0.1',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── S3 ────────────────────────────────────────────────────────────────────
  it('S3 — mode "set" sans newPassword → 400', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@x.y', isActive: true, tenant: { slug: 'tn' },
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@x.y', isActive: true, tenant: { slug: 'tn' },
    });
    prisma.account.findFirst.mockResolvedValue({ id: 'a1' });
    await expect(svc.initiateByPlatformAdmin({
      actorId: 'sa1', targetUserId: 'u1', mode: 'set', ipAddress: '10.0.0.1',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── S4 ────────────────────────────────────────────────────────────────────
  it('S4 — mode "link" : token raw ≠ token stocké (sha256 hash only)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@x.y', isActive: true, tenant: { slug: 'tn' },
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@x.y', isActive: true, tenant: { slug: 'tn' },
    });
    prisma.account.findFirst.mockResolvedValue({ id: 'a1' });

    const out = await svc.initiateByPlatformAdmin({
      actorId: 'sa1', targetUserId: 'u1', mode: 'link', ipAddress: '10.0.0.1',
    });

    const rawToken = out.rawToken!;
    const storedHash = prisma.account.update.mock.calls[0][0].data.passwordResetTokenHash;
    expect(storedHash).not.toEqual(rawToken);
    expect(storedHash).toEqual(createHash('sha256').update(rawToken).digest('hex'));
  });

  // ── S5 + S6 ───────────────────────────────────────────────────────────────
  it('S5+S6 — mode "set" : sessions purgées + forcePasswordChange=true', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@x.y', isActive: true, tenant: { slug: 'tn' },
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 't2', email: 'bob@x.y', isActive: true, tenant: { slug: 'tn' },
    });
    prisma.account.findFirst.mockResolvedValue({ id: 'a1' });

    await svc.initiateByPlatformAdmin({
      actorId: 'sa1', targetUserId: 'u1', mode: 'set',
      newPassword: 'TempXyz123!', ipAddress: '10.0.0.1',
    });

    const upd = prisma.account.update.mock.calls[0][0];
    expect(upd.data.forcePasswordChange).toBe(true);
    // Le password est bcrypt-hashé (jamais stocké en clair)
    expect(upd.data.password).not.toEqual('TempXyz123!');
    expect(await bcrypt.compare('TempXyz123!', upd.data.password)).toBe(true);
    // Toutes les sessions du target sont purgées
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  // ── S7 ────────────────────────────────────────────────────────────────────
  it('S7 — audit log avec action platform.{link|set} + crossTenant=true', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', tenantId: 'tcli', email: 'b@x.y', isActive: true, tenant: { slug: 'client' },
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', tenantId: 'tcli', email: 'b@x.y', isActive: true, tenant: { slug: 'client' },
    });
    prisma.account.findFirst.mockResolvedValue({ id: 'a1' });

    await svc.initiateByPlatformAdmin({
      actorId: 'sa1', targetUserId: 'u1', mode: 'link', ipAddress: '10.0.0.1',
    });

    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('auth.password_reset.platform.link');
    expect(audit.tenantId).toBe('tcli');       // écrit sur le tenant du target
    // Le writeAuditLog pose actorId en userId (l'actor est responsable),
    // la cible est portée par la clé `resource` (convention de l'audit).
    expect(audit.userId).toBe('sa1');
    expect(audit.resource).toBe('User:u1');
    expect(audit.newValue).toEqual(expect.objectContaining({ crossTenant: true }));
  });
});
