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
      'data.fleet.tracking.tenant',
      'data.fleet.tracking_create.agency',
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
      'data.staff.read.tenant',
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
      // Templates de documents
      'data.template.read.agency',
      'data.template.write.agency',
      'data.template.delete.agency',
      // Agences (CRUD — invariant ≥1 agence par tenant)
      'control.agency.manage.tenant',
      'data.agency.read.tenant',
      // Stations (CRUD gares routières)
      'control.station.manage.tenant',
      'data.station.read.tenant',
      // Driver & HR
      'control.driver.manage.tenant',
      'data.driver.profile.agency',
      // QHSE & Accidents
      'control.qhse.manage.tenant',
      'data.accident.report.own',
      // Workflow Studio & Marketplace
      'control.workflow.studio.read.tenant',
      'control.workflow.studio.write.tenant',
      'control.workflow.marketplace.read.tenant',
      'control.workflow.marketplace.publish.tenant',
      'control.workflow.blueprint.import.tenant',
      'control.workflow.simulate.tenant',
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
      'data.trip.update.agency',       // départ, arrivée
      'data.trip.check.own',
      'data.trip.report.own',
      'control.trip.log_event.own',    // plan de perm aligné sur constants + state graph
      'control.trip.delay.agency',
      'data.ticket.scan.agency',
      'data.traveler.verify.agency',
      'data.manifest.read.own',
      'data.sav.report.own',
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.manifest.print.agency',
      'data.driver.rest.own',          // périodes de repos (start/end)
      'data.driver.profile.agency',   // briefing équipements, profil chauffeur
      'data.fleet.status.agency',     // lire la liste des bus (manifeste, panne)
      'data.ticket.read.agency',      // liste passagers du trajet
      'data.maintenance.update.own',   // signalement de panne depuis le terrain
      'data.feedback.submit.own',      // retours voyageur post-trajet
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
    // CUSTOMER — profil client unifié (voyageur + expéditeur).
    // Scope .own : borne chaque action à la ressource possédée (no cross-tenant leak).
    // Pas de rôle séparé VOYAGEUR/SHIPPER : la segmentation pour les stats se
    // fait par activité (has_ticket, has_parcel), pas par rôle.
    name:     'CUSTOMER',
    isSystem: true,
    permissions: [
      'data.feedback.submit.own',
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.sav.report.own',
      // Voyageur : lecture de ses propres billets (QR, statut)
      'data.ticket.read.own',
      // Expéditeur : suivi et lecture de ses propres colis + shipments
      'data.parcel.read.own',
      'data.parcel.track.own',
      'data.shipment.read.own',
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

// ─────────────────────────────────────────────────────────────────────────────
// Agence par défaut (INVARIANT : tout tenant possède ≥1 agence)
//
// Office 365 pattern : à la création d'un tenant, une "agence principale" est
// provisionnée pour que l'admin dispose immédiatement d'un agencyId valide
// (sans quoi toute permission en scope `.agency` retournerait 403 via
// PermissionGuard). L'admin peut la renommer / ajouter d'autres agences
// ensuite, mais AgencyService.remove() refuse la suppression de la dernière.
// ─────────────────────────────────────────────────────────────────────────────

export type TenantLanguage = 'fr' | 'en';

/**
 * Nom par défaut de l'agence créée lors de l'onboarding.
 * Le nom du tenant plateforme est "Main" (anglais), unique et immuable.
 */
export const DEFAULT_AGENCY_NAME: Record<TenantLanguage, string> = {
  fr: 'Agence principale',
  en: 'Main Agency',
};

/** Anciens noms — conservés pour rename migration des tenants existants. */
const LEGACY_DEFAULT_AGENCY_NAMES = ['Siège', 'Headquarters'];

export const PLATFORM_AGENCY_NAME = 'Main';

type AgencyCapable = {
  agency: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create:    (args: unknown) => Promise<{ id: string }>;
  };
};

/**
 * Idempotent — crée l'agence par défaut si absente.
 * Retourne l'id de l'agence (existante ou nouvellement créée).
 *
 * Contrat d'unicité : UNE agence par tenant portant exactement ce nom par
 * défaut. Si l'admin renomme "Siège" en "Paris", un second appel créera
 * une nouvelle "Siège" — c'est voulu : l'invariant est "≥1 agence", pas
 * "une agence nommée Siège".
 */
