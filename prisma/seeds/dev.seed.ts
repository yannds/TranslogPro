/**
 * Dev Seed — utilisateurs de test pour l'environnement de développement.
 *
 * Crée :
 *   Plateforme :
 *     superadmin@translogpro.io  / Admin1234!  → SUPER_ADMIN (tenant __platform__)
 *
 *   Tenant 1 (TransExpress) :
 *     admin@tenant1.dev    / Admin1234!  → TENANT_ADMIN
 *     driver@tenant1.dev   / Admin1234!  → DRIVER
 *
 *   Tenant 2 (CityBus) :
 *     admin@tenant2.dev  / Admin1234!  → TENANT_ADMIN
 *
 * Idempotent : peut être relancé sans dupliquer les données.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PLATFORM_TENANT_ID, seedTenantRoles } from './iam.seed';

const prisma = new PrismaClient();

const TENANT1_ID = '11111111-1111-1111-1111-111111111111';
const TENANT2_ID = '22222222-2222-2222-2222-222222222222';

const TENANTS = [
  { id: TENANT1_ID, name: 'TransExpress',  slug: 'trans-express',  adminEmail: 'admin@tenant1.dev' },
  { id: TENANT2_ID, name: 'CityBus Congo', slug: 'citybus-congo',   adminEmail: 'admin@tenant2.dev' },
];

async function hashPwd(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

async function upsertUserWithCredential(opts: {
  tenantId: string;
  email:    string;
  name:     string;
  roleId:   string | null;
  password: string;
  userType?: 'STAFF' | 'DRIVER';
}) {
  const { tenantId, email, name, roleId, password, userType = 'STAFF' } = opts;

  const user = await prisma.user.upsert({
    where:  { email },
    update: { name, roleId },
    create: { email, name, tenantId, roleId, userType },
  });

  const hash = await hashPwd(password);
  await prisma.account.upsert({
    where:  { providerId_accountId: { providerId: 'credential', accountId: email } },
    update: { password: hash },
    create: {
      userId:     user.id,
      providerId: 'credential',
      accountId:  email,
      password:   hash,
    },
  });

  return user;
}

/** Crée un profil Driver complet (Staff + license + rest config tenant). */
async function upsertDriverProfile(userId: string, tenantId: string) {
  // ── 1. Profil Staff DRIVER ──────────────────────────────────────────────────
  const profile = await prisma.staff.upsert({
    where:  { userId },
    update: { role: 'DRIVER', isAvailable: true },
    create: {
      userId,
      tenantId,
      role:        'DRIVER',
      status:      'ACTIVE',
      licenseData: {
        licenseNo:    'DL-CG-2021-00041',
        category:     'D',
        expiresAt:    '2027-03-10',
        issuingState: 'Congo',
      },
      isAvailable:         true,
      totalDriveTimeToday: 0,
    },
  });

  // ── 2. Permis de conduire (table dédiée) ────────────────────────────────────
  // staffId n'est pas unique → vérifier avant d'insérer
  const existingLicense = await prisma.driverLicense.findFirst({
    where: { staffId: profile.id },
  });
  if (!existingLicense) {
    await prisma.driverLicense.create({
      data: {
        staffId:      profile.id,
        tenantId,
        licenseNo:    'DL-CG-2021-00041',
        category:     'D',
        issuedAt:     new Date('2015-03-10'),
        expiresAt:    new Date('2027-03-10'),
        issuingState: 'Congo',
        status:       'VALID',
      },
    });
  }

  // ── 3. Config repos réglementaire (unique par tenant) ───────────────────────
  await prisma.driverRestConfig.upsert({
    where:  { tenantId },
    update: {},
    create: {
      tenantId,
      maxDrivingMinutesPerDay:  540,   // 9h
      minRestMinutes:           660,   // 11h
      maxDrivingMinutesPerWeek: 3360,  // 56h
      alertBeforeEndRestMin:    30,
    },
  });

  return profile;
}

