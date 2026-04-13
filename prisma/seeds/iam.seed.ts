/**
 * IAM Seed — PRD §IV.11 Zero-Trust RBAC + §IV.12 Impersonation JIT
 *
 * ARCHITECTURE TENANT PLATEFORME :
 *   UUID système  : "00000000-0000-0000-0000-000000000000" (nil UUID canonique)
 *   Slug          : "__platform__"
 *   Ce tenant n'existe JAMAIS dans le flux d'onboarding client.
 *   Aucun utilisateur standard ne peut y être assigné (bloqué par PlatformTenantGuard).
 *
 * RÔLES SYSTÈME (tenant 00000000-...) :
 *   SUPER_ADMIN  — Control Plane complet (permissions *.global)
 *   SUPPORT_L1   — Data Plane lecture globale + switch d'impersonation
 *   SUPPORT_L2   — L1 + outils de debug workflow/outbox
 *
 * Rôles tenant — créés à chaque onboarding via seedTenantRoles().
 *   isSystem = true → non supprimables par les admins tenant.
 *
 * RÈGLE ABSOLUE : JAMAIS créer SUPER_ADMIN/SUPPORT lors d'un onboarding tenant.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── ID canoniques du tenant plateforme ───────────────────────────────────────
// Nil UUID (RFC 4122) — identifiant système stable, jamais généré aléatoirement.
// Référencé dans PlatformTenantGuard pour bloquer tout accès non autorisé.
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// ─── Permissions *.global réservées au SUPER_ADMIN (Control Plane) ────────────
const SUPER_ADMIN_PERMISSIONS = [
  // Control Plane — gestion des tenants
  'control.tenant.manage.global',
  'control.iam.manage.tenant',
  'control.iam.audit.tenant',
  'control.workflow.override.global',
  'control.safety.monitor.global',
  'control.stats.read.tenant',
  // Platform staff management
  'control.platform.staff.global',
  // Data Plane — accès global en lecture
  'data.traveler.track.global',
  'data.parcel.track.global',
  'data.ticket.read.global',
  'data.trip.read.global',
  'data.manifest.read.global',
  'data.cashier.read.global',
  // Impersonation — switch de session JIT
  'control.impersonation.switch.global',
  'control.impersonation.revoke.global',
  // Documents imprimables (accès global pour assistance)
  'data.ticket.print.agency',
  'data.manifest.print.global',
  'data.parcel.print.agency',
  'data.invoice.print.agency',
];

// ─── Permissions SUPPORT_L1 : lecture Data Plane uniquement ──────────────────
// Principe du moindre privilège : les agents L1 voient les données clients
// uniquement via le mécanisme de switch de session (impersonation JIT).
// Ils n'ont AUCUN accès Control Plane (abonnements, workflow config, IAM).
const SUPPORT_L1_PERMISSIONS = [
  // Lecture globale Data Plane
  'data.ticket.read.global',
  'data.trip.read.global',
  'data.parcel.read.global',
  'data.traveler.read.global',
  'data.manifest.read.global',
  'data.cashier.read.global',
  'data.fleet.read.global',
  // Switch de session JIT uniquement (pas de révocation admin)
  'control.impersonation.switch.global',
  // Notifications propres
  'data.notification.read.own',
  'data.session.revoke.own',
  // Documents — lecture manifeste global (diagnostic support)
  'data.manifest.print.global',
];

// ─── Permissions SUPPORT_L2 : L1 + debug technique ───────────────────────────
// L2 peut rejouer des événements outbox et inspecter le state machine
// pour diagnostiquer des incidents. Toujours sans accès Control Plane.
const SUPPORT_L2_PERMISSIONS = [
  ...SUPPORT_L1_PERMISSIONS,
  // Debug technique
  'data.workflow.debug.global',
  'data.outbox.replay.global',
  // Révocation de session impersonation (escalade L2)
  'control.impersonation.revoke.global',
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
      'control.iam.manage.tenant',
      'control.iam.audit.tenant',
      // Documents imprimables
      'data.ticket.print.agency',
      'data.manifest.print.agency',
      'data.parcel.print.agency',
      'data.invoice.print.agency',
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
      // Documents imprimables
      'data.ticket.print.agency',
      'data.manifest.print.agency',
      'data.parcel.print.agency',
      'data.invoice.print.agency',
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
      // Documents imprimables
      'data.ticket.print.agency',
      'data.parcel.print.agency',
      'data.invoice.print.agency',
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
      'data.manifest.print.agency',
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
      'data.manifest.print.agency',
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
// Helpers internes
// ─────────────────────────────────────────────────────────────────────────────

async function upsertPlatformRole(
  name:        string,
  permissions: string[],
): Promise<void> {
  const role = await prisma.role.upsert({
    where:  { tenantId_name: { tenantId: PLATFORM_TENANT_ID, name } },
    update: {},
    create: {
      tenantId: PLATFORM_TENANT_ID,
      name,
      isSystem: true,
    },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where:  { roleId_permission: { roleId: role.id, permission } },
      update: {},
      create: { roleId: role.id, permission },
    });
  }

  console.log(`[IAM Seed] Platform role "${name}" upserted (id=${role.id}, perms=${permissions.length})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Platform (run ONCE at first startup)
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapPlatform(): Promise<void> {
  // Crée le tenant plateforme avec l'UUID nil canonique
  await prisma.tenant.upsert({
    where:  { id: PLATFORM_TENANT_ID },
    update: {},
    create: {
      id:              PLATFORM_TENANT_ID,
      name:            'TranslogPro Platform',
      slug:            '__platform__',
      provisionStatus: 'ACTIVE',
    },
  });

  console.log(`[IAM Seed] Platform tenant ready (id=${PLATFORM_TENANT_ID})`);

  // Rôles système — ordre intentionnel : SA d'abord pour référence
  await upsertPlatformRole('SUPER_ADMIN', SUPER_ADMIN_PERMISSIONS);
  await upsertPlatformRole('SUPPORT_L1',  SUPPORT_L1_PERMISSIONS);
  await upsertPlatformRole('SUPPORT_L2',  SUPPORT_L2_PERMISSIONS);

  console.log('[IAM Seed] Platform bootstrap complete — SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2 ready');
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Tenant Seeding (appelé par OnboardingService — JAMAIS de rôles plateforme ici)
// ─────────────────────────────────────────────────────────────────────────────

export async function seedTenantRoles(
  prismaClient: PrismaClient,
  tenantId:     string,
): Promise<Map<string, string>> {
  // Garde critique : empêche toute création de rôle dans le tenant plateforme
  if (tenantId === PLATFORM_TENANT_ID) {
    throw new Error(
      '[IAM Seed] SECURITY VIOLATION: seedTenantRoles() appelé avec PLATFORM_TENANT_ID. ' +
      'Les rôles plateforme sont créés UNIQUEMENT par bootstrapPlatform().',
    );
  }

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
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