export async function ensureDefaultAgency(
  client:   AgencyCapable,
  tenantId: string,
  name:     string,
): Promise<string> {
  const existing = await client.agency.findFirst({
    where: { tenantId, name },
  } as unknown as Record<string, unknown>);
  if (existing) return existing.id;

  const created = await client.agency.create({
    data: { tenantId, name },
  } as unknown as Record<string, unknown>);
  return created.id;
}

/**
 * Backfill pour tenants existants créés AVANT l'introduction de l'invariant
 * "≥1 agence". Pour chaque tenant sans agence : créer l'agence par défaut et
 * y rattacher les users STAFF orphelins (agencyId IS NULL).
 *
 * Appel idempotent — skip tenants qui ont déjà au moins une agence.
 * Les users CUSTOMER restent sans agence (ils n'en ont pas besoin).
 */
/**
 * Backfill Phase 5 cleanup : convertit tout user avec userType='DRIVER'
 * (zombie legacy) en userType='STAFF'. À rejouer sur toute DB pré-existante
 * au merge de la refonte Staff/StaffAssignment pour nettoyer les données
 * orphelines. Idempotent.
 */
export async function backfillDriverUserTypeZombie(
  prismaClient: PrismaClient,
): Promise<{ fixed: number }> {
  const res = await prismaClient.user.updateMany({
    where: { userType: 'DRIVER' },
    data:  { userType: 'STAFF' },
  });
  return { fixed: res.count };
}

export async function backfillDefaultAgencies(
  prismaClient: PrismaClient,
  language:     TenantLanguage = 'fr',
): Promise<{ scanned: number; agenciesCreated: number; agenciesRenamed: number; usersAssigned: number }> {
  const tenants = await prismaClient.tenant.findMany({
    select: { id: true, slug: true },
  });

  let agenciesCreated = 0;
  let agenciesRenamed = 0;
  let usersAssigned   = 0;

  for (const tenant of tenants) {
    const isPlatform  = tenant.id === PLATFORM_TENANT_ID;
    const defaultName = isPlatform ? PLATFORM_AGENCY_NAME : DEFAULT_AGENCY_NAME[language];

    const agencies = await prismaClient.agency.findMany({
      where:  { tenantId: tenant.id },
      select: { id: true, name: true },
    });

    // Rename legacy default ("Siège"/"Headquarters") → nouveau nom si mono-agence.
    if (
      !isPlatform &&
      agencies.length === 1 &&
      LEGACY_DEFAULT_AGENCY_NAMES.includes(agencies[0].name)
    ) {
      await prismaClient.agency.update({
        where: { id: agencies[0].id },
        data:  { name: defaultName },
      });
      agenciesRenamed++;
      console.log(
        `[IAM Seed] Rename agence "${agencies[0].name}" → "${defaultName}" tenant=${tenant.slug}`,
      );
    }

    // Créer l'agence par défaut si aucune agence.
    let defaultAgencyId: string;
    if (agencies.length === 0) {
      const agency = await prismaClient.agency.create({
        data: { tenantId: tenant.id, name: defaultName },
      });
      agenciesCreated++;
      defaultAgencyId = agency.id;
      console.log(`[IAM Seed] Backfill agence "${defaultName}" (id=${agency.id}) tenant=${tenant.slug}`);
    } else {
      // Prend l'agence existante correspondant au nom par défaut, sinon la première.
      defaultAgencyId =
        agencies.find(a => a.name === defaultName)?.id ??
        agencies[0].id;
    }

    // Rattache tous les users orphelins (STAFF + DRIVER). CUSTOMER/PUBLIC_REPORTER
    // restent sans agence — ils n'appartiennent à aucune agence opérationnelle.
    const res = await prismaClient.user.updateMany({
      where: {
        tenantId: tenant.id,
        agencyId: null,
        userType: 'STAFF',
      },
      data: { agencyId: defaultAgencyId },
    });
    usersAssigned += res.count;
    if (res.count > 0) {
      console.log(`[IAM Seed] Rattachement tenant=${tenant.slug} — ${res.count} user(s) STAFF/DRIVER`);
    }
  }

  return { scanned: tenants.length, agenciesCreated, agenciesRenamed, usersAssigned };
}

