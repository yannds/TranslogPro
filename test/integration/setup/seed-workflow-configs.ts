/**
 * Seed minimal pour les tests d'intégration.
 *
 * Crée dans la DB de test :
 *   - 1 Tenant
 *   - 1 Role
 *   - N RolePermissions (une par transition testée)
 *   - N WorkflowConfigs (transitions complètes Ticket / Trip / Parcel)
 *
 * Design : toutes les permissions sont accordées au même roleId pour simplifier.
 * En production, chaque rôle n'a qu'un sous-ensemble de permissions.
 */

import { PrismaClient } from '@prisma/client';

// ─── IDs fixes (références entre tables) ──────────────────────────────────────

export const SEED = {
  tenantId: 'tenant-integration-test',
  roleId:   'role-integration-agent',
  actorId:  'actor-integration-01',
  agencyId: 'agency-integration-01',
} as const;

// ─── Permissions utilisées par chaque transition ──────────────────────────────

const PERMS = {
  ticket:  'data.ticket.manage.agency',
  trip:    'data.trip.manage.agency',
  parcel:  'data.parcel.manage.agency',
  bus:     'data.bus.manage.agency',
} as const;

// ─── WorkflowConfigs ──────────────────────────────────────────────────────────

type WfRow = {
  entityType: string;
  fromState:  string;
  action:     string;
  toState:    string;
  perm:       string;
};

const WORKFLOW_CONFIGS: WfRow[] = [
  // ── Ticket ─────────────────────────────────────────────────────────────────
  { entityType: 'Ticket', fromState: 'CREATED',         action: 'RESERVE',  toState: 'PENDING_PAYMENT',  perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'PAY',      toState: 'CONFIRMED',        perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'CONFIRMED',       action: 'CHECK_IN', toState: 'CHECKED_IN',       perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'CONFIRMED',       action: 'BOARD',    toState: 'BOARDED',          perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'CHECKED_IN',      action: 'BOARD',    toState: 'BOARDED',          perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'BOARDED',         action: 'FINALIZE', toState: 'COMPLETED',        perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'EXPIRE',   toState: 'EXPIRED',          perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'CONFIRMED',       action: 'CANCEL',   toState: 'CANCELLED',        perm: PERMS.ticket },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'CANCEL',   toState: 'CANCELLED',        perm: PERMS.ticket },
  // ── Trip ───────────────────────────────────────────────────────────────────
  { entityType: 'Trip', fromState: 'PLANNED',             action: 'ACTIVATE',         toState: 'OPEN',                 perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'OPEN',                action: 'START_BOARDING',   toState: 'BOARDING',             perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'BOARDING',            action: 'DEPART',           toState: 'IN_PROGRESS',          perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',         action: 'PAUSE',            toState: 'IN_PROGRESS_PAUSED',   perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_PAUSED',  action: 'RESUME',           toState: 'IN_PROGRESS',          perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',         action: 'REPORT_INCIDENT',  toState: 'IN_PROGRESS_DELAYED',  perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_DELAYED', action: 'CLEAR_INCIDENT',   toState: 'IN_PROGRESS',          perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',         action: 'END_TRIP',         toState: 'COMPLETED',            perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'PLANNED',             action: 'CANCEL',           toState: 'CANCELLED',            perm: PERMS.trip },
  { entityType: 'Trip', fromState: 'OPEN',                action: 'CANCEL',           toState: 'CANCELLED',            perm: PERMS.trip },
  // ── Parcel ─────────────────────────────────────────────────────────────────
  { entityType: 'Parcel', fromState: 'CREATED',    action: 'RECEIVE',         toState: 'AT_ORIGIN',  perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'AT_ORIGIN',  action: 'ADD_TO_SHIPMENT', toState: 'PACKED',     perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'PACKED',     action: 'LOAD',            toState: 'LOADED',     perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'LOADED',     action: 'DEPART',          toState: 'IN_TRANSIT', perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'IN_TRANSIT', action: 'ARRIVE',          toState: 'ARRIVED',    perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'ARRIVED',    action: 'DELIVER',         toState: 'DELIVERED',  perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'IN_TRANSIT', action: 'DAMAGE',          toState: 'DAMAGED',    perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'ARRIVED',    action: 'DAMAGE',          toState: 'DAMAGED',    perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'IN_TRANSIT', action: 'DECLARE_LOST',    toState: 'LOST',       perm: PERMS.parcel },
  { entityType: 'Parcel', fromState: 'ARRIVED',    action: 'RETURN',          toState: 'RETURNED',   perm: PERMS.parcel },
];

// ─── Seed function ─────────────────────────────────────────────────────────────

export async function seedWorkflowConfigs(prisma: PrismaClient): Promise<void> {
  const { tenantId, roleId } = SEED;

  // Tenant
  await prisma.tenant.upsert({
    where:  { id: tenantId },
    update: {},
    create: {
      id:   tenantId,
      name: 'Integration Test Tenant',
      slug: 'integration-test',
    },
  });

  // Role
  await prisma.role.upsert({
    where:  { id: roleId },
    update: {},
    create: {
      id:       roleId,
      tenantId,
      name:     'integration-agent',
      isSystem: false,
    },
  });

  // TenantConfig (requis par SafetyService et GeoSafetyProvider)
  await prisma.tenantConfig.upsert({
    where:  { tenantId },
    update: {},
    create: {
      tenantId,
      autoVerifyScoreThreshold: 0.7,
    },
  });

  // RolePermissions — une par permission unique
  const uniquePerms = [...new Set(WORKFLOW_CONFIGS.map(c => c.perm))];
  for (const permission of uniquePerms) {
    await prisma.rolePermission.upsert({
      where:  { roleId_permission: { roleId, permission } },
      update: {},
      create: { roleId, permission },
    });
  }

  // WorkflowConfigs
  for (const row of WORKFLOW_CONFIGS) {
    await prisma.workflowConfig.upsert({
      where: {
        tenantId_entityType_fromState_action_version: {
          tenantId,
          entityType: row.entityType,
          fromState:  row.fromState,
          action:     row.action,
          version:    1,
        },
      },
      update: {},
      create: {
        tenantId,
        entityType:   row.entityType,
        fromState:    row.fromState,
        action:       row.action,
        toState:      row.toState,
        requiredPerm: row.perm,
        isActive:     true,
        effectiveFrom: new Date(),
      },
    });
  }
}
