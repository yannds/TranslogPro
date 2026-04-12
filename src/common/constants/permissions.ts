/**
 * Permission constants — format: "{plane}.{module}.{action}.{scope}"
 *
 *   plane  : control (config/rules) | data (business data)
 *   module : iam | workflow | ticket | parcel | trip | fleet | bus | route |
 *            pricing | cashier | sav | maintenance | manifest | traveler |
 *            luggage | shipment | session | user | integration | settings | module
 *   action : create | read | update | delete | scan | cancel | approve | report |
 *            check | open | close | transaction | deliver | claim | manage |
 *            config | override | install | revoke | verify | track | weigh |
 *            group | layout | yield | audit | setup | status
 *   scope  : own | agency | tenant | global
 *
 * The scope dimension is used by PermissionGuard AND by Prisma query filters:
 *   own    → WHERE userId = actor.id
 *   agency → WHERE agencyId = actor.agencyId
 *   tenant → WHERE tenantId = actor.tenantId  (all agencies)
 *   global → no tenant filter (SuperAdmin only)
 */

// ─── IAM ─────────────────────────────────────────────────────────────────────
export const P_IAM_MANAGE_TENANT           = 'control.iam.manage.tenant';
export const P_IAM_AUDIT_TENANT            = 'control.iam.audit.tenant';
export const P_INTEGRATION_SETUP_TENANT    = 'control.integration.setup.tenant';
export const P_USER_READ_AGENCY            = 'data.user.read.agency';
export const P_SESSION_REVOKE_OWN          = 'data.session.revoke.own';
export const P_SESSION_REVOKE_TENANT       = 'data.session.revoke.tenant';

// ─── Workflow & Config ────────────────────────────────────────────────────────
export const P_WORKFLOW_CONFIG_TENANT      = 'control.workflow.config.tenant';
export const P_WORKFLOW_OVERRIDE_GLOBAL    = 'control.workflow.override.global';
export const P_MODULE_INSTALL_TENANT       = 'control.module.install.tenant';
export const P_SETTINGS_MANAGE_TENANT      = 'control.settings.manage.tenant';

// ─── Routes & Planning ────────────────────────────────────────────────────────
export const P_ROUTE_MANAGE_TENANT         = 'control.route.manage.tenant';
export const P_TRIP_CREATE_TENANT          = 'data.trip.create.tenant';
export const P_TRIP_READ_OWN               = 'data.trip.read.own';          // Chauffeur
export const P_TRIP_UPDATE_AGENCY          = 'data.trip.update.agency';
export const P_TRIP_CHECK_OWN             = 'data.trip.check.own';          // Checklists
export const P_TRIP_REPORT_OWN             = 'data.trip.report.own';        // Incident / SOS

// ─── Billetterie ──────────────────────────────────────────────────────────────
export const P_TICKET_CREATE_AGENCY        = 'data.ticket.create.agency';
export const P_TICKET_CANCEL_AGENCY        = 'data.ticket.cancel.agency';
export const P_TICKET_SCAN_AGENCY          = 'data.ticket.scan.agency';
export const P_TICKET_READ_AGENCY          = 'data.ticket.read.agency';
export const P_TICKET_READ_TENANT          = 'data.ticket.read.tenant';
export const P_TRAVELER_VERIFY_AGENCY      = 'data.traveler.verify.agency';
export const P_TRAVELER_TRACK_GLOBAL       = 'data.traveler.track.global';
export const P_LUGGAGE_WEIGH_AGENCY        = 'data.luggage.weigh.agency';

// ─── Logistique Colis ─────────────────────────────────────────────────────────
export const P_PARCEL_CREATE_AGENCY        = 'data.parcel.create.agency';
export const P_PARCEL_SCAN_AGENCY          = 'data.parcel.scan.agency';
export const P_PARCEL_UPDATE_AGENCY        = 'data.parcel.update.agency';
export const P_PARCEL_UPDATE_TENANT        = 'data.parcel.update.tenant';
export const P_PARCEL_REPORT_AGENCY        = 'data.parcel.report.agency';
export const P_PARCEL_TRACK_GLOBAL         = 'data.parcel.track.global';
export const P_SHIPMENT_GROUP_AGENCY       = 'data.shipment.group.agency';

// ─── Flotte & Maintenance ─────────────────────────────────────────────────────
export const P_FLEET_MANAGE_TENANT         = 'control.fleet.manage.tenant';
export const P_FLEET_LAYOUT_TENANT         = 'control.fleet.layout.tenant';
export const P_BUS_CAPACITY_TENANT         = 'control.bus.capacity.tenant';
export const P_FLEET_STATUS_AGENCY         = 'data.fleet.status.agency';
export const P_MAINTENANCE_UPDATE_OWN      = 'data.maintenance.update.own';
export const P_MAINTENANCE_APPROVE_TENANT  = 'data.maintenance.approve.tenant';
export const P_MANIFEST_READ_OWN           = 'data.manifest.read.own';