// ─── Workflow backfill ────────────────────────────────────────────────────────
// Seed les WorkflowConfig par défaut pour tous les tenants existants (ceux qui
// ont été onboardés avant l'introduction de ce seed). Idempotent via
// `skipDuplicates` sur la contrainte unique (tenantId, entityType, fromState,
// action, version).
export const DEFAULT_WORKFLOW_CONFIGS = [
  // Trip — ACTIVATE (PLANNED→PLANNED) retiré : self-loop no-op qui piégeait
  // la détection d'état initial basée sur la topologie.
  { entityType: 'Trip', fromState: 'PLANNED',              action: 'START_BOARDING',   toState: 'OPEN',               requiredPerm: 'data.trip.update.agency' },
  { entityType: 'Trip', fromState: 'OPEN',                 action: 'BEGIN_BOARDING',   toState: 'BOARDING',           requiredPerm: 'data.trip.update.agency' },
  { entityType: 'Trip', fromState: 'BOARDING',             action: 'DEPART',           toState: 'IN_PROGRESS',        requiredPerm: 'data.trip.update.agency' },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',          action: 'PAUSE',            toState: 'IN_PROGRESS_PAUSED', requiredPerm: 'data.trip.report.own'    },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_PAUSED',   action: 'RESUME',           toState: 'IN_PROGRESS',        requiredPerm: 'data.trip.report.own'    },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',          action: 'REPORT_INCIDENT',  toState: 'IN_PROGRESS_DELAYED',requiredPerm: 'data.trip.report.own'    },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_DELAYED',  action: 'CLEAR_INCIDENT',   toState: 'IN_PROGRESS',        requiredPerm: 'data.trip.report.own'    },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',          action: 'END_TRIP',         toState: 'COMPLETED',          requiredPerm: 'data.trip.update.agency' },
  { entityType: 'Trip', fromState: 'PLANNED',              action: 'CANCEL',           toState: 'CANCELLED',          requiredPerm: 'data.trip.update.agency' },
  // Ticket
  { entityType: 'Ticket', fromState: 'CREATED',         action: 'RESERVE',   toState: 'PENDING_PAYMENT', requiredPerm: 'data.ticket.create.agency' },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'PAY',       toState: 'CONFIRMED',       requiredPerm: 'data.ticket.create.agency' },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'EXPIRE',    toState: 'EXPIRED',         requiredPerm: 'data.ticket.create.agency' },
  { entityType: 'Ticket', fromState: 'CONFIRMED',       action: 'CHECK_IN',  toState: 'CHECKED_IN',      requiredPerm: 'data.ticket.scan.agency'   },
  { entityType: 'Ticket', fromState: 'CHECKED_IN',      action: 'BOARD',     toState: 'BOARDED',         requiredPerm: 'data.ticket.scan.agency'   },
  { entityType: 'Ticket', fromState: 'CONFIRMED',       action: 'CANCEL',    toState: 'CANCELLED',       requiredPerm: 'data.ticket.cancel.agency' },
  // Parcel — PRD §III.7 (8 états métier)
  { entityType: 'Parcel', fromState: 'CREATED',    action: 'RECEIVE',         toState: 'AT_ORIGIN',  requiredPerm: 'data.parcel.scan.agency'   },
  { entityType: 'Parcel', fromState: 'AT_ORIGIN',  action: 'ADD_TO_SHIPMENT', toState: 'PACKED',     requiredPerm: 'data.shipment.group.agency' },
  { entityType: 'Parcel', fromState: 'PACKED',     action: 'LOAD',            toState: 'LOADED',     requiredPerm: 'data.parcel.update.agency' },
  { entityType: 'Parcel', fromState: 'LOADED',     action: 'DEPART',          toState: 'IN_TRANSIT', requiredPerm: 'data.parcel.update.agency' },
  { entityType: 'Parcel', fromState: 'IN_TRANSIT', action: 'ARRIVE',          toState: 'ARRIVED',    requiredPerm: 'data.parcel.scan.agency'   },
  { entityType: 'Parcel', fromState: 'ARRIVED',    action: 'DELIVER',         toState: 'DELIVERED',  requiredPerm: 'data.parcel.update.agency' },
  { entityType: 'Parcel', fromState: 'IN_TRANSIT', action: 'DAMAGE',          toState: 'DAMAGED',    requiredPerm: 'data.parcel.report.agency' },
  { entityType: 'Parcel', fromState: 'IN_TRANSIT', action: 'DECLARE_LOST',    toState: 'LOST',       requiredPerm: 'data.parcel.report.agency' },
  { entityType: 'Parcel', fromState: 'ARRIVED',    action: 'RETURN',          toState: 'RETURNED',   requiredPerm: 'data.parcel.update.tenant' },
  // Traveler — PRD §III.7 (cycle passager sur un trajet, distinct du rôle CUSTOMER)
  { entityType: 'Traveler', fromState: 'REGISTERED', action: 'VERIFY',     toState: 'VERIFIED',   requiredPerm: 'data.traveler.verify.agency' },
  { entityType: 'Traveler', fromState: 'VERIFIED',   action: 'SCAN_IN',    toState: 'CHECKED_IN', requiredPerm: 'data.ticket.scan.agency'     },
  { entityType: 'Traveler', fromState: 'CHECKED_IN', action: 'SCAN_BOARD', toState: 'BOARDED',    requiredPerm: 'data.traveler.verify.agency' },
  { entityType: 'Traveler', fromState: 'BOARDED',    action: 'SCAN_OUT',   toState: 'ARRIVED',    requiredPerm: 'data.traveler.verify.agency' },
  { entityType: 'Traveler', fromState: 'ARRIVED',    action: 'EXIT',       toState: 'EXITED',     requiredPerm: 'data.traveler.verify.agency' },
  // Bus — PRD §III.7 (état opérationnel véhicule)
  { entityType: 'Bus', fromState: 'AVAILABLE',   action: 'OPEN_BOARDING',       toState: 'BOARDING',    requiredPerm: 'data.trip.update.agency'        },
  { entityType: 'Bus', fromState: 'IDLE',        action: 'OPEN_BOARDING',       toState: 'BOARDING',    requiredPerm: 'data.trip.update.agency'        },
  { entityType: 'Bus', fromState: 'BOARDING',    action: 'DEPART',              toState: 'DEPARTED',    requiredPerm: 'data.trip.update.agency'        },
  { entityType: 'Bus', fromState: 'DEPARTED',    action: 'ARRIVE',              toState: 'ARRIVED',     requiredPerm: 'data.trip.update.agency'        },
  { entityType: 'Bus', fromState: 'ARRIVED',     action: 'CLEAN',               toState: 'CLOSED',      requiredPerm: 'data.trip.update.agency'        },
  { entityType: 'Bus', fromState: 'CLOSED',      action: 'RESTORE',             toState: 'AVAILABLE',   requiredPerm: 'data.fleet.status.agency'       },
  { entityType: 'Bus', fromState: 'AVAILABLE',   action: 'INCIDENT_MECHANICAL', toState: 'MAINTENANCE', requiredPerm: 'data.maintenance.update.own'    },
  { entityType: 'Bus', fromState: 'BOARDING',    action: 'INCIDENT_MECHANICAL', toState: 'MAINTENANCE', requiredPerm: 'data.maintenance.update.own'    },
  { entityType: 'Bus', fromState: 'DEPARTED',    action: 'INCIDENT_MECHANICAL', toState: 'MAINTENANCE', requiredPerm: 'data.maintenance.update.own'    },
  { entityType: 'Bus', fromState: 'MAINTENANCE', action: 'RESTORE',             toState: 'AVAILABLE',   requiredPerm: 'data.maintenance.approve.tenant' },
  // Shipment — groupage colis
  { entityType: 'Shipment', fromState: 'OPEN',       action: 'LOAD',    toState: 'LOADED',     requiredPerm: 'data.shipment.group.agency' },
  { entityType: 'Shipment', fromState: 'LOADED',    action: 'DEPART',  toState: 'IN_TRANSIT', requiredPerm: 'data.trip.update.agency'    },
  { entityType: 'Shipment', fromState: 'IN_TRANSIT',action: 'ARRIVE',  toState: 'ARRIVED',    requiredPerm: 'data.trip.update.agency'    },
  { entityType: 'Shipment', fromState: 'ARRIVED',   action: 'CLOSE',   toState: 'CLOSED',     requiredPerm: 'data.shipment.group.agency' },

  // ─── Entités blueprint-first ─────────────────────────────────────────────
  // Ces workflows n'étaient jusque-là présents que dans le marketplace
  // (blueprints système). Les exposer en WorkflowConfig runtime les rend
  // simulables dans PageWfSimulate et modifiables dans le Designer.
  // Les labels d'action suivent snake_case (aligné avec les edge.label des
  // blueprints) — c'est volontaire, la cohérence avec le blueprint importe
  // plus que l'uniformité avec Trip/Ticket (UPPERCASE historique).

  // Maintenance — cycle intervention mécanicien (blueprint maintenance-ticket)
  { entityType: 'Maintenance', fromState: 'OPEN',          action: 'assign',        toState: 'ASSIGNED',     requiredPerm: 'data.maintenance.approve.tenant' },
  { entityType: 'Maintenance', fromState: 'ASSIGNED',      action: 'start_work',    toState: 'IN_PROGRESS',  requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Maintenance', fromState: 'ASSIGNED',      action: 'cancel',        toState: 'CANCELLED',    requiredPerm: 'data.maintenance.approve.tenant' },
  { entityType: 'Maintenance', fromState: 'IN_PROGRESS',   action: 'wait_parts',    toState: 'PENDING_PARTS',requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Maintenance', fromState: 'IN_PROGRESS',   action: 'complete',      toState: 'DONE',         requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Maintenance', fromState: 'PENDING_PARTS', action: 'parts_arrived', toState: 'IN_PROGRESS',  requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Maintenance', fromState: 'DONE',          action: 'validate',      toState: 'VALIDATED',    requiredPerm: 'data.maintenance.approve.tenant' },
  { entityType: 'Maintenance', fromState: 'DONE',          action: 'reopen',        toState: 'IN_PROGRESS',  requiredPerm: 'data.maintenance.approve.tenant' },

  // Claim — SAV réclamation (blueprint claim-sav)
  { entityType: 'Claim', fromState: 'OPEN',          action: 'assign',      toState: 'ASSIGNED',      requiredPerm: 'data.sav.report.agency'   },
  { entityType: 'Claim', fromState: 'ASSIGNED',      action: 'investigate', toState: 'INVESTIGATING', requiredPerm: 'data.sav.deliver.agency'  },
  { entityType: 'Claim', fromState: 'INVESTIGATING', action: 'resolve',     toState: 'RESOLVED',      requiredPerm: 'data.sav.claim.tenant'    },
  { entityType: 'Claim', fromState: 'INVESTIGATING', action: 'reject',      toState: 'REJECTED',      requiredPerm: 'data.sav.claim.tenant'    },
  { entityType: 'Claim', fromState: 'INVESTIGATING', action: 'escalate',    toState: 'ESCALATED',     requiredPerm: 'data.sav.claim.tenant'    },
  { entityType: 'Claim', fromState: 'ESCALATED',     action: 'resolve',     toState: 'RESOLVED',      requiredPerm: 'data.sav.claim.tenant'    },
  { entityType: 'Claim', fromState: 'ESCALATED',     action: 'reject',      toState: 'REJECTED',      requiredPerm: 'data.sav.claim.tenant'    },

  // Manifest — signature & archivage (blueprint manifest-standard)
  { entityType: 'Manifest', fromState: 'DRAFT',     action: 'submit',   toState: 'SUBMITTED', requiredPerm: 'data.manifest.generate.agency' },
  { entityType: 'Manifest', fromState: 'SUBMITTED', action: 'sign',     toState: 'SIGNED',    requiredPerm: 'data.manifest.sign.agency'     },
  { entityType: 'Manifest', fromState: 'SUBMITTED', action: 'reject',   toState: 'REJECTED',  requiredPerm: 'data.manifest.sign.agency'     },
  { entityType: 'Manifest', fromState: 'SIGNED',    action: 'archive',  toState: 'ARCHIVED',  requiredPerm: 'data.manifest.print.agency'    },
  { entityType: 'Manifest', fromState: 'REJECTED',  action: 'revise',   toState: 'DRAFT',     requiredPerm: 'data.manifest.generate.agency' },

  // Checklist — pré-départ (blueprint checklist-departure)
  { entityType: 'Checklist', fromState: 'PENDING',      action: 'start_tech',    toState: 'TECH_CHECK',   requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Checklist', fromState: 'TECH_CHECK',   action: 'pass_tech',     toState: 'SAFETY_CHECK', requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Checklist', fromState: 'TECH_CHECK',   action: 'fail_tech',     toState: 'BLOCKED',      requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'Checklist', fromState: 'SAFETY_CHECK', action: 'pass_safety',   toState: 'DOCS_CHECK',   requiredPerm: 'data.trip.update.agency'         },
  { entityType: 'Checklist', fromState: 'SAFETY_CHECK', action: 'fail_safety',   toState: 'BLOCKED',      requiredPerm: 'data.trip.update.agency'         },
  { entityType: 'Checklist', fromState: 'DOCS_CHECK',   action: 'approve_all',   toState: 'APPROVED',     requiredPerm: 'data.manifest.sign.agency'       },
  { entityType: 'Checklist', fromState: 'DOCS_CHECK',   action: 'docs_missing',  toState: 'BLOCKED',      requiredPerm: 'data.manifest.sign.agency'       },
  { entityType: 'Checklist', fromState: 'BLOCKED',      action: 'fix_and_retry', toState: 'PENDING',      requiredPerm: 'data.maintenance.approve.tenant' },

  // Crew — affectation & briefing équipage (blueprint crew-assignment)
  { entityType: 'Crew', fromState: 'STANDBY',    action: 'assign_briefing', toState: 'BRIEFING',   requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Crew', fromState: 'BRIEFING',   action: 'start_duty',      toState: 'ON_DUTY',    requiredPerm: 'data.trip.update.agency'      },
  { entityType: 'Crew', fromState: 'BRIEFING',   action: 'cancel',          toState: 'STANDBY',    requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Crew', fromState: 'ON_DUTY',    action: 'end_duty',        toState: 'DEBRIEFING', requiredPerm: 'control.trip.log_event.own'   },
  { entityType: 'Crew', fromState: 'ON_DUTY',    action: 'emergency_off',   toState: 'SUSPENDED',  requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Crew', fromState: 'DEBRIEFING', action: 'start_rest',      toState: 'REST',       requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'Crew', fromState: 'REST',       action: 'rest_complete',   toState: 'STANDBY',    requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'Crew', fromState: 'SUSPENDED',  action: 'reinstate',       toState: 'STANDBY',    requiredPerm: 'control.driver.manage.tenant' },

  // Driver — disponibilité & repos (blueprint driver-availability)
  { entityType: 'Driver', fromState: 'AVAILABLE',     action: 'assign',        toState: 'ASSIGNED',      requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Driver', fromState: 'ASSIGNED',      action: 'start_duty',    toState: 'ON_DUTY',       requiredPerm: 'data.trip.update.agency'      },
  { entityType: 'Driver', fromState: 'ASSIGNED',      action: 'unassign',      toState: 'AVAILABLE',     requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Driver', fromState: 'ON_DUTY',       action: 'end_shift',     toState: 'REST_REQUIRED', requiredPerm: 'control.trip.log_event.own'   },
  { entityType: 'Driver', fromState: 'ON_DUTY',       action: 'emergency_off', toState: 'SUSPENDED',     requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Driver', fromState: 'REST_REQUIRED', action: 'start_rest',    toState: 'RESTING',       requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'Driver', fromState: 'RESTING',       action: 'rest_complete', toState: 'AVAILABLE',     requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'Driver', fromState: 'SUSPENDED',     action: 'reinstate',     toState: 'AVAILABLE',     requiredPerm: 'control.driver.manage.tenant' },
];

// ─── Types de documents véhicule par défaut ──────────────────────────────────
// Seedés à l'onboarding (étape 5.ter) et backfillables pour les tenants existants.
// code = clé technique libre, name = label affiché, alertDaysBeforeExpiry = alerte J-N.
export const DEFAULT_VEHICLE_DOCUMENT_TYPES = [
  { code: 'INSURANCE',          name: 'Assurance RC',            alertDaysBeforeExpiry: 30,  isMandatory: true  },
  { code: 'REGISTRATION',       name: 'Carte grise',             alertDaysBeforeExpiry: 60,  isMandatory: true  },
  { code: 'TECHNICAL_CONTROL',  name: 'Contrôle technique',      alertDaysBeforeExpiry: 30,  isMandatory: true  },
  { code: 'ROAD_TAX',           name: 'Vignette / Taxe routière',alertDaysBeforeExpiry: 30,  isMandatory: true  },
  { code: 'TRANSPORT_LICENSE',  name: 'Licence de transport',    alertDaysBeforeExpiry: 60,  isMandatory: true  },
  { code: 'FIRE_EXTINGUISHER',  name: 'Extincteur',              alertDaysBeforeExpiry: 30,  isMandatory: false },
  { code: 'FIRST_AID_KIT',     name: 'Trousse de secours',      alertDaysBeforeExpiry: 90,  isMandatory: false },
];

/**
 * Seed les types de documents véhicule par défaut pour un tenant.
 * Idempotent via skipDuplicates sur la contrainte unique (tenantId, code).
 */
export async function seedDefaultVehicleDocumentTypes(
  tx: PrismaClient | any,
  tenantId: string,
): Promise<number> {
  const res = await tx.vehicleDocumentType.createMany({
    data: DEFAULT_VEHICLE_DOCUMENT_TYPES.map(dt => ({
      ...dt, tenantId, isActive: true,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * Backfill : ajoute les types de documents véhicule pour tous les tenants existants.
 */
export async function backfillVehicleDocumentTypes(
  prismaClient: PrismaClient,
): Promise<{ scanned: number; rowsCreated: number }> {
  const tenants = await prismaClient.tenant.findMany({ select: { id: true, slug: true } });
  let rowsCreated = 0;

  for (const tenant of tenants) {
    if (tenant.id === PLATFORM_TENANT_ID) continue;
    const count = await seedDefaultVehicleDocumentTypes(prismaClient, tenant.id);
    if (count > 0) {
      console.log(`[IAM Seed] Backfill vehicleDocumentTypes tenant=${tenant.slug} — ${count} type(s) créé(s)`);
    }
    rowsCreated += count;
  }

  return { scanned: tenants.length, rowsCreated };
}

export async function backfillDefaultWorkflows(
  prismaClient: PrismaClient,
): Promise<{ scanned: number; rowsCreated: number }> {
  const tenants = await prismaClient.tenant.findMany({ select: { id: true, slug: true } });
  let rowsCreated = 0;

  for (const tenant of tenants) {
    if (tenant.id === PLATFORM_TENANT_ID) continue; // pas de workflows métier sur plateforme

    const res = await prismaClient.workflowConfig.createMany({
      data: DEFAULT_WORKFLOW_CONFIGS.map(c => ({
        ...c,
        tenantId:    tenant.id,
        guards:      [],
        sideEffects: [],
        isActive:    true,
        version:     1,
      })),
      skipDuplicates: true,
    });
    if (res.count > 0) {
      console.log(`[IAM Seed] Backfill workflows tenant=${tenant.slug} — ${res.count} transition(s) créée(s)`);
    }
    rowsCreated += res.count;
  }

  return { scanned: tenants.length, rowsCreated };
}

// ─── Blueprint auto-install ───────────────────────────────────────────────────
// Les blueprints système (isSystem=true, authorTenantId=null) existent comme
// modèles dans le marketplace. Pour qu'un tenant les voie comme "installés"
// (UI marketplace + scénarios PageWfSimulate), il faut un record
// BlueprintInstall par (tenantId, blueprintId). Les WorkflowConfig sont déjà
// seedées séparément via DEFAULT_WORKFLOW_CONFIGS — cet enregistrement est
// déclaratif, il ne réécrit PAS les configs existantes.
//
// Contrat : idempotent via upsert (tenantId_blueprintId). Rejouable.

/**
 * Crée les BlueprintInstall pour tous les blueprints système manquants sur
 * un tenant. Retourne le nombre de lignes touchées.
 */
export async function installSystemBlueprintsForTenant(
  prismaClient: PrismaClient,
  tenantId:     string,
): Promise<number> {
  const systemBlueprints = await prismaClient.workflowBlueprint.findMany({
    where:  { isSystem: true, authorTenantId: null },
    select: { id: true, graphJson: true },
  });

  let touched = 0;
  for (const bp of systemBlueprints) {
    await prismaClient.blueprintInstall.upsert({
      where:  { tenantId_blueprintId: { tenantId, blueprintId: bp.id } },
      create: {
        tenantId,
        blueprintId:  bp.id,
        snapshotJson: bp.graphJson as object,
        isDirty:      false,
        installedBy:  'system',
      },
      update: {}, // no-op si déjà installé — préserve installedAt/installedBy
    });
    touched++;
  }
  return touched;
}

/**
 * Backfill pour tenants existants — itère tous les tenants (sauf plateforme)
 * et garantit que chaque blueprint système a son record BlueprintInstall.
 */
export async function backfillSystemBlueprintInstalls(
  prismaClient: PrismaClient,
): Promise<{ scanned: number; tenantsTouched: number }> {
  const tenants = await prismaClient.tenant.findMany({ select: { id: true, slug: true } });
  let tenantsTouched = 0;

  for (const tenant of tenants) {
    if (tenant.id === PLATFORM_TENANT_ID) continue;
    const n = await installSystemBlueprintsForTenant(prismaClient, tenant.id);
    if (n > 0) {
      tenantsTouched++;
      console.log(`[IAM Seed] Blueprints système tenant=${tenant.slug} — ${n} ligne(s) upsertée(s)`);
    }
  }

  return { scanned: tenants.length, tenantsTouched };
}

/**
 * Backfill des permissions de rôles pour les tenants existants.
 *
 * Chaque fois qu'une permission est ajoutée à `TENANT_ROLES`, relancer
 * `npx ts-node prisma/seeds/iam.seed.ts` propage la nouvelle permission
 * à tous les tenants déjà onboardés (upserts idempotents côté Role /
 * RolePermission).
 */
export async function backfillTenantRolePermissions(
  prismaClient: PrismaClient,
): Promise<{ scanned: number; rowsCreated: number }> {
  const tenants = await prismaClient.tenant.findMany({
    where:  { id: { not: PLATFORM_TENANT_ID } },
    select: { id: true, slug: true },
  });

  let rowsCreated = 0;
  for (const tenant of tenants) {
    const beforePerms = await prismaClient.rolePermission.count({
      where: { role: { tenantId: tenant.id } },
    });
    await seedTenantRoles(prismaClient, tenant.id);
    const afterPerms = await prismaClient.rolePermission.count({
      where: { role: { tenantId: tenant.id } },
    });
    const delta = afterPerms - beforePerms;
    if (delta > 0) {
      console.log(`[IAM Seed] Backfill permissions tenant=${tenant.slug} — ${delta} ligne(s) créée(s)`);
    }
    rowsCreated += delta;
  }

  return { scanned: tenants.length, rowsCreated };
}

// ─── Standalone runner ────────────────────────────────────────────────────────
async function main() {
  await bootstrapPlatform();

  // Garantit l'agence "Main" du tenant plateforme + corrige les tenants
  // onboardés avant l'introduction de l'invariant.
  const report = await backfillDefaultAgencies(prisma);
  console.log(
    `[IAM Seed] Backfill agences — ${report.scanned} tenants scannés, ` +
    `${report.agenciesCreated} créée(s), ${report.agenciesRenamed} renommée(s), ` +
    `${report.usersAssigned} user(s) rattaché(s)`,
  );

  const wfReport = await backfillDefaultWorkflows(prisma);
  console.log(
    `[IAM Seed] Backfill workflows — ${wfReport.scanned} tenants scannés, ` +
    `${wfReport.rowsCreated} transition(s) créée(s)`,
  );

  // Backfill permissions de rôles — propage les nouvelles permissions du seed
  // (ex. control.station.manage.tenant) aux tenants déjà onboardés.
  const permReport = await backfillTenantRolePermissions(prisma);
  console.log(
    `[IAM Seed] Backfill permissions rôles — ${permReport.scanned} tenants scannés, ` +
    `${permReport.rowsCreated} ligne(s) créée(s)`,
  );

  // Backfill blueprints système — rend les blueprints "installés" pour
  // chaque tenant existant. Nécessaire pour que PageWfMarketplace montre
  // Trip/Bus/Parcel/... comme activables et que PageWfSimulate trouve
  // les scénarios associés. Idempotent.
  const bpReport = await backfillSystemBlueprintInstalls(prisma);
  console.log(
    `[IAM Seed] Backfill blueprints système — ${bpReport.scanned} tenants scannés, ` +
    `${bpReport.tenantsTouched} tenant(s) mis à jour`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
