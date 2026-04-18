/**
 * scripts/seed-e2e.ts
 *
 * Seed idempotent des comptes de test utilisés par la suite Playwright du
 * portail plateforme. Lancé par `test/playwright/global-setup.ts`, ou à la
 * main : `npx ts-node scripts/seed-e2e.ts`.
 *
 * Comptes créés/garantis :
 *   - e2e-sa@translog.test       (SUPER_ADMIN, tenant plateforme)
 *   - e2e-tenant-admin@e2e.local (TENANT_ADMIN, tenant "pw-e2e-tenant")
 *
 * Mot de passe commun (DEV SEULEMENT) : Passw0rd!E2E
 *
 * Idempotent : relance sans effet si les users existent déjà.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  PLATFORM_TENANT_ID,
  PLATFORM_AGENCY_NAME,
  ensureDefaultAgency,
  seedTenantRoles,
} from '../prisma/seeds/iam.seed';

const prisma = new PrismaClient();

// ─── Constantes E2E (exportées pour les tests Playwright) ───────────────────

/**
 * Comptes E2E. Les slugs des tenants sont choisis parmi ceux que `dev-up.sh`
 * provisionne dans /etc/hosts (`trans-express`, `citybus-congo`) — évite
 * d'avoir à modifier /etc/hosts à la main pour les tests navigateur.
 *
 * L'email E2E utilise un suffixe identifiant clairement ces users (ne pas
 * confondre avec les vrais utilisateurs de démo du tenant).
 */
export const E2E = {
  password:         'Passw0rd!E2E',
  superAdmin: {
    email: 'e2e-sa@translog.test',
    name:  'E2E SuperAdmin',
  },
  tenantAdmin: {
    email: 'e2e-tenant-admin@trans-express.translog.test',
    name:  'E2E TenantAdmin',
    tenant: {
      // Tenant existant pré-provisionné par dev.sh (dans /etc/hosts).
      slug: 'trans-express',
    },
  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureAccount(userId: string, email: string, plain: string): Promise<void> {
  const hash = await bcrypt.hash(plain, 10);
  // Account unique par (providerId, accountId)
  const existing = await prisma.account.findFirst({
    where: { providerId: 'credential', accountId: email },
  });
  if (existing) {
    // Refresh password hash à chaque seed — permet de réinitialiser le compte E2E
    await prisma.account.update({
      where: { id: existing.id },
      data:  { password: hash, userId },
    });
  } else {
    await prisma.account.create({
      data: {
        userId,
        tenantId: (await prisma.user.findUnique({ where: { id: userId } }))!.tenantId,
        providerId: 'credential',
        accountId:  email,
        password:   hash,
      },
    });
  }
}

async function ensurePlatformSuperAdmin(): Promise<string> {
  const role = await prisma.role.findFirst({
    where: { tenantId: PLATFORM_TENANT_ID, name: 'SUPER_ADMIN' },
  });
  if (!role) {
    throw new Error('[seed-e2e] Role SUPER_ADMIN introuvable. Lancez `npx ts-node prisma/seeds/iam.seed.ts` d\'abord.');
  }

  const existing = await prisma.user.findFirst({
    where: { email: E2E.superAdmin.email },
  });
  if (existing) {
    await ensureAccount(existing.id, E2E.superAdmin.email, E2E.password);
    console.log(`[seed-e2e] SA déjà existant → reset mot de passe (${existing.id})`);
    return existing.id;
  }

  const user = await prisma.user.create({
    data: {
      tenantId: PLATFORM_TENANT_ID,
      email:    E2E.superAdmin.email,
      name:     E2E.superAdmin.name,
      roleId:   role.id,
      userType: 'STAFF',
    },
  });
  await ensureAccount(user.id, E2E.superAdmin.email, E2E.password);
  console.log(`[seed-e2e] SA créé : ${user.id} (${user.email})`);
  return user.id;
}

async function ensureTenantAdmin(): Promise<{ userId: string; tenantId: string }> {
  // 1. Tenant déjà existant en DB (provisionné par dev.sh — trans-express).
  // On refuse explicitement de recréer un tenant via E2E : ce script est
  // idempotent sur les users, pas sur le tenant lui-même.
  const tenant = await prisma.tenant.findUnique({ where: { slug: E2E.tenantAdmin.tenant.slug } });
  if (!tenant) {
    throw new Error(
      `[seed-e2e] Tenant "${E2E.tenantAdmin.tenant.slug}" introuvable. ` +
      `Il doit être provisionné par dev.sh avant de lancer les E2E.`,
    );
  }

  // 2. Garantit rôles tenant + agence par défaut (idempotent upsert)
  const roleMap = await seedTenantRoles(prisma, tenant.id);
  await ensureDefaultAgency(prisma as unknown as never, tenant.id, 'Agence principale');

  const adminRoleId = roleMap.get('TENANT_ADMIN');
  if (!adminRoleId) throw new Error('[seed-e2e] TENANT_ADMIN role manquant');

  // 3. Agence principale pour rattachement
  const agency = await prisma.agency.findFirst({ where: { tenantId: tenant.id } });
  if (!agency) throw new Error('[seed-e2e] Agence manquante après ensureDefaultAgency');

  // 4. User TENANT_ADMIN
  const existing = await prisma.user.findFirst({
    where: { email: E2E.tenantAdmin.email, tenantId: tenant.id },
  });
  if (existing) {
    await ensureAccount(existing.id, E2E.tenantAdmin.email, E2E.password);
    console.log(`[seed-e2e] TENANT_ADMIN déjà existant → reset mot de passe (${existing.id})`);
    return { userId: existing.id, tenantId: tenant.id };
  }

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      agencyId: agency.id,
      email:    E2E.tenantAdmin.email,
      name:     E2E.tenantAdmin.name,
      roleId:   adminRoleId,
      userType: 'STAFF',
    },
  });
  await ensureAccount(user.id, E2E.tenantAdmin.email, E2E.password);
  console.log(`[seed-e2e] TENANT_ADMIN créé : ${user.id} (${user.email}) dans tenant ${tenant.slug}`);

  return { userId: user.id, tenantId: tenant.id };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function ensureE2EPlan(): Promise<void> {
  // Plan E2E visible dans /admin/platform/plans — permet aux tests de vérifier
  // la présence d'au moins 1 ligne. Slug fixé, idempotent.
  const existing = await prisma.plan.findUnique({ where: { slug: 'e2e-starter' } });
  if (existing) return;

  await prisma.plan.create({
    data: {
      slug:         'e2e-starter',
      name:         'E2E Starter',
      description:  'Plan de démo utilisé par la suite Playwright.',
      price:        19,
      currency:     'EUR',
      billingCycle: 'MONTHLY',
      trialDays:    14,
      limits:       { maxUsers: 10 },
      sla:          { maxPriority: 'NORMAL' },
      sortOrder:    999,
      isPublic:     true,
      isActive:     true,
    },
  });
  console.log('[seed-e2e] Plan E2E créé : e2e-starter');
}

