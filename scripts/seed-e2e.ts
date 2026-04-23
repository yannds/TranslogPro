/**
 * scripts/seed-e2e.ts
 *
 * Seed idempotent des comptes de test utilisés par la suite Playwright du
 * portail plateforme. Lancé par `test/playwright/global-setup.ts`, ou à la
 * main : `npx ts-node scripts/seed-e2e.ts`.
 *
 * Comptes créés/garantis :
 *   - e2e-sa@translog.test                              (SUPER_ADMIN, tenant plateforme)
 *   - e2e-tenant-admin@trans-express.translog.test      (TENANT_ADMIN, tenant "trans-express")
 *   - e2e-tenant-admin@e2e.local                        (TENANT_ADMIN, tenant E2E dédié "pw-e2e-tenant",
 *                                                        UUID `2d48bdfa-5f6e-433d-ba70-5410ca870865`)
 *
 * Mot de passe commun (DEV SEULEMENT) : Passw0rd!E2E
 *
 * Idempotent : relance sans effet si les users/tenants existent déjà.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as vault from 'node-vault';
import {
  PLATFORM_TENANT_ID,
  PLATFORM_AGENCY_NAME,
  ensureDefaultAgency,
  seedTenantRoles,
  backfillDefaultWorkflows,
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
  /**
   * Tenant E2E dédié pour les suites *.api.spec.ts qui mutent fortement
   * l'état (crée agencies/stations/routes/bus/trips). Isolé du tenant
   * "trans-express" pour ne pas polluer les démos.
   *
   * L'UUID est hardcodé dans les specs (business-scenarios, cross-module,
   * pricing-dynamics, traveler-scenarios, trip-freight-departure) → doit
   * rester stable.
   */
  pwE2ETenant: {
    id:       '2d48bdfa-5f6e-433d-ba70-5410ca870865',
    slug:     'pw-e2e-tenant',
    name:     'Playwright E2E Tenant',
    hostname: 'pw-e2e-tenant.translog.test',
    adminEmail: 'e2e-tenant-admin@e2e.local',
    adminName:  'E2E PW TenantAdmin',
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

/**
 * Provisionne le tenant E2E dédié `pw-e2e-tenant` (UUID hardcodé dans les
 * specs). Idempotent : crée le tenant + son admin si absents, sinon refresh
 * le mot de passe seulement.
 */
async function ensurePwE2ETenant(): Promise<{ userId: string; tenantId: string }> {
  const cfg = E2E.pwE2ETenant;

  // 1. Tenant : upsert par UUID stable (différent de findUnique({ slug }) car
  //    on veut garantir l'UUID exact attendu par les specs).
  let tenant = await prisma.tenant.findUnique({ where: { id: cfg.id } });
  if (!tenant) {
    // Vérifie qu'il n'y a pas déjà un tenant avec ce slug (collision possible)
    const bySlug = await prisma.tenant.findUnique({ where: { slug: cfg.slug } });
    if (bySlug) {
      throw new Error(
        `[seed-e2e] Tenant slug "${cfg.slug}" existe déjà avec un UUID différent (${bySlug.id}). ` +
        `Supprimez-le ou alignez l'UUID dans les specs Playwright.`,
      );
    }
    tenant = await prisma.tenant.create({
      data: {
        id:       cfg.id,
        slug:     cfg.slug,
        name:     cfg.name,
        country:  'FR',
        language: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        // provisionStatus défaut PENDING — on force ACTIVE car l'env E2E
        // skip l'onboarding wizard (le tenant est utilisé immédiatement)
        provisionStatus: 'ACTIVE',
      },
    });
    console.log(`[seed-e2e] Tenant E2E créé : ${tenant.id} (${tenant.slug})`);
  }

  // 2. Roles + Agency par défaut (idempotent)
  const roleMap = await seedTenantRoles(prisma, tenant.id);
  await ensureDefaultAgency(prisma as unknown as never, tenant.id, 'Agence principale');

  const adminRoleId = roleMap.get('TENANT_ADMIN');
  if (!adminRoleId) throw new Error('[seed-e2e] TENANT_ADMIN role manquant pour pw-e2e-tenant');

  const agency = await prisma.agency.findFirst({ where: { tenantId: tenant.id } });
  if (!agency) throw new Error('[seed-e2e] Agence manquante après ensureDefaultAgency (pw-e2e-tenant)');

  // 3. User TENANT_ADMIN — refresh password à chaque seed
  const existing = await prisma.user.findFirst({
    where: { email: cfg.adminEmail, tenantId: tenant.id },
  });
  if (existing) {
    await ensureAccount(existing.id, cfg.adminEmail, E2E.password);
    console.log(`[seed-e2e] PW E2E TENANT_ADMIN existant → password refresh (${existing.id})`);
    return { userId: existing.id, tenantId: tenant.id };
  }

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      agencyId: agency.id,
      email:    cfg.adminEmail,
      name:     cfg.adminName,
      roleId:   adminRoleId,
      userType: 'STAFF',
    },
  });
  await ensureAccount(user.id, cfg.adminEmail, E2E.password);
  console.log(`[seed-e2e] PW E2E TENANT_ADMIN créé : ${user.id} (${user.email}) dans tenant ${tenant.slug}`);

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

/**
 * Provisionne la clé HMAC du tenant dans Vault si absente — nécessaire pour
 * toute signature QR (tickets, manifestes). Sans cette clé, les flows de
 * rebook/confirm/scan cassent en 500 (Vault secret read failed).
 * Idempotent : ne régénère jamais la clé si elle existe (casserait les QR émis).
 */
async function ensureHmacKey(tenantId: string): Promise<void> {
  const vaultAddr = process.env.VAULT_ADDR;
  if (!vaultAddr) {
    console.warn('[seed-e2e] VAULT_ADDR absent — skip HMAC provisioning');
    return;
  }
  const factory = ((vault as unknown as { default?: typeof vault }).default ?? vault) as unknown as (...args: unknown[]) => {
    read:  (path: string) => Promise<{ data: { data: Record<string, string> } }>;
    write: (path: string, data: { data: Record<string, string> }) => Promise<unknown>;
  };
  const client = factory({ apiVersion: 'v1', endpoint: vaultAddr, token: process.env.VAULT_TOKEN });
  const path = `tenants/${tenantId}/hmac`;
  try {
    const result = await client.read(`secret/data/${path}`);
    if (result?.data?.data?.KEY && String(result.data.data.KEY).length >= 32) return;
  } catch { /* absent → provisionner */ }
  const key = randomBytes(32).toString('hex');
  await client.write(`secret/data/${path}`, { data: { KEY: key } });
  console.log(`[seed-e2e] HMAC key provisioned in Vault for tenant ${tenantId}`);
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

  // Tenant E2E dédié pour les suites *.api.spec.ts qui mutent fortement
  // l'état (business-scenarios, cross-module-journey, pricing-dynamics,
  // traveler-scenarios, trip-freight-departure).
  const pwE2E = await ensurePwE2ETenant();

  // HMAC Vault pour tous les tenants E2E (tous ceux qui signent des QR)
  await ensureHmacKey(tenantAdmin.tenantId);
  await ensureHmacKey(pwE2E.tenantId);

  // Workflow blueprints par défaut (Ticket, Parcel, Trip, Voucher, etc.)
  // — sans cela toutes les transitions font 400 "aucune WorkflowConfig active".
  const wf = await backfillDefaultWorkflows(prisma);
  console.log(`[seed-e2e] Workflow configs backfill : ${wf.rowsCreated} rows sur ${wf.scanned} tenants`);

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