/** Active tous les modules SaaS pour un tenant donné (dev only). */
async function activateAllModules(tenantId: string) {
  const MODULES = [
    'DRIVER_PROFILE', 'CREW_BRIEFING', 'FLEET_DOCS', 'QHSE',
    'WORKFLOW_STUDIO', 'WHITE_LABEL', 'PROFITABILITY',
    'CRM', 'SCHEDULING_GUARD',
  ];
  for (const moduleKey of MODULES) {
    await prisma.installedModule.upsert({
      where:  { tenantId_moduleKey: { tenantId, moduleKey } },
      update: { isActive: true },
      create: { tenantId, moduleKey, isActive: true },
    });
  }
  console.log(`[Dev Seed] ✅ ${MODULES.length} modules activés pour tenant ${tenantId}`);
}

// ─── Workflow seed helpers ─────────────────────────────────────────────────────

interface TransitionSeed {
  fromState:    string;
  action:       string;
  toState:      string;
  requiredPerm: string;
}

async function seedWorkflowConfig(tenantId: string, entityType: string, transitions: TransitionSeed[]) {
  for (const t of transitions) {
    await prisma.workflowConfig.upsert({
      where: {
        tenantId_entityType_fromState_action_version: {
          tenantId, entityType, fromState: t.fromState, action: t.action, version: 1,
        },
      },
      update: { toState: t.toState, requiredPerm: t.requiredPerm, isActive: true },
      create: {
        tenantId, entityType,
        fromState:    t.fromState,
        action:       t.action,
        toState:      t.toState,
        requiredPerm: t.requiredPerm,
        guards:       [],
        sideEffects:  [],
        isActive:     true,
        version:      1,
      },
    });
  }
  console.log(`[Dev Seed] ✅ WorkflowConfig "${entityType}" (${transitions.length} transitions)`);
}

