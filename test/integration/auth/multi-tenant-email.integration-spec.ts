/**
 * Integration test — Phase 1 multi-tenant isolation DB-level.
 *
 * VÉRIFIE (directement contre PostgreSQL, schéma Prisma à jour) :
 *
 *   [DB-1] Deux User peuvent coexister avec MÊME email dans 2 tenants
 *   [DB-2] Deux Account credential peuvent coexister (tenant-scoped)
 *   [DB-3] Deux User NE peuvent PAS coexister même email dans le MÊME tenant
 *   [DB-4] AuthIdentityService retourne le bon Account selon le tenant
 *   [DB-5] Password reset tokens restent indépendants par tenant
 *   [DB-6] TenantDomain lookup retourne le tenant via hostname
 *
 * Ces invariants sont la FONDATION du scénario "2 onglets, 2 tenants, même
 * humain avec les mêmes credentials" — ils doivent être vrais au niveau DB
 * pour que les couches backend/frontend puissent s'y reposer.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthIdentityService } from '../../../src/core/identity/auth-identity.service';

describe('[INTEGRATION] Multi-tenant isolation — DB level (Phase 1)', () => {
  let prisma: PrismaClient;
  let identity: AuthIdentityService;

  const SLUG_A = `itenant-a-${Date.now()}`;
  const SLUG_B = `itenant-b-${Date.now()}`;
  const SHARED_EMAIL = `yann.dual+${Date.now()}@gmail.com`;
  const SHARED_PASSWORD = 'SamePasswordAcross';

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    identity = new AuthIdentityService(prisma as any);

    // Créer 2 tenants de test isolés (cleanup en afterAll)
    const t1 = await prisma.tenant.create({
      data: { name: 'Integ Tenant A', slug: SLUG_A, country: 'CG', language: 'fr' },
    });
    const t2 = await prisma.tenant.create({
      data: { name: 'Integ Tenant B', slug: SLUG_B, country: 'CG', language: 'fr' },
    });
    tenantAId = t1.id;
    tenantBId = t2.id;
  });

  afterAll(async () => {
    // Cleanup : casser les FKs avant de drop les tenants
    await prisma.account.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.tenantDomain.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DB-1 : 2 User, même email, 2 tenants → OK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('[DB-1] User.email unique par (tenantId, email)', () => {
    it('crée 2 User avec le même email dans 2 tenants différents', async () => {
      const userA = await prisma.user.create({
        data: { tenantId: tenantAId, email: SHARED_EMAIL, name: 'Yann A', userType: 'CUSTOMER' },
      });
      const userB = await prisma.user.create({
        data: { tenantId: tenantBId, email: SHARED_EMAIL, name: 'Yann B', userType: 'CUSTOMER' },
      });

      expect(userA.id).not.toBe(userB.id);
      expect(userA.email).toBe(SHARED_EMAIL);
      expect(userB.email).toBe(SHARED_EMAIL);
      expect(userA.tenantId).toBe(tenantAId);
      expect(userB.tenantId).toBe(tenantBId);
    });

    it('[DB-3] rejette un 3e User avec même email dans tenant A (conflit unique composite)', async () => {
      await expect(
        prisma.user.create({
          data: { tenantId: tenantAId, email: SHARED_EMAIL, name: 'Dup', userType: 'CUSTOMER' },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DB-2 + DB-4 : Account credential tenant-scoped
  // ═══════════════════════════════════════════════════════════════════════════

  describe('[DB-2/DB-4] Account credential tenant-scoped via AuthIdentityService', () => {
    it('crée 2 Account credential avec le même email + mot de passe dans 2 tenants', async () => {
      const userA = await prisma.user.findUniqueOrThrow({
        where: { tenantId_email: { tenantId: tenantAId, email: SHARED_EMAIL } },
      });
      const userB = await prisma.user.findUniqueOrThrow({
        where: { tenantId_email: { tenantId: tenantBId, email: SHARED_EMAIL } },
      });

      const hash = await bcrypt.hash(SHARED_PASSWORD, 10);

      const acctA = await identity.upsertCredentialAccount({
        tenantId: tenantAId, userId: userA.id, email: SHARED_EMAIL, passwordHash: hash,
      });
      const acctB = await identity.upsertCredentialAccount({
        tenantId: tenantBId, userId: userB.id, email: SHARED_EMAIL, passwordHash: hash,
      });

      expect(acctA.id).not.toBe(acctB.id);
      expect(acctA.tenantId).toBe(tenantAId);
      expect(acctB.tenantId).toBe(tenantBId);
      expect(acctA.accountId).toBe(SHARED_EMAIL);
      expect(acctB.accountId).toBe(SHARED_EMAIL);
    });

    it('findCredentialAccount retourne LE BON tenant (scope strict)', async () => {
      const a = await identity.findCredentialAccount(tenantAId, SHARED_EMAIL);
      const b = await identity.findCredentialAccount(tenantBId, SHARED_EMAIL);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.tenantId).toBe(tenantAId);
      expect(b!.tenantId).toBe(tenantBId);
      // User différent !
      expect(a!.user.id).not.toBe(b!.user.id);
      // Password hash identique côté DB (c'est le même mot de passe),
      // mais les comptes sont 100% indépendants.
      expect(a!.user.email).toBe(b!.user.email);
    });

    it('findCredentialAccount retourne null pour un tenant inexistant', async () => {
      const ghostId = '00000000-0000-0000-0000-000000099999';
      const res = await identity.findCredentialAccount(ghostId, SHARED_EMAIL);
      expect(res).toBeNull();
    });

    it('bcrypt.compare fonctionne indépendamment sur chaque account', async () => {
      const a = await identity.findCredentialAccount(tenantAId, SHARED_EMAIL);
      const b = await identity.findCredentialAccount(tenantBId, SHARED_EMAIL);

      expect(await bcrypt.compare(SHARED_PASSWORD, a!.password!)).toBe(true);
      expect(await bcrypt.compare(SHARED_PASSWORD, b!.password!)).toBe(true);
      expect(await bcrypt.compare('wrong', a!.password!)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DB-5 : Reset password tokens indépendants par tenant
  // ═══════════════════════════════════════════════════════════════════════════

  describe('[DB-5] Password reset tokens tenant-scoped', () => {
    it('stocke un token de reset sur tenant A n\'affecte pas tenant B', async () => {
      const tokenHashA = 'aaaa' + 'a'.repeat(60);
      const expiresAt = new Date(Date.now() + 30 * 60_000);

      const updated = await identity.storePasswordResetToken({
        tenantId: tenantAId, email: SHARED_EMAIL,
        tokenHash: tokenHashA, expiresAt,
      });
      expect(updated).not.toBeNull();

      const a = await identity.findCredentialAccount(tenantAId, SHARED_EMAIL);
      const b = await identity.findCredentialAccount(tenantBId, SHARED_EMAIL);

      expect(a!.passwordResetTokenHash).toBe(tokenHashA);
      expect(b!.passwordResetTokenHash).toBeNull(); // Tenant B intact
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DB-6 : TenantDomain lookup
  // ═══════════════════════════════════════════════════════════════════════════

  describe('[DB-6] TenantDomain unique par hostname', () => {
    it('crée un TenantDomain et peut le retrouver', async () => {
      const hostname = `${SLUG_A}.translog.test`;
      const td = await prisma.tenantDomain.create({
        data: { tenantId: tenantAId, hostname, isPrimary: false, verifiedAt: new Date() },
      });

      const found = await prisma.tenantDomain.findUnique({
        where: { hostname },
        include: { tenant: true },
      });
      expect(found).not.toBeNull();
      expect(found!.tenantId).toBe(tenantAId);
      expect(found!.tenant.slug).toBe(SLUG_A);

      // Cleanup
      await prisma.tenantDomain.delete({ where: { id: td.id } });
    });

    it('rejette un 2e TenantDomain avec le même hostname (unicité globale)', async () => {
      const hostname = `dup-${SLUG_A}.translog.test`;
      await prisma.tenantDomain.create({
        data: { tenantId: tenantAId, hostname, isPrimary: false, verifiedAt: new Date() },
      });

      await expect(
        prisma.tenantDomain.create({
          data: { tenantId: tenantBId, hostname, isPrimary: false, verifiedAt: new Date() },
        }),
      ).rejects.toThrow(/Unique constraint/);

      // Cleanup
      await prisma.tenantDomain.deleteMany({ where: { hostname } });
    });
  });
});
