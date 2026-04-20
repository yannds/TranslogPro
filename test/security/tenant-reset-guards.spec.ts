/**
 * Security tests — TenantResetService (opération destructive TENANT_ADMIN only).
 *
 * Vérifie les 3 garde-fous empilés :
 *   1. Confirmation slug obligatoire (anti-fat-finger)
 *   2. Re-auth password (bcrypt compare — la session active ne suffit PAS)
 *   3. Pas de fuite cross-tenant (actor doit appartenir au tenant cible)
 *
 * Prisma mocké. Les tests couvrent les échecs attendus + le succès happy path.
 * Le décorateur @RequirePermission(TENANT_RESET_TENANT) est testé au niveau
 * IAM (seed + permission guard) — ici on teste la logique métier du service.
 */

jest.mock('@pdfme/generator', () => ({ generate: jest.fn() }), { virtual: true });
jest.mock('@pdfme/common',    () => ({}),                      { virtual: true });
jest.mock('@pdfme/schemas',   () => ({}),                      { virtual: true });

import * as bcrypt from 'bcryptjs';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TenantResetService } from '../../src/modules/tenant-settings/tenant-reset.service';

describe('[SECURITY] TenantResetService — garde-fous destructifs', () => {
  let prismaMock: any;
  let service:    TenantResetService;

  const validPasswordHash = bcrypt.hashSync('CorrectPassword!', 10);

  const buildMocks = (overrides: Partial<any> = {}) => ({
    tenant: {
      findUnique: jest.fn().mockResolvedValue('tenant' in overrides ? overrides.tenant : {
        id: 'tenant-a', slug: 'my-tenant-slug', name: 'My Tenant',
      }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue('user' in overrides ? overrides.user : {
        id: 'user-admin', email: 'admin@t.test',
      }),
    },
    account: {
      findFirst: jest.fn().mockResolvedValue('account' in overrides ? overrides.account : {
        password: validPasswordHash,
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn({
      $executeRawUnsafe: jest.fn().mockResolvedValue(3),
    })),
  });

  beforeEach(() => {
    prismaMock = buildMocks();
    service = new TenantResetService(prismaMock);
  });

  // ─── [SEC-RESET-1] Confirmation slug ──────────────────────────────────
  it('[SEC-RESET-1] rejette si confirmSlug ne matche pas tenant.slug', async () => {
    await expect(service.reset('tenant-a', 'user-admin', {
      password: 'CorrectPassword!',
      confirmSlug: 'wrong-slug',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('[SEC-RESET-1] rejette si confirmSlug vide', async () => {
    await expect(service.reset('tenant-a', 'user-admin', {
      password: 'CorrectPassword!',
      confirmSlug: '',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── [SEC-RESET-2] Tenant inexistant ──────────────────────────────────
  it('[SEC-RESET-2] rejette si tenant introuvable (NotFoundException)', async () => {
    prismaMock = buildMocks({ tenant: null });
    service = new TenantResetService(prismaMock);

    await expect(service.reset('tenant-x', 'user-admin', {
      password: 'any', confirmSlug: 'any',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  // ─── [SEC-RESET-3] Actor non sur ce tenant (cross-tenant) ─────────────
  it('[SEC-RESET-3] rejette si actor n\'appartient PAS au tenant cible', async () => {
    prismaMock = buildMocks({ user: null }); // findFirst retourne null
    service = new TenantResetService(prismaMock);

    await expect(service.reset('tenant-a', 'user-foreign', {
      password: 'CorrectPassword!',
      confirmSlug: 'my-tenant-slug',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ─── [SEC-RESET-4] Re-auth password ────────────────────────────────────
  it('[SEC-RESET-4] rejette si password faux (bcrypt compare échoue)', async () => {
    await expect(service.reset('tenant-a', 'user-admin', {
      password: 'WrongPassword!',
      confirmSlug: 'my-tenant-slug',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[SEC-RESET-4] rejette si compte sans password (OAuth-only)', async () => {
    prismaMock = buildMocks({ account: { password: null } });
    service = new TenantResetService(prismaMock);

    await expect(service.reset('tenant-a', 'user-admin', {
      password: 'anything',
      confirmSlug: 'my-tenant-slug',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ─── [SEC-RESET-5] Happy path (tous les garde-fous validés) ───────────
  it('[SEC-RESET-5] succès : purge toutes les tables métier en transaction', async () => {
    const res = await service.reset('tenant-a', 'user-admin', {
      password: 'CorrectPassword!',
      confirmSlug: 'my-tenant-slug',
    });

    expect(res.ok).toBe(true);
    expect(res.tenantSlug).toBe('my-tenant-slug');
    expect(res.purged).toBeDefined();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  // ─── [SEC-RESET-6] Isolation tenantId dans toutes les requêtes ────────
  it('[SEC-RESET-6] tous les lookups Prisma filtrent par tenantId', async () => {
    await service.reset('tenant-a', 'user-admin', {
      password: 'CorrectPassword!',
      confirmSlug: 'my-tenant-slug',
    });

    // user.findFirst filtre par tenantId strict
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
    // tenant.findUnique scope par id (équivalent)
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-a' },
      }),
    );
  });

  // ─── [SEC-RESET-7] Utilisateur désactivé ──────────────────────────────
  it('[SEC-RESET-7] rejette si utilisateur inactif', async () => {
    prismaMock = buildMocks({ user: null }); // user.findFirst filtre isActive=true
    service = new TenantResetService(prismaMock);

    await expect(service.reset('tenant-a', 'user-admin', {
      password: 'CorrectPassword!',
      confirmSlug: 'my-tenant-slug',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
