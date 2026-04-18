/**
 * Playwright fixtures — création/cleanup de tenants de test sur la dev DB.
 *
 * Utilise le client Prisma pour provisionner :
 *   - 2 tenants isolés avec slug généré `pw-a-{ts}` / `pw-b-{ts}`
 *   - 1 TenantDomain par tenant pour chaque (dev + prod)
 *   - 1 Role "staff" par tenant
 *   - 1 User + Account credential par tenant, mêmes email + password
 *
 * afterAll : cleanup complet (cascade delete).
 *
 * Pourquoi Prisma direct et pas HTTP ? Parce que la création initiale de
 * tenants est un flow admin plateforme qui nécessite déjà une session
 * authentifiée — on court-circuite pour les fixtures.
 */

import { test as base } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { execSync } from 'child_process';

/**
 * Flush Redis avant chaque test pour éviter le rate-limit 5/15min sur /sign-in
 * (localhost toujours même IP → quota partagé entre tests).
 * Best-effort : si Redis pas accessible on n'échoue pas — les tests qui font
 * trop d'appels signIn échoueront avec 429 et le sauront.
 */
function flushRedis(): void {
  try {
    execSync(
      'docker exec translog-redis redis-cli -a redis_password --no-auth-warning FLUSHDB > /dev/null 2>&1',
      { timeout: 3000 },
    );
  } catch { /* best-effort */ }
}

export interface TenantFixture {
  id:       string;
  slug:     string;
  hostname: string;         // "{slug}.translog.test"
  userId:   string;
  userEmail: string;
  userPassword: string;
}

export interface MultiTenantFixtures {
  prisma:   PrismaClient;
  tenantA:  TenantFixture;
  tenantB:  TenantFixture;
}

const SHARED_EMAIL    = `pw.shared+${Date.now()}@test.local`;
const SHARED_PASSWORD = 'Pa$$word12345';

export const test = base.extend<MultiTenantFixtures>({
  prisma: async ({}, use) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://app_user:app_password@localhost:5434/translog' } },
    });
    await use(prisma);
    await prisma.$disconnect();
  },

  tenantA: async ({ prisma }, use) => {
    flushRedis();   // rate-limit signIn partagé par localhost — flush avant chaque test
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const fixture = await createTenantFixture(prisma, `pw-a-${ts}-${rand}`, `${rand}@shared.local`, SHARED_PASSWORD);
    await use(fixture);
    await cleanupTenantFixture(prisma, fixture.id);
  },

  tenantB: async ({ prisma, tenantA }, use) => {
    // tenantB utilise LE MÊME email que tenantA (partagé pour tester l'isolation)
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const fixture = await createTenantFixture(
      prisma, `pw-b-${ts}-${rand}`, tenantA.userEmail, SHARED_PASSWORD,
    );
    await use(fixture);
    await cleanupTenantFixture(prisma, fixture.id);
  },
});

export { expect } from '@playwright/test';

async function createTenantFixture(
  prisma:   PrismaClient,
  slug:     string,
  email:    string,
  password: string,
): Promise<TenantFixture> {
  const tenant = await prisma.tenant.create({
    data: {
      name:     `Playwright Tenant ${slug}`,
      slug,
      country:  'CG',
      language: 'fr',
    },
  });

  const hostname = `${slug}.translog.test`;
  await prisma.tenantDomain.create({
    data: {
      tenantId:   tenant.id,
      hostname,
      isPrimary:  true,
      verifiedAt: new Date(),
    },
  });

  const role = await prisma.role.create({
    data: { tenantId: tenant.id, name: 'pw-staff', isSystem: false },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      name:     `PW User ${slug}`,
      roleId:   role.id,
      userType: 'STAFF',
      isActive: true,
    },
  });

  const hash = await bcrypt.hash(password, 10);
  await prisma.account.create({
    data: {
      tenantId:   tenant.id,
      userId:     user.id,
      providerId: 'credential',
      accountId:  email,
      password:   hash,
    },
  });

  return {
    id:          tenant.id,
    slug:        tenant.slug,
    hostname,
    userId:      user.id,
    userEmail:   email,
    userPassword: password,
  };
}

async function cleanupTenantFixture(prisma: PrismaClient, tenantId: string): Promise<void> {
  // Cascade delete via FK onDelete: Cascade — mais par sécurité on efface
  // explicitement sessions/audit qui n'ont pas forcément la cascade.
  await prisma.session.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenantDomain.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}
