/**
 * Helpers Playwright pour octroyer permissions + modules + agency à un tenant
 * de test, et obtenir un cookie d'auth.
 *
 * Évite à chaque spec d'avoir à mocker manuellement le seeding des permissions
 * et des modules pour tester un flow business (ticketing, parcels, SAV…).
 *
 * Usage typique :
 *
 *   import { grantAllPermissions, ensureAgency, signIn, ensureModule } from './helpers/admin-setup';
 *
 *   const agencyId = await ensureAgency(tenantA.id);
 *   await grantAllPermissions(tenantA.userId);
 *   await ensureModule(tenantA.id, 'FLEET_DOCS');
 *   const { cookie } = await signIn(request, tenantA);
 */
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Toutes les permissions tenant — à utiliser pour bypasser le RBAC dans les tests E2E. */
const ALL_TENANT_PERMISSIONS = [
  // Fleet
  'control.fleet.manage.tenant',
  'data.fleet.status.agency',
  'control.maintenance.update.own',
  'data.maintenance.update.own',
  'data.maintenance.read.agency',
  'control.maintenance.approve.tenant',
  'control.driver.manage.tenant',
  'data.driver.profile.agency',
  'control.driver.rest.own',
  'data.driver.rest.own',
  // Trips & Tickets
  'control.trip.manage.tenant',
  'data.trip.read.agency',
  'data.trip.update.agency',
  'data.trip.report.own',
  'control.ticket.issue.agency',
  'data.ticket.create.agency',
  'data.ticket.cancel.agency',
  'control.ticket.refund.agency',
  'data.refund.request.own',
  'control.ticket.scan.agency',
  'data.ticket.scan.agency',
  'data.ticket.rebook.agency',
  'data.ticket.noshow_mark.agency',
  'data.ticket.refund_request.agency',
  // Parcels
  'control.parcel.manage.tenant',
  'data.parcel.read.agency',
  'control.parcel.hub.agency',
  'data.parcel.hub_move.agency',
  'data.parcel.create.agency',
  'data.parcel.deliver.agency',
  // SAV
  'control.sav.manage.tenant',
  'data.sav.read.agency',
  'data.sav.report.own',
  'data.sav.report.agency',
  'data.sav.deliver.agency',
  'data.sav.claim.tenant',
  'control.refund.approve.tenant',
  'data.refund.approve.tenant',
  'data.refund.process.tenant',
  // Settings
  'control.settings.manage.tenant',
  // Templates
  'data.template.read.agency',
  'data.template.write.agency',
  'data.template.delete.agency',
  // IAM
  'control.iam.manage.tenant',
  'data.iam.audit.tenant',
  // CRM
  'data.crm.read.tenant',
  'data.crm.read.agency',
  'data.crm.write.tenant',
  'data.crm.write.agency',
  'control.campaign.manage.tenant',
  // QHSE
  'control.qhse.manage.tenant',
  'data.qhse.read.tenant',
  'data.accident.report.own',
  // Notifications
  'data.notification.read.own',
  // Crew Briefing
  'control.briefing.template.manage.tenant',
  'data.briefing.template.read.tenant',
  'data.safety_alert.read.agency',
  'data.safety_alert.read.tenant',
  'control.safety_alert.resolve.agency',
  'control.safety_alert.resolve.tenant',
  'data.safety_alert.create.tenant',
  // Cashier
  'control.cashier.manage.tenant',
  // Manifest
  'data.manifest.read.agency',
  'control.manifest.close.agency',
];

export async function grantAllPermissions(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { roleId: true } });
  if (!user?.roleId) throw new Error(`User ${userId} has no role`);
  for (const permission of ALL_TENANT_PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where:  { roleId_permission: { roleId: user.roleId, permission } },
      update: {},
      create: { roleId: user.roleId, permission },
    });
  }
}