// ─── Finance & Caisse ─────────────────────────────────────────────────────────
export const P_PRICING_MANAGE_TENANT       = 'control.pricing.manage.tenant';
export const P_PRICING_YIELD_TENANT        = 'control.pricing.yield.tenant';
export const P_PRICING_READ_AGENCY         = 'data.pricing.read.agency';
export const P_CASHIER_OPEN_OWN            = 'data.cashier.open.own';
export const P_CASHIER_TRANSACTION_OWN     = 'data.cashier.transaction.own';
export const P_CASHIER_CLOSE_AGENCY        = 'data.cashier.close.agency';

// ─── SAV ─────────────────────────────────────────────────────────────────────
export const P_SAV_REPORT_OWN              = 'data.sav.report.own';
export const P_SAV_REPORT_AGENCY           = 'data.sav.report.agency';
export const P_SAV_DELIVER_AGENCY          = 'data.sav.deliver.agency';
export const P_SAV_CLAIM_TENANT            = 'data.sav.claim.tenant';

// ─── Union type ───────────────────────────────────────────────────────────────
export const Permission = {
  // IAM
  IAM_MANAGE_TENANT:          P_IAM_MANAGE_TENANT,
  IAM_AUDIT_TENANT:           P_IAM_AUDIT_TENANT,
  INTEGRATION_SETUP_TENANT:   P_INTEGRATION_SETUP_TENANT,
  USER_READ_AGENCY:           P_USER_READ_AGENCY,
  SESSION_REVOKE_OWN:         P_SESSION_REVOKE_OWN,
  SESSION_REVOKE_TENANT:      P_SESSION_REVOKE_TENANT,
  // Workflow
  WORKFLOW_CONFIG_TENANT:     P_WORKFLOW_CONFIG_TENANT,
  WORKFLOW_OVERRIDE_GLOBAL:   P_WORKFLOW_OVERRIDE_GLOBAL,
  MODULE_INSTALL_TENANT:      P_MODULE_INSTALL_TENANT,
  SETTINGS_MANAGE_TENANT:     P_SETTINGS_MANAGE_TENANT,
  // Routes / Trips
  ROUTE_MANAGE_TENANT:        P_ROUTE_MANAGE_TENANT,
  TRIP_CREATE_TENANT:         P_TRIP_CREATE_TENANT,
  TRIP_READ_OWN:              P_TRIP_READ_OWN,
  TRIP_UPDATE_AGENCY:         P_TRIP_UPDATE_AGENCY,
  TRIP_CHECK_OWN:             P_TRIP_CHECK_OWN,
  TRIP_REPORT_OWN:            P_TRIP_REPORT_OWN,
  // Tickets
  TICKET_CREATE_AGENCY:       P_TICKET_CREATE_AGENCY,
  TICKET_CANCEL_AGENCY:       P_TICKET_CANCEL_AGENCY,
  TICKET_SCAN_AGENCY:         P_TICKET_SCAN_AGENCY,
  TICKET_READ_AGENCY:         P_TICKET_READ_AGENCY,
  TICKET_READ_TENANT:         P_TICKET_READ_TENANT,
  TRAVELER_VERIFY_AGENCY:     P_TRAVELER_VERIFY_AGENCY,
  TRAVELER_TRACK_GLOBAL:      P_TRAVELER_TRACK_GLOBAL,
  LUGGAGE_WEIGH_AGENCY:       P_LUGGAGE_WEIGH_AGENCY,
  // Parcels
  PARCEL_CREATE_AGENCY:       P_PARCEL_CREATE_AGENCY,
  PARCEL_SCAN_AGENCY:         P_PARCEL_SCAN_AGENCY,
  PARCEL_UPDATE_AGENCY:       P_PARCEL_UPDATE_AGENCY,
  PARCEL_UPDATE_TENANT:       P_PARCEL_UPDATE_TENANT,
  PARCEL_REPORT_AGENCY:       P_PARCEL_REPORT_AGENCY,
  PARCEL_TRACK_GLOBAL:        P_PARCEL_TRACK_GLOBAL,
  SHIPMENT_GROUP_AGENCY:      P_SHIPMENT_GROUP_AGENCY,
  // Fleet
  FLEET_MANAGE_TENANT:        P_FLEET_MANAGE_TENANT,
  FLEET_LAYOUT_TENANT:        P_FLEET_LAYOUT_TENANT,
  BUS_CAPACITY_TENANT:        P_BUS_CAPACITY_TENANT,
  FLEET_STATUS_AGENCY:        P_FLEET_STATUS_AGENCY,
  MAINTENANCE_UPDATE_OWN:     P_MAINTENANCE_UPDATE_OWN,
  MAINTENANCE_APPROVE_TENANT: P_MAINTENANCE_APPROVE_TENANT,
  MANIFEST_READ_OWN:          P_MANIFEST_READ_OWN,
  // Finance
  PRICING_MANAGE_TENANT:      P_PRICING_MANAGE_TENANT,
  PRICING_YIELD_TENANT:       P_PRICING_YIELD_TENANT,
  PRICING_READ_AGENCY:        P_PRICING_READ_AGENCY,
  CASHIER_OPEN_OWN:           P_CASHIER_OPEN_OWN,
  CASHIER_TRANSACTION_OWN:    P_CASHIER_TRANSACTION_OWN,
  CASHIER_CLOSE_AGENCY:       P_CASHIER_CLOSE_AGENCY,
  // SAV
  SAV_REPORT_OWN:             P_SAV_REPORT_OWN,
  SAV_REPORT_AGENCY:          P_SAV_REPORT_AGENCY,
  SAV_DELIVER_AGENCY:         P_SAV_DELIVER_AGENCY,
  SAV_CLAIM_TENANT:           P_SAV_CLAIM_TENANT,
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

/**
 * Scope extrait depuis la permission string.
 * Utilisé par le PermissionGuard pour piloter le filtre Prisma.
 */
export type PermissionScope = 'own' | 'agency' | 'tenant' | 'global';

export function extractScope(permission: string): PermissionScope {
  const parts = permission.split('.');
  return (parts[3] ?? 'tenant') as PermissionScope;
}

export function extractPlane(permission: string): 'control' | 'data' {
  return (permission.split('.')[0] ?? 'data') as 'control' | 'data';
}

/**
 * Matrice des permissions par rôle.
 * Source : PRD v2.0 — Section V.2
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  // Accès total — toutes les permissions
  TENANT_ADMIN: Object.values(Permission) as Permission[],

  // Planificateur / Responsable d'agence
  AGENCY_MANAGER: [
    Permission.ROUTE_MANAGE_TENANT,
    Permission.TRIP_CREATE_TENANT,
    Permission.TRIP_UPDATE_AGENCY,
    Permission.TRIP_READ_OWN,
    Permission.TICKET_READ_AGENCY,
    Permission.TICKET_READ_TENANT,
    Permission.TICKET_CREATE_AGENCY,
    Permission.TICKET_CANCEL_AGENCY,
    Permission.PARCEL_CREATE_AGENCY,
    Permission.PARCEL_UPDATE_AGENCY,
    Permission.PARCEL_UPDATE_TENANT,
    Permission.PARCEL_TRACK_GLOBAL,
    Permission.SHIPMENT_GROUP_AGENCY,
    Permission.FLEET_STATUS_AGENCY,
    Permission.FLEET_MANAGE_TENANT,
    Permission.CASHIER_CLOSE_AGENCY,
    Permission.MAINTENANCE_APPROVE_TENANT,
    Permission.MANIFEST_READ_OWN,
    Permission.USER_READ_AGENCY,
    Permission.PRICING_READ_AGENCY,
    Permission.SAV_CLAIM_TENANT,
    Permission.IAM_AUDIT_TENANT,
  ],

  // Agent de Gare (vente comptoir + caisse + colis)
  STATION_AGENT: [
    Permission.TICKET_CREATE_AGENCY,
    Permission.TICKET_CANCEL_AGENCY,
    Permission.TICKET_SCAN_AGENCY,
    Permission.TICKET_READ_AGENCY,
    Permission.TRAVELER_VERIFY_AGENCY,
    Permission.LUGGAGE_WEIGH_AGENCY,
    Permission.PARCEL_CREATE_AGENCY,
    Permission.PARCEL_SCAN_AGENCY,
    Permission.PARCEL_UPDATE_AGENCY,
    Permission.SHIPMENT_GROUP_AGENCY,
    Permission.CASHIER_OPEN_OWN,
    Permission.CASHIER_TRANSACTION_OWN,
    Permission.CASHIER_CLOSE_AGENCY,
    Permission.SAV_REPORT_AGENCY,
  ],

  // Agent de Quai (scan + chargement + SAV)
  QUAI_AGENT: [
    Permission.TICKET_SCAN_AGENCY,
    Permission.TRAVELER_VERIFY_AGENCY,
    Permission.PARCEL_SCAN_AGENCY,
    Permission.PARCEL_REPORT_AGENCY,
    Permission.MANIFEST_READ_OWN,
    Permission.SAV_REPORT_AGENCY,
    Permission.SAV_DELIVER_AGENCY,
  ],

  // Chauffeur
  DRIVER: [
    Permission.TRIP_READ_OWN,
    Permission.TRIP_CHECK_OWN,
    Permission.TRIP_REPORT_OWN,
    Permission.TICKET_SCAN_AGENCY,
    Permission.MANIFEST_READ_OWN,
    Permission.SAV_REPORT_OWN,
  ],

  // Mécanicien
  MECHANIC: [
    Permission.MAINTENANCE_UPDATE_OWN,
    Permission.FLEET_STATUS_AGENCY,
  ],

  // Planificateur (sans accès caisse ni vente)
  PLANNER: [
    Permission.ROUTE_MANAGE_TENANT,
    Permission.TRIP_CREATE_TENANT,
    Permission.TRIP_UPDATE_AGENCY,
    Permission.FLEET_MANAGE_TENANT,
    Permission.FLEET_LAYOUT_TENANT,
    Permission.BUS_CAPACITY_TENANT,
    Permission.PRICING_READ_AGENCY,
    Permission.PRICING_MANAGE_TENANT,
  ],

  // SuperAdmin (Control Plane — cross-tenant)
  SUPER_ADMIN: Object.values(Permission) as Permission[],
};