async function ensureE2ESupportTicket(tenantId: string, reporterUserId: string): Promise<void> {
  // Ticket de démo côté tenant — permet aux tests "liste mes tickets" de
  // trouver au moins une ligne cliquable.
  const existing = await prisma.supportTicket.findFirst({
    where: { tenantId, reporterUserId, title: { startsWith: '[E2E]' } },
  });
  if (existing) return;

  await prisma.supportTicket.create({
    data: {
      tenantId,
      reporterUserId,
      title:       '[E2E] Ticket de démonstration Playwright',
      description: 'Ce ticket est créé par scripts/seed-e2e.ts et sert de fixture pour la suite Playwright. Il peut être ignoré.',
      category:    'QUESTION',
      priority:    'NORMAL',
      status:      'OPEN',
    },
  });
  console.log('[seed-e2e] Ticket E2E créé dans tenant trans-express');
}

export async function seedE2E(): Promise<void> {
  console.log('[seed-e2e] Seed comptes E2E (idempotent)…');
  await ensurePlatformSuperAdmin();
  const tenantAdmin = await ensureTenantAdmin();

  // Utilitaire pour purger l'agence "principale" du tenant plateforme :
  // on force la présence de "Main" pour que le setup initial reste cohérent.
  await ensureDefaultAgency(prisma as unknown as never, PLATFORM_TENANT_ID, PLATFORM_AGENCY_NAME);

  // Fixtures E2E supplémentaires (dé-skip les tests qui dépendent de données).
  await ensureE2EPlan();
  await ensureE2ESupportTicket(tenantAdmin.tenantId, tenantAdmin.userId);

  console.log('[seed-e2e] ✅ Prêt.');
}

// Standalone runner
if (require.main === module) {
  seedE2E()
    .catch((err) => {
      console.error('[seed-e2e] ❌', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
