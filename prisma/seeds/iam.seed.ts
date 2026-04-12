/**
 * IAM Seed — PRD §IV.11 Zero-Trust RBAC
 *
 * ARCHITECTURE :
 *   SUPER_ADMIN  — hors-tenant, stocké dans le tenant synthétique 'PLATFORM'.
 *                  Seul rôle avec des permissions *.global.
 *                  Créé UNE SEULE FOIS au bootstrap plateforme.
 *   Rôles tenant — créés à chaque onboarding via seedTenantRoles().
 *                  isSystem = true → non supprimables par les admins tenant.
 *
 * JAMAIS créer de SUPER_ADMIN lors d'un onboarding tenant.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── ID canoniques du tenant plateforme ───────────────────────────────────────
export const PLATFORM_TENANT_ID = 'PLATFORM';

// ─── Permissions *.global réservées au SUPER_ADMIN ───────────────────────────
const SUPER_ADMIN_PERMISSIONS = [
  'control.tenant.manage.global',
  'control.iam.manage.tenant',
  'control.iam.audit.tenant',
  'control.workflow.override.global',
  'control.safety.monitor.global',
  'data.traveler.track.global',
  'data.parcel.track.global',
  'control.stats.read.tenant',
];

// ─── Permissions par rôle tenant ──────────────────────────────────────────────

const TENANT_ROLES: Array<{
  name:        string;
  isSystem:    boolean;
  permissions: string[];
}> = [
  {
    name:     'TENANT_ADMIN',
    isSystem: true,
    permissions: [
      // Workflow & Config
      'control.workflow.config.tenant',
      'control.module.install.tenant',
      'control.settings.manage.tenant',
      'control.trip.cancel.tenant',
      'control.trip.delay.agency',
      'control.pricing.manage.tenant',
      'control.pricing.yield.tenant',
      'control.route.manage.tenant',
      'control.fleet.manage.tenant',
      'control.fleet.layout.tenant',
      'control.bus.capacity.tenant',
      'control.campaign.manage.tenant',
      'control.staff.manage.tenant',
      // Data
      'data.trip.create.tenant',
      'data.trip.read.own',
      'data.trip.update.agency',
      'data.trip.check.own',
      'data.trip.report.own',
      'data.trip.log_event.own',
      'data.ticket.create.agency',
      'data.ticket.cancel.agency',
      'data.ticket.scan.agency',
      'data.ticket.read.agency',
      'data.ticket.read.tenant',
      'data.traveler.verify.agency',
      'data.luggage.weigh.agency',
      'data.parcel.create.agency',
      'data.parcel.scan.agency',
      'data.parcel.update.agency',
      'data.parcel.update.tenant',
      'data.parcel.report.agency',
      'data.shipment.group.agency',
      'data.fleet.status.agency',
      'data.maintenance.update.own',
      'data.maintenance.approve.tenant',
      'data.manifest.generate.agency',
      'data.manifest.sign.agency',
      'data.manifest.read.own',
      'data.cashier.open.own',
      'data.cashier.transaction.own',
      'data.cashier.close.agency',
      'data.pricing.read.agency',
      'data.sav.report.own',
      'data.sav.report.agency',
      'data.sav.deliver.agency',
      'data.sav.claim.tenant',
      'data.staff.read.agency',
      'data.user.read.agency',
      'data.crm.read.tenant',
      'data.crew.manage.tenant',
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.session.revoke.tenant',
      'control.stats.read.tenant',
      'control.integration.setup.tenant',
      'data.display.update.agency',
    ],
  },
  {
    name:     'AGENCY_MANAGER',
    isSystem: true,
    permissions: [
      'control.trip.delay.agency',
      'data.trip.read.own',
      'data.trip.update.agency',
      'data.ticket.read.agency',
      'data.ticket.cancel.agency',
      'data.ticket.scan.agency',
      'data.traveler.verify.agency',
      'data.luggage.weigh.agency',
      'data.parcel.create.agency',
      'data.parcel.scan.agency',
      'data.parcel.update.agency',
      'data.parcel.report.agency',
      'data.shipment.group.agency',
      'data.fleet.status.agency',
      'data.manifest.generate.agency',
      'data.manifest.sign.agency',
      'data.manifest.read.own',
      'data.cashier.open.own',
      'data.cashier.transaction.own',
      'data.cashier.close.agency',
      'data.pricing.read.agency',
      'data.sav.report.agency',
      'data.sav.deliver.agency',
      'data.sav.claim.tenant',
      'data.staff.read.agency',
      'data.user.read.agency',
      'data.display.update.agency',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'CASHIER',
    isSystem: true,
    permissions: [
      'data.ticket.create.agency',
      'data.ticket.cancel.agency',
      'data.ticket.read.agency',
      'data.parcel.create.agency',
      'data.cashier.open.own',
      'data.cashier.transaction.own',
      'data.cashier.close.agency',
      'data.pricing.read.agency',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'DRIVER',
    isSystem: true,
    permissions: [
      'data.trip.read.own',
      'data.trip.update.agency',   // départ, arrivée
      'data.trip.check.own',
      'data.trip.report.own',
      'data.trip.log_event.own',
      'control.trip.delay.agency',
      'data.ticket.scan.agency',
      'data.traveler.verify.agency',
      'data.manifest.read.own',
      'data.sav.report.own',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'HOSTESS',
    isSystem: true,
    permissions: [
      'data.trip.read.own',
      'data.ticket.scan.agency',
      'data.traveler.verify.agency',
      'data.luggage.weigh.agency',
      'data.manifest.read.own',
      'data.sav.report.own',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'MECHANIC',
    isSystem: true,
    permissions: [
      'data.fleet.status.agency',
      'data.maintenance.update.own',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'VOYAGEUR',
    isSystem: true,
    permissions: [
      'data.feedback.submit.own',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'DISPATCHER',
    isSystem: true,
    permissions: [
      'control.safety.monitor.global',
      'data.trip.read.own',
      'data.trip.update.agency',
      'control.trip.delay.agency',
      'data.parcel.track.global',
      'data.traveler.track.global',
      'data.display.update.agency',
      'data.notification.read.own',
      'data.session.revoke.own',
    ],
  },
  {
    name:     'PUBLIC_REPORTER',
    isSystem: true,
    permissions: [
      'data.feedback.submit.own',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Platform (run ONCE at first startup)
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapPlatform(): Promise<void> {
  // Crée le tenant plateforme s'il n'existe pas
  const platformTenant = await prisma.tenant.upsert({
    where:  { id: PLATFORM_TENANT_ID },
    update: {},
    create: {
      id:              PLATFORM_TENANT_ID,
      name:            'TranslogPro Platform',
      slug:            '__platform__',
      provisionStatus: 'ACTIVE',
    },
  });

  // Crée le rôle SUPER_ADMIN (isSystem — non supprimable)
  const superAdminRole = await prisma.role.upsert({
    where:  { tenantId_name: { tenantId: PLATFORM_TENANT_ID, name: 'SUPER_ADMIN' } },
    update: {},
    create: {
      tenantId: PLATFORM_TENANT_ID,
      name:     'SUPER_ADMIN',
      isSystem: true,
    },
  });

  // Seed des permissions *.global
  for (const permission of SUPER_ADMIN_PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where:  { roleId_permission: { roleId: superAdminRole.id, permission } },
      update: {},
      create: { roleId: superAdminRole.id, permission },
    });
  }

  console.log(`[IAM Seed] SUPER_ADMIN role bootstrapped (id=${superAdminRole.id})`);
  return;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Tenant Seeding (appelé par OnboardingService — JAMAIS de SUPER_ADMIN ici)
// ─────────────────────────────────────────────────────────────────────────────

export async function seedTenantRoles(
  prismaClient: PrismaClient,
  tenantId:     string,
): Promise<Map<string, string>> {
  // Retourne Map<roleName, roleId> pour assigner l'admin au rôle TENANT_ADMIN
  const roleMap = new Map<string, string>();

  for (const roleDef of TENANT_ROLES) {
    const role = await prismaClient.role.upsert({
      where:  { tenantId_name: { tenantId, name: roleDef.name } },
      update: {},
      create: {
        tenantId,
        name:     roleDef.name,
        isSystem: roleDef.isSystem,
      },
    });

    for (const permission of roleDef.permissions) {
      await prismaClient.rolePermission.upsert({
        where:  { roleId_permission: { roleId: role.id, permission } },
        update: {},
        create: { roleId: role.id, permission },
      });
    }

    roleMap.set(roleDef.name, role.id);
  }

  return roleMap;
}

// ─── Standalone runner ────────────────────────────────────────────────────────
async function main() {
  await bootstrapPlatform();
  console.log('[IAM Seed] Platform bootstrap complete');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