export async function ensureAgency(tenantId: string, name = 'PW-Default'): Promise<string> {
  const existing = await prisma.agency.findFirst({
    where:  { tenantId },
    select: { id: true },
  });
  if (existing) return existing.id;
  const agency = await prisma.agency.create({
    data:   { tenantId, name },
    select: { id: true },
  });
  return agency.id;
}

export async function setUserAgency(userId: string, agencyId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data:  { agencyId },
  });
}

export async function ensureModule(tenantId: string, moduleKey: string): Promise<void> {
  await prisma.installedModule.upsert({
    where:  { tenantId_moduleKey: { tenantId, moduleKey } },
    update: { isActive: true },
    create: { tenantId, moduleKey, isActive: true },
  });
}

/**
 * Seed un TenantBusinessConfig avec valeurs par défaut — nécessaire pour
 * les services qui lisent des paramètres business (CancellationPolicyService,
 * PricingEngine, etc.). Ne touche pas si déjà présent.
 */
export async function ensureBusinessConfig(tenantId: string): Promise<void> {
  await prisma.tenantBusinessConfig.upsert({
    where:  { tenantId },
    update: {},
    create: { tenantId },
  });
}

/**
 * Seed les WorkflowConfig par défaut sur le tenant — nécessaire pour
 * que toute transition d'état (Ticket no-show, Parcel hub, Trip incident…)
 * soit autorisée par le WorkflowEngine.
 *
 * Importe DEFAULT_WORKFLOW_CONFIGS depuis le seed canonique pour rester
 * source-of-truth unique.
 */
export async function ensureWorkflowConfigs(tenantId: string): Promise<void> {
  const { DEFAULT_WORKFLOW_CONFIGS } = await import('../../../prisma/seeds/iam.seed');
  await prisma.workflowConfig.createMany({
    data: DEFAULT_WORKFLOW_CONFIGS.map((c: { entityType: string; fromState: string; action: string; toState: string; requiredPerm: string }) => ({
      ...c,
      tenantId,
      guards:      [],
      sideEffects: [],
      isActive:    true,
      version:     1,
    })),
    skipDuplicates: true,
  });
}

export async function ensureModules(tenantId: string, keys: string[]): Promise<void> {
  for (const k of keys) await ensureModule(tenantId, k);
}

export interface SignInResult {
  cookie:        string;
  authHeaders:   { Host: string; Cookie: string };
}

/**
 * Effectue le sign-in HTTP et retourne les headers d'auth prêts à l'emploi.
 * Suppose que les permissions/modules ont été provisionnés en amont.
 */
export async function signIn(
  request: APIRequestContext,
  tenant:  { id: string; hostname: string; userEmail: string; userPassword: string },
): Promise<SignInResult> {
  const res = await request.post('/api/auth/sign-in', {
    data:    { email: tenant.userEmail, password: tenant.userPassword },
    headers: { Host: tenant.hostname },
  });
  if (res.status() !== 200) {
    throw new Error(`Sign-in failed [${res.status()}] : ${await res.text()}`);
  }
  const cookie = res.headers()['set-cookie']!.split(';')[0];
  return { cookie, authHeaders: { Host: tenant.hostname, Cookie: cookie } };
}

/**
 * Setup complet "admin" : agency + perms + modules + signIn.
 * Renvoie agencyId + cookie d'auth.
 */
export async function setupAdminTenant(
  request: APIRequestContext,
  tenant:  { id: string; hostname: string; userId: string; userEmail: string; userPassword: string },
  modules: string[] = [],
): Promise<{ agencyId: string; cookie: string; authHeaders: { Host: string; Cookie: string } }> {
  const agencyId = await ensureAgency(tenant.id);
  await setUserAgency(tenant.userId, agencyId);
  await grantAllPermissions(tenant.userId);
  await ensureBusinessConfig(tenant.id);
  await ensureWorkflowConfigs(tenant.id);
  if (modules.length > 0) await ensureModules(tenant.id, modules);
  const { cookie, authHeaders } = await signIn(request, tenant);
  return { agencyId, cookie, authHeaders };
}