function graphChecksum(graph: {
  entityType: string;
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ id: string; source: string; target: string; label: string; permission: string; guards: string[]; sideEffects: string[] }>;
}): string {
  const payload = {
    entityType: graph.entityType,
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(n => ({ id: n.id, type: n.type })),
    edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)).map(e => ({
      id: e.id, source: e.source, target: e.target,
      label: e.label, permission: e.permission,
      guards: [...e.guards].sort(),
      sideEffects: [...e.sideEffects].sort(),
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function seedWorkflows(tenantId: string) {
  // ── Ticket ─────────────────────────────────────────────────────────────────
  await seedWorkflowConfig(tenantId, 'Ticket', [
    { fromState: 'DRAFT',     action: 'sell',      toState: 'SOLD',      requiredPerm: 'data.ticket.write.agency' },
    { fromState: 'SOLD',      action: 'validate',  toState: 'VALIDATED', requiredPerm: 'data.ticket.scan.agency'  },
    { fromState: 'VALIDATED', action: 'board',     toState: 'BOARDED',   requiredPerm: 'data.ticket.scan.agency'  },
    { fromState: 'BOARDED',   action: 'complete',  toState: 'USED',      requiredPerm: 'data.ticket.scan.agency'  },
    { fromState: 'SOLD',      action: 'cancel',    toState: 'CANCELLED', requiredPerm: 'data.ticket.write.agency' },
    { fromState: 'VALIDATED', action: 'cancel',    toState: 'CANCELLED', requiredPerm: 'data.ticket.write.agency' },
  ]);

  // ── Trip ───────────────────────────────────────────────────────────────────
  await seedWorkflowConfig(tenantId, 'Trip', [
    { fromState: 'PLANNED',    action: 'start_loading',    toState: 'LOADING',          requiredPerm: 'data.trip.write.agency' },
    { fromState: 'LOADING',    action: 'depart',           toState: 'DEPARTING',        requiredPerm: 'data.trip.write.agency' },
    { fromState: 'DEPARTING',  action: 'confirm_departure',toState: 'IN_TRANSIT',       requiredPerm: 'data.trip.write.agency' },
    { fromState: 'IN_TRANSIT', action: 'arrive',           toState: 'ARRIVED',          requiredPerm: 'data.trip.write.agency' },
    { fromState: 'ARRIVED',    action: 'complete',         toState: 'COMPLETED',        requiredPerm: 'data.trip.write.agency' },
    { fromState: 'PLANNED',    action: 'cancel',           toState: 'CANCELLED',        requiredPerm: 'data.trip.write.agency' },
    { fromState: 'DEPARTING',  action: 'report_incident',  toState: 'INCIDENT',         requiredPerm: 'data.trip.write.agency' },
    { fromState: 'INCIDENT',   action: 'resolve_incident', toState: 'IN_TRANSIT',       requiredPerm: 'data.trip.write.agency' },
  ]);

  // ── Parcel ─────────────────────────────────────────────────────────────────
  await seedWorkflowConfig(tenantId, 'Parcel', [
    { fromState: 'RECEIVED',         action: 'process',          toState: 'PROCESSING',       requiredPerm: 'data.parcel.write.agency' },
    { fromState: 'PROCESSING',       action: 'dispatch',         toState: 'IN_TRANSIT',       requiredPerm: 'data.parcel.write.agency' },
    { fromState: 'IN_TRANSIT',       action: 'out_for_delivery', toState: 'OUT_FOR_DELIVERY', requiredPerm: 'data.parcel.write.agency' },
    { fromState: 'OUT_FOR_DELIVERY', action: 'deliver',          toState: 'DELIVERED',        requiredPerm: 'data.parcel.write.agency' },
    { fromState: 'OUT_FOR_DELIVERY', action: 'return_parcel',    toState: 'RETURNED',         requiredPerm: 'data.parcel.write.agency' },
    { fromState: 'RETURNED',         action: 'reprocess',        toState: 'RECEIVED',         requiredPerm: 'data.parcel.write.agency' },
  ]);
}

async function seedBlueprintCategories(): Promise<Record<string, string>> {
  const CATEGORIES = [
    { name: 'Transport',    slug: 'transport',    icon: 'Bus',    sortOrder: 1 },
    { name: 'Logistique',   slug: 'logistics',    icon: 'Package',sortOrder: 2 },
    { name: 'Opérations',   slug: 'operations',   icon: 'Settings',sortOrder: 3 },
    { name: 'Support',      slug: 'support',      icon: 'Ticket', sortOrder: 4 },
    { name: 'Notification', slug: 'notification', icon: 'Bell',   sortOrder: 5 },
  ];
  const ids: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    const row = await prisma.blueprintCategory.upsert({
      where:  { slug: cat.slug },
      update: { name: cat.name, icon: cat.icon },
      create: cat,
    });
    ids[cat.slug] = row.id;
  }
  console.log(`[Dev Seed] ✅ ${CATEGORIES.length} catégories blueprints`);
  return ids;
}

async function seedSystemBlueprints(categoryIds: Record<string, string>) {
  const BLUEPRINTS = [
    {
      name:        'Billet Standard',
      slug:        'ticket-standard',
      description: 'Cycle de vie complet d\'un billet de transport : vente, validation, embarquement, utilisation.',
      entityType:  'Ticket',
      categoryId:  categoryIds['transport'],
      tags:        ['ticket', 'transport', 'standard'],
      graph: {
        entityType: 'Ticket',
        nodes: [
          { id: 'DRAFT',     label: 'Brouillon',  type: 'initial',  position: { x: 60,  y: 100 }, metadata: {} },
          { id: 'SOLD',      label: 'Vendu',      type: 'state',    position: { x: 280, y: 100 }, metadata: {} },
          { id: 'VALIDATED', label: 'Validé',     type: 'state',    position: { x: 500, y: 100 }, metadata: {} },
          { id: 'BOARDED',   label: 'Embarqué',   type: 'state',    position: { x: 720, y: 100 }, metadata: {} },
          { id: 'USED',      label: 'Utilisé',    type: 'terminal', position: { x: 940, y: 100 }, metadata: {} },
          { id: 'CANCELLED', label: 'Annulé',     type: 'terminal', position: { x: 390, y: 260 }, metadata: {} },
        ],
        edges: [
          { id: 'DRAFT___sell___SOLD',            source: 'DRAFT',     target: 'SOLD',      label: 'sell',     guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'SOLD___validate___VALIDATED',    source: 'SOLD',      target: 'VALIDATED', label: 'validate', guards: [], permission: 'data.ticket.scan.agency',  sideEffects: [], metadata: {} },
          { id: 'VALIDATED___board___BOARDED',    source: 'VALIDATED', target: 'BOARDED',   label: 'board',    guards: [], permission: 'data.ticket.scan.agency',  sideEffects: [], metadata: {} },
          { id: 'BOARDED___complete___USED',      source: 'BOARDED',   target: 'USED',      label: 'complete', guards: [], permission: 'data.ticket.scan.agency',  sideEffects: [], metadata: {} },
          { id: 'SOLD___cancel___CANCELLED',      source: 'SOLD',      target: 'CANCELLED', label: 'cancel',   guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'VALIDATED___cancel___CANCELLED', source: 'VALIDATED', target: 'CANCELLED', label: 'cancel',   guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
        ],
        version: '1.0.0', checksum: '', metadata: {},
      },
    },
    {
      name:        'Trajet Interurbain',
      slug:        'trip-interurban',
      description: 'Workflow de trajet avec gestion des incidents, chargement et arrivée.',
      entityType:  'Trip',
      categoryId:  categoryIds['transport'],
      tags:        ['trip', 'transport', 'incident'],
      graph: {
        entityType: 'Trip',
        nodes: [
          { id: 'PLANNED',    label: 'Planifié',    type: 'initial',  position: { x: 60,  y: 100 }, metadata: {} },
          { id: 'LOADING',    label: 'Chargement',  type: 'state',    position: { x: 240, y: 100 }, metadata: {} },
          { id: 'DEPARTING',  label: 'Départ',      type: 'state',    position: { x: 420, y: 100 }, metadata: {} },
          { id: 'IN_TRANSIT', label: 'En transit',  type: 'state',    position: { x: 600, y: 100 }, metadata: {} },
          { id: 'ARRIVED',    label: 'Arrivé',      type: 'state',    position: { x: 780, y: 100 }, metadata: {} },
          { id: 'COMPLETED',  label: 'Terminé',     type: 'terminal', position: { x: 960, y: 100 }, metadata: {} },
          { id: 'CANCELLED',  label: 'Annulé',      type: 'terminal', position: { x: 150, y: 260 }, metadata: {} },
          { id: 'INCIDENT',   label: 'Incident',    type: 'state',    position: { x: 510, y: 260 }, metadata: {} },
        ],
        edges: [
          { id: 'PLANNED___start_loading___LOADING',       source: 'PLANNED',    target: 'LOADING',    label: 'start_loading',    guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'LOADING___depart___DEPARTING',            source: 'LOADING',    target: 'DEPARTING',  label: 'depart',           guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'DEPARTING___confirm_departure___IN_TRANSIT',source:'DEPARTING', target: 'IN_TRANSIT', label: 'confirm_departure',guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'IN_TRANSIT___arrive___ARRIVED',           source: 'IN_TRANSIT', target: 'ARRIVED',    label: 'arrive',           guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'ARRIVED___complete___COMPLETED',          source: 'ARRIVED',    target: 'COMPLETED',  label: 'complete',         guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'PLANNED___cancel___CANCELLED',            source: 'PLANNED',    target: 'CANCELLED',  label: 'cancel',           guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'DEPARTING___report_incident___INCIDENT',  source: 'DEPARTING',  target: 'INCIDENT',   label: 'report_incident',  guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'INCIDENT___resolve_incident___IN_TRANSIT',source: 'INCIDENT',   target: 'IN_TRANSIT', label: 'resolve_incident', guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
        ],
        version: '1.0.0', checksum: '', metadata: {},
      },
    },
    {
      name:        'Suivi Colis Express',
      slug:        'parcel-express',
      description: 'Suivi de colis de la réception à la livraison avec gestion des retours.',
      entityType:  'Parcel',
      categoryId:  categoryIds['logistics'],
      tags:        ['parcel', 'logistics', 'express', 'delivery'],
      graph: {
        entityType: 'Parcel',
        nodes: [
          { id: 'RECEIVED',         label: 'Réceptionné',       type: 'initial',  position: { x: 60,  y: 100 }, metadata: {} },
          { id: 'PROCESSING',       label: 'Traitement',        type: 'state',    position: { x: 260, y: 100 }, metadata: {} },
          { id: 'IN_TRANSIT',       label: 'En transit',        type: 'state',    position: { x: 460, y: 100 }, metadata: {} },
          { id: 'OUT_FOR_DELIVERY', label: 'En livraison',      type: 'state',    position: { x: 660, y: 100 }, metadata: {} },
          { id: 'DELIVERED',        label: 'Livré',             type: 'terminal', position: { x: 860, y: 100 }, metadata: {} },
          { id: 'RETURNED',         label: 'Retourné',          type: 'state',    position: { x: 660, y: 260 }, metadata: {} },
        ],
        edges: [
          { id: 'RECEIVED___process___PROCESSING',              source: 'RECEIVED',         target: 'PROCESSING',       label: 'process',          guards: [], permission: 'data.parcel.write.agency', sideEffects: [], metadata: {} },
          { id: 'PROCESSING___dispatch___IN_TRANSIT',           source: 'PROCESSING',       target: 'IN_TRANSIT',       label: 'dispatch',         guards: [], permission: 'data.parcel.write.agency', sideEffects: [], metadata: {} },
          { id: 'IN_TRANSIT___out_for_delivery___OUT_FOR_DELIVERY',source:'IN_TRANSIT',     target: 'OUT_FOR_DELIVERY', label: 'out_for_delivery', guards: [], permission: 'data.parcel.write.agency', sideEffects: [], metadata: {} },
          { id: 'OUT_FOR_DELIVERY___deliver___DELIVERED',       source: 'OUT_FOR_DELIVERY', target: 'DELIVERED',        label: 'deliver',          guards: [], permission: 'data.parcel.write.agency', sideEffects: [], metadata: {} },
          { id: 'OUT_FOR_DELIVERY___return_parcel___RETURNED',  source: 'OUT_FOR_DELIVERY', target: 'RETURNED',         label: 'return_parcel',    guards: [], permission: 'data.parcel.write.agency', sideEffects: [], metadata: {} },
          { id: 'RETURNED___reprocess___RECEIVED',              source: 'RETURNED',         target: 'RECEIVED',         label: 'reprocess',        guards: [], permission: 'data.parcel.write.agency', sideEffects: [], metadata: {} },
        ],
        version: '1.0.0', checksum: '', metadata: {},
      },
    },
    {
      name:        'Gestion Réclamation Client',
      slug:        'claim-management',
      description: 'Workflow de traitement des réclamations clients : ouverture, investigation, résolution, clôture.',
      entityType:  'Ticket',
      categoryId:  categoryIds['support'],
      tags:        ['claim', 'support', 'crm', 'customer'],
      graph: {
        entityType: 'Ticket',
        nodes: [
          { id: 'OPEN',          label: 'Ouvert',        type: 'initial',  position: { x: 60,  y: 100 }, metadata: {} },
          { id: 'INVESTIGATING', label: 'Investigation',  type: 'state',    position: { x: 280, y: 100 }, metadata: {} },
          { id: 'PENDING_INFO',  label: 'Attente info',  type: 'state',    position: { x: 500, y: 100 }, metadata: {} },
          { id: 'RESOLVED',      label: 'Résolu',        type: 'state',    position: { x: 720, y: 100 }, metadata: {} },
          { id: 'CLOSED',        label: 'Clôturé',       type: 'terminal', position: { x: 940, y: 100 }, metadata: {} },
          { id: 'REJECTED',      label: 'Rejeté',        type: 'terminal', position: { x: 500, y: 260 }, metadata: {} },
        ],
        edges: [
          { id: 'OPEN___assign___INVESTIGATING',             source: 'OPEN',          target: 'INVESTIGATING', label: 'assign',       guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'INVESTIGATING___request_info___PENDING_INFO',source:'INVESTIGATING', target: 'PENDING_INFO',  label: 'request_info', guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'PENDING_INFO___provide_info___INVESTIGATING',source:'PENDING_INFO',  target: 'INVESTIGATING', label: 'provide_info', guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'INVESTIGATING___resolve___RESOLVED',        source: 'INVESTIGATING', target: 'RESOLVED',      label: 'resolve',      guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'RESOLVED___close___CLOSED',                 source: 'RESOLVED',      target: 'CLOSED',        label: 'close',        guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
          { id: 'INVESTIGATING___reject___REJECTED',         source: 'INVESTIGATING', target: 'REJECTED',      label: 'reject',       guards: [], permission: 'data.ticket.write.agency', sideEffects: [], metadata: {} },
        ],
        version: '1.0.0', checksum: '', metadata: {},
      },
    },
    {
      name:        'Alerte Incident Route',
      slug:        'incident-alert',
      description: 'Gestion rapide des incidents de route avec escalade et résolution.',
      entityType:  'Trip',
      categoryId:  categoryIds['operations'],
      tags:        ['incident', 'alert', 'operations', 'safety'],
      graph: {
        entityType: 'Trip',
        nodes: [
          { id: 'NORMAL',       label: 'Normal',       type: 'initial',  position: { x: 60,  y: 100 }, metadata: {} },
          { id: 'INCIDENT',     label: 'Incident',     type: 'state',    position: { x: 280, y: 100 }, metadata: {} },
          { id: 'ESCALATED',    label: 'Escaladé',     type: 'state',    position: { x: 500, y: 100 }, metadata: {} },
          { id: 'INVESTIGATING',label: 'Investigation', type: 'state',    position: { x: 720, y: 100 }, metadata: {} },
          { id: 'RESOLVED',     label: 'Résolu',       type: 'terminal', position: { x: 940, y: 100 }, metadata: {} },
          { id: 'CLOSED',       label: 'Clôturé',      type: 'terminal', position: { x: 500, y: 260 }, metadata: {} },
        ],
        edges: [
          { id: 'NORMAL___report___INCIDENT',          source: 'NORMAL',    target: 'INCIDENT',      label: 'report',        guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'INCIDENT___escalate___ESCALATED',     source: 'INCIDENT',  target: 'ESCALATED',     label: 'escalate',      guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'ESCALATED___investigate___INVESTIGATING',source:'ESCALATED',target:'INVESTIGATING', label: 'investigate',   guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'INVESTIGATING___resolve___RESOLVED',  source: 'INVESTIGATING',target:'RESOLVED',    label: 'resolve',       guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'INCIDENT___close___CLOSED',           source: 'INCIDENT',  target: 'CLOSED',        label: 'close',         guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
          { id: 'RESOLVED___close___CLOSED',           source: 'RESOLVED',  target: 'CLOSED',        label: 'close',         guards: [], permission: 'data.trip.write.agency', sideEffects: [], metadata: {} },
        ],
        version: '1.0.0', checksum: '', metadata: {},
      },
    },
  ];

  for (const bp of BLUEPRINTS) {
    bp.graph.checksum = graphChecksum(bp.graph as any);
    const existing = await prisma.workflowBlueprint.findFirst({
      where: { isSystem: true, slug: bp.slug },
    });
    if (!existing) {
      await prisma.workflowBlueprint.create({
        data: {
          name:           bp.name,
          slug:           bp.slug,
          description:    bp.description,
          entityType:     bp.entityType,
          graphJson:      bp.graph as any,
          checksum:       bp.graph.checksum,
          version:        '1.0.0',
          isSystem:       true,
          isPublic:       true,
          categoryId:     bp.categoryId,
          tags:           bp.tags,
          authorTenantId: null,
        },
      });
      console.log(`[Dev Seed] ✅ Blueprint système "${bp.name}"`);
    } else {
      await prisma.workflowBlueprint.update({
        where: { id: existing.id },
        data: {
          name:        bp.name,
          description: bp.description,
          graphJson:   bp.graph as any,
          checksum:    bp.graph.checksum,
          categoryId:  bp.categoryId,
          tags:        bp.tags,
          isPublic:    true,
        },
      });
      console.log(`[Dev Seed] ✅ Blueprint système "${bp.name}" (mis à jour)`);
    }
  }
}

async function main() {
  console.log('[Dev Seed] Démarrage...');

  // ── 1. Super Admin plateforme ────────────────────────────────────────────────
  const platformSARole = await prisma.role.findUnique({
    where: { tenantId_name: { tenantId: PLATFORM_TENANT_ID, name: 'SUPER_ADMIN' } },
  });

  const sa = await upsertUserWithCredential({
    tenantId: PLATFORM_TENANT_ID,
    email:    'superadmin@translogpro.io',
    name:     'Super Admin',
    roleId:   platformSARole?.id ?? null,
    password: 'Admin1234!',
  });
  console.log(`[Dev Seed] ✅ superadmin@translogpro.io (SUPER_ADMIN, id=${sa.id})`);

  // ── 2. Tenants + TENANT_ADMIN ────────────────────────────────────────────────
  for (const t of TENANTS) {
    await prisma.tenant.upsert({
      where:  { id: t.id },
      update: { name: t.name, slug: t.slug },
      create: { id: t.id, name: t.name, slug: t.slug, provisionStatus: 'ACTIVE' },
    });

    const roleMap     = await seedTenantRoles(prisma, t.id);
    const adminRoleId = roleMap.get('TENANT_ADMIN') ?? null;

    const admin = await upsertUserWithCredential({
      tenantId: t.id,
      email:    t.adminEmail,
      name:     `Admin ${t.name}`,
      roleId:   adminRoleId,
      password: 'Admin1234!',
    });
    console.log(`[Dev Seed] ✅ ${t.adminEmail} (TENANT_ADMIN → ${t.name}, id=${admin.id})`);
  }

  // ── 3. Agence principale tenant1 + rattachement de l'admin ─────────────────
  let agency1 = await prisma.agency.findFirst({
    where: { tenantId: TENANT1_ID, name: 'Agence Brazzaville Nord' },
  });
  if (!agency1) {
    agency1 = await prisma.agency.create({
      data: { tenantId: TENANT1_ID, name: 'Agence Brazzaville Nord' },
    });
  }

  // Rattacher l'admin à cette agence pour les permissions .agency
  await prisma.user.update({
    where:  { email: 'admin@tenant1.dev' },
    data:   { agencyId: agency1.id },
  });
  console.log(`[Dev Seed] ✅ Agence "${agency1.name}" (id=${agency1.id}), admin rattaché`);

  // ── 4. Activation de tous les modules pour tenant1 ───────────────────────────
  await activateAllModules(TENANT1_ID);

  // ── 5b. Workflows & Blueprints ────────────────────────────────────────────────
  await seedWorkflows(TENANT1_ID);
  const categoryIds = await seedBlueprintCategories();
  await seedSystemBlueprints(categoryIds);

  // ── 6. Profil DRIVER pour tests (tenant1 — TransExpress) ────────────────────
  const tenant1RoleMap = await seedTenantRoles(prisma, TENANT1_ID);
  const driverRoleId   = tenant1RoleMap.get('DRIVER') ?? null;

  const driver = await upsertUserWithCredential({
    tenantId: TENANT1_ID,
    email:    'driver@tenant1.dev',
    name:     'Jean-Baptiste Mabou',
    roleId:   driverRoleId,
    password: 'Admin1234!',
    userType: 'DRIVER',
  });

  await upsertDriverProfile(driver.id, TENANT1_ID);
  console.log(`[Dev Seed] ✅ driver@tenant1.dev (DRIVER + profil complet, id=${driver.id})`);

  // ── Résumé ───────────────────────────────────────────────────────────────────
  console.log('[Dev Seed] Terminé.');
  console.log('');
  console.log('  Identifiants de connexion :');
  console.log('  ┌────────────────────────────────────┬────────────┬──────────────────┐');
  console.log('  │ Email                              │ Password   │ Rôle             │');
  console.log('  ├────────────────────────────────────┼────────────┼──────────────────┤');
  console.log('  │ superadmin@translogpro.io          │ Admin1234! │ SUPER_ADMIN      │');
  console.log('  │ admin@tenant1.dev                  │ Admin1234! │ TENANT_ADMIN     │');
  console.log('  │ admin@tenant2.dev                  │ Admin1234! │ TENANT_ADMIN     │');
  console.log('  │ driver@tenant1.dev                 │ Admin1234! │ DRIVER (profil)  │');
  console.log('  └────────────────────────────────────┴────────────┴──────────────────┘');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
