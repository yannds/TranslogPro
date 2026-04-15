/**
 * Permission constants — format: "{plane}.{module}.{action}.{scope}"
 *
 *   plane  : control (config/rules) | data (business data)
 *   module : iam | workflow | ticket | parcel | trip | fleet | bus | route |
 *            pricing | cashier | sav | maintenance | manifest | traveler |
 *            luggage | shipment | session | user | integration | settings | module |
 *            crm | campaign | feedback | safety | stats | crew | display |
 *            impersonation | outbox
 *   action : create | read | update | delete | scan | cancel | approve | report |
 *            check | open | close | transaction | deliver | claim | manage |
 *            config | override | install | revoke | verify | track | weigh |
 *            group | layout | yield | audit | setup | status | submit | monitor |
 *            delay | log_event | switch | debug | replay
 *   scope  : own | agency | tenant | global
 *
 * IMPORTANT — Ces constantes sont des RÉFÉRENCES COMPILE-TIME uniquement.
 * La source de vérité runtime est la table RolePermission en DB.
 * Le PermissionGuard interroge prisma.rolePermission + cache Redis 60s.
 * JAMAIS utiliser ces constantes comme source de vérité dans le code runtime.
 *
 * PLATFORM TENANT : Les permissions *.global sont réservées au tenant
 * "00000000-0000-0000-0000-000000000000" (PLATFORM_TENANT_ID).
 * Le PlatformTenantGuard bloque tout user standard sur ce tenant.
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
export const P_TRIP_READ_OWN               = 'data.trip.read.own';
export const P_TRIP_UPDATE_AGENCY          = 'data.trip.update.agency';
export const P_TRIP_CHECK_OWN              = 'data.trip.check.own';
export const P_TRIP_REPORT_OWN             = 'data.trip.report.own';
export const P_TRIP_DELAY_AGENCY           = 'control.trip.delay.agency';
export const P_TRIP_CANCEL_TENANT          = 'control.trip.cancel.tenant';
export const P_TRIP_LOG_EVENT_OWN          = 'control.trip.log_event.own';

// ─── Billetterie ──────────────────────────────────────────────────────────────
export const P_TICKET_CREATE_AGENCY        = 'data.ticket.create.agency';
export const P_TICKET_CANCEL_AGENCY        = 'data.ticket.cancel.agency';
export const P_TICKET_SCAN_AGENCY          = 'data.ticket.scan.agency';
export const P_TICKET_READ_OWN             = 'data.ticket.read.own';
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
export const P_PARCEL_READ_OWN             = 'data.parcel.read.own';
export const P_PARCEL_TRACK_OWN            = 'data.parcel.track.own';
export const P_PARCEL_TRACK_GLOBAL         = 'data.parcel.track.global';
export const P_SHIPMENT_GROUP_AGENCY       = 'data.shipment.group.agency';
export const P_SHIPMENT_READ_OWN           = 'data.shipment.read.own';

// ─── Flotte & Maintenance ─────────────────────────────────────────────────────
export const P_FLEET_MANAGE_TENANT         = 'control.fleet.manage.tenant';
export const P_FLEET_LAYOUT_TENANT         = 'control.fleet.layout.tenant';
export const P_BUS_CAPACITY_TENANT         = 'control.bus.capacity.tenant';
export const P_FLEET_STATUS_AGENCY         = 'data.fleet.status.agency';
export const P_MAINTENANCE_UPDATE_OWN      = 'data.maintenance.update.own';
export const P_MAINTENANCE_APPROVE_TENANT  = 'data.maintenance.approve.tenant';
export const P_MANIFEST_READ_OWN           = 'data.manifest.read.own';
export const P_MANIFEST_GENERATE_AGENCY    = 'data.manifest.generate.agency';
export const P_MANIFEST_SIGN_AGENCY        = 'data.manifest.sign.agency';
export const P_NOTIFICATION_READ_OWN       = 'data.notification.read.own';

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

// ─── Staff & Tenant ───────────────────────────────────────────────────────────
export const P_STAFF_MANAGE_TENANT         = 'control.staff.manage.tenant';
export const P_STAFF_READ_AGENCY           = 'data.staff.read.agency';
export const P_STAFF_READ_TENANT           = 'data.staff.read.tenant';
export const P_TENANT_MANAGE_GLOBAL        = 'control.tenant.manage.global';

// ─── Agency (CRUD agences au sein d'un tenant) ────────────────────────────────
// INVARIANT : tout tenant possède ≥1 agence (défaut : "Siège" / "Headquarters").
// AgencyService.remove() refuse la suppression de la dernière agence (409).
export const P_AGENCY_MANAGE_TENANT        = 'control.agency.manage.tenant';
export const P_AGENCY_READ_TENANT          = 'data.agency.read.tenant';

// ─── Station (CRUD gares/stations) ────────────────────────────────────────────
// Les stations sont la source des origines/destinations de lignes, parcels, etc.
// Suppression refusée (409) si la station est référencée ailleurs.
export const P_STATION_MANAGE_TENANT       = 'control.station.manage.tenant';
export const P_STATION_READ_TENANT         = 'data.station.read.tenant';

// ─── CRM & Campagnes ─────────────────────────────────────────────────────────
export const P_CRM_READ_TENANT             = 'data.crm.read.tenant';
export const P_CAMPAIGN_MANAGE_TENANT      = 'control.campaign.manage.tenant';

// ─── Safety & Feedback ────────────────────────────────────────────────────────
export const P_FEEDBACK_SUBMIT_OWN         = 'data.feedback.submit.own';
export const P_SAFETY_MONITOR_GLOBAL       = 'control.safety.monitor.global';

// ─── Stats & Analytics ────────────────────────────────────────────────────────
export const P_STATS_READ_TENANT           = 'control.stats.read.tenant';

// ─── Crew ─────────────────────────────────────────────────────────────────────
export const P_CREW_MANAGE_TENANT          = 'data.crew.manage.tenant';

// ─── Display ─────────────────────────────────────────────────────────────────
export const P_DISPLAY_UPDATE_AGENCY       = 'data.display.update.agency';

// ─── Impersonation (Control Plane — tenant 00000000-...) ─────────────────────
// Réservé aux rôles SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2 du tenant plateforme.
// Jamais attribuable via un onboarding client.
export const P_IMPERSONATION_SWITCH_GLOBAL  = 'control.impersonation.switch.global';
export const P_IMPERSONATION_REVOKE_GLOBAL  = 'control.impersonation.revoke.global';

// ─── Support — lecture globale Data Plane ────────────────────────────────────
// Permissions utilisées via le mécanisme JIT (session switch).
export const P_TICKET_READ_GLOBAL           = 'data.ticket.read.global';
export const P_TRIP_READ_GLOBAL             = 'data.trip.read.global';
export const P_FLEET_READ_GLOBAL            = 'data.fleet.read.global';
export const P_CASHIER_READ_GLOBAL          = 'data.cashier.read.global';
export const P_MANIFEST_READ_GLOBAL         = 'data.manifest.read.global';

// ─── Support L2 — debug technique ────────────────────────────────────────────
export const P_WORKFLOW_DEBUG_GLOBAL        = 'data.workflow.debug.global';
export const P_OUTBOX_REPLAY_GLOBAL         = 'data.outbox.replay.global';

// ─── Platform — gestion du staff interne ─────────────────────────────────────
// Réservé au SUPER_ADMIN du tenant plateforme.
// Permet de créer/lister/supprimer les comptes SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2.
export const P_PLATFORM_STAFF_GLOBAL        = 'control.platform.staff.global';

// ─── Documents imprimables ────────────────────────────────────────────────────
// Génération d'états imprimables certifiés (HTML signé stocké dans MinIO).
// Le Frontend ne construit JAMAIS ces documents — il reçoit une URL présignée.
export const P_TICKET_PRINT_AGENCY          = 'data.ticket.print.agency';
export const P_MANIFEST_PRINT_AGENCY        = 'data.manifest.print.agency';
export const P_MANIFEST_PRINT_GLOBAL        = 'data.manifest.print.global';
export const P_PARCEL_PRINT_AGENCY          = 'data.parcel.print.agency';
export const P_INVOICE_PRINT_AGENCY         = 'data.invoice.print.agency';

// Templates de documents (CRUD modèles d'impression)
export const P_TEMPLATE_READ_AGENCY         = 'data.template.read.agency';
export const P_TEMPLATE_WRITE_AGENCY        = 'data.template.write.agency';
export const P_TEMPLATE_DELETE_AGENCY       = 'data.template.delete.agency';

// ─── Driver & HR ──────────────────────────────────────────────────────────────
export const P_DRIVER_MANAGE_TENANT         = 'control.driver.manage.tenant';
export const P_DRIVER_PROFILE_AGENCY        = 'data.driver.profile.agency';
export const P_DRIVER_REST_OWN              = 'data.driver.rest.own';

// ─── QHSE & Accidents ────────────────────────────────────────────────────────
export const P_QHSE_MANAGE_TENANT           = 'control.qhse.manage.tenant';
export const P_ACCIDENT_REPORT_OWN          = 'data.accident.report.own';

// ─── Workflow Studio & Marketplace ────────────────────────────────────────────
// Conception et gestion des blueprints de workflow.
export const P_WORKFLOW_STUDIO_READ_TENANT  = 'control.workflow.studio.read.tenant';
export const P_WORKFLOW_STUDIO_WRITE_TENANT = 'control.workflow.studio.write.tenant';
export const P_WORKFLOW_MARKETPLACE_READ    = 'control.workflow.marketplace.read.tenant';
export const P_WORKFLOW_MARKETPLACE_PUBLISH = 'control.workflow.marketplace.publish.tenant';
export const P_WORKFLOW_BLUEPRINT_IMPORT    = 'control.workflow.blueprint.import.tenant';
export const P_WORKFLOW_SIMULATE_TENANT     = 'control.workflow.simulate.tenant';

// ─── Const object (compile-time lookup) ──────────────────────────────────────
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
  TRIP_DELAY_AGENCY:          P_TRIP_DELAY_AGENCY,
  TRIP_CANCEL_TENANT:         P_TRIP_CANCEL_TENANT,
  TRIP_LOG_EVENT_OWN:         P_TRIP_LOG_EVENT_OWN,
  // Tickets
  TICKET_CREATE_AGENCY:       P_TICKET_CREATE_AGENCY,
  TICKET_CANCEL_AGENCY:       P_TICKET_CANCEL_AGENCY,
  TICKET_SCAN_AGENCY:         P_TICKET_SCAN_AGENCY,
  TICKET_READ_OWN:            P_TICKET_READ_OWN,
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
  PARCEL_READ_OWN:            P_PARCEL_READ_OWN,
  PARCEL_TRACK_OWN:           P_PARCEL_TRACK_OWN,
  PARCEL_TRACK_GLOBAL:        P_PARCEL_TRACK_GLOBAL,
  SHIPMENT_GROUP_AGENCY:      P_SHIPMENT_GROUP_AGENCY,
  SHIPMENT_READ_OWN:          P_SHIPMENT_READ_OWN,
  // Fleet
  FLEET_MANAGE_TENANT:        P_FLEET_MANAGE_TENANT,
  FLEET_LAYOUT_TENANT:        P_FLEET_LAYOUT_TENANT,
  BUS_CAPACITY_TENANT:        P_BUS_CAPACITY_TENANT,
  FLEET_STATUS_AGENCY:        P_FLEET_STATUS_AGENCY,
  MAINTENANCE_UPDATE_OWN:     P_MAINTENANCE_UPDATE_OWN,
  MAINTENANCE_APPROVE_TENANT: P_MAINTENANCE_APPROVE_TENANT,
  MANIFEST_READ_OWN:          P_MANIFEST_READ_OWN,
  MANIFEST_GENERATE_AGENCY:   P_MANIFEST_GENERATE_AGENCY,
  MANIFEST_SIGN_AGENCY:       P_MANIFEST_SIGN_AGENCY,
  NOTIFICATION_READ_OWN:      P_NOTIFICATION_READ_OWN,
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
  // Staff & Tenant
  STAFF_MANAGE:               P_STAFF_MANAGE_TENANT,
  STAFF_READ:                 P_STAFF_READ_AGENCY,
  STAFF_READ_TENANT:          P_STAFF_READ_TENANT,
  TENANT_MANAGE:              P_TENANT_MANAGE_GLOBAL,
  // Agency (CRUD)
  AGENCY_MANAGE_TENANT:       P_AGENCY_MANAGE_TENANT,
  AGENCY_READ_TENANT:         P_AGENCY_READ_TENANT,
  // Station (CRUD)
  STATION_MANAGE_TENANT:      P_STATION_MANAGE_TENANT,
  STATION_READ_TENANT:        P_STATION_READ_TENANT,
  // CRM
  CRM_READ_TENANT:            P_CRM_READ_TENANT,
  CAMPAIGN_MANAGE_TENANT:     P_CAMPAIGN_MANAGE_TENANT,
  // Safety & Feedback
  FEEDBACK_SUBMIT_OWN:        P_FEEDBACK_SUBMIT_OWN,
  SAFETY_MONITOR_GLOBAL:      P_SAFETY_MONITOR_GLOBAL,
  // Stats
  STATS_READ_TENANT:          P_STATS_READ_TENANT,
  // Crew
  CREW_MANAGE_TENANT:         P_CREW_MANAGE_TENANT,
  // Display
  DISPLAY_UPDATE_AGENCY:      P_DISPLAY_UPDATE_AGENCY,
  // Impersonation
  IMPERSONATION_SWITCH_GLOBAL: P_IMPERSONATION_SWITCH_GLOBAL,
  IMPERSONATION_REVOKE_GLOBAL: P_IMPERSONATION_REVOKE_GLOBAL,
  // Support read global
  TICKET_READ_GLOBAL:          P_TICKET_READ_GLOBAL,
  TRIP_READ_GLOBAL:            P_TRIP_READ_GLOBAL,
  FLEET_READ_GLOBAL:           P_FLEET_READ_GLOBAL,
  CASHIER_READ_GLOBAL:         P_CASHIER_READ_GLOBAL,
  MANIFEST_READ_GLOBAL:        P_MANIFEST_READ_GLOBAL,
  // Support L2 debug
  WORKFLOW_DEBUG_GLOBAL:       P_WORKFLOW_DEBUG_GLOBAL,
  OUTBOX_REPLAY_GLOBAL:        P_OUTBOX_REPLAY_GLOBAL,
  // Platform staff (SUPER_ADMIN only)
  PLATFORM_STAFF_GLOBAL:       P_PLATFORM_STAFF_GLOBAL,
  // Documents imprimables
  TICKET_PRINT_AGENCY:         P_TICKET_PRINT_AGENCY,
  MANIFEST_PRINT_AGENCY:       P_MANIFEST_PRINT_AGENCY,
  MANIFEST_PRINT_GLOBAL:       P_MANIFEST_PRINT_GLOBAL,
  PARCEL_PRINT_AGENCY:         P_PARCEL_PRINT_AGENCY,
  INVOICE_PRINT_AGENCY:        P_INVOICE_PRINT_AGENCY,
  // Templates
  TEMPLATE_READ_AGENCY:        P_TEMPLATE_READ_AGENCY,
  TEMPLATE_WRITE_AGENCY:       P_TEMPLATE_WRITE_AGENCY,
  TEMPLATE_DELETE_AGENCY:      P_TEMPLATE_DELETE_AGENCY,
  // Driver & HR
  DRIVER_MANAGE_TENANT:         P_DRIVER_MANAGE_TENANT,
  DRIVER_PROFILE_AGENCY:        P_DRIVER_PROFILE_AGENCY,
  DRIVER_REST_OWN:              P_DRIVER_REST_OWN,
  // QHSE & Accidents
  QHSE_MANAGE_TENANT:           P_QHSE_MANAGE_TENANT,
  ACCIDENT_REPORT_OWN:          P_ACCIDENT_REPORT_OWN,
  // Workflow Studio & Marketplace
  WORKFLOW_STUDIO_READ_TENANT:  P_WORKFLOW_STUDIO_READ_TENANT,
  WORKFLOW_STUDIO_WRITE_TENANT: P_WORKFLOW_STUDIO_WRITE_TENANT,
  WORKFLOW_MARKETPLACE_READ:    P_WORKFLOW_MARKETPLACE_READ,
  WORKFLOW_MARKETPLACE_PUBLISH: P_WORKFLOW_MARKETPLACE_PUBLISH,
  WORKFLOW_BLUEPRINT_IMPORT:    P_WORKFLOW_BLUEPRINT_IMPORT,
  WORKFLOW_SIMULATE_TENANT:     P_WORKFLOW_SIMULATE_TENANT,
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

/** Scope extrait depuis la permission string. */
export type PermissionScope = 'own' | 'agency' | 'tenant' | 'global';

export function extractScope(permission: string): PermissionScope {
  const parts = permission.split('.');
  return (parts[3] ?? 'tenant') as PermissionScope;
}

export function extractPlane(permission: string): 'control' | 'data' {
  return (permission.split('.')[0] ?? 'data') as 'control' | 'data';
}
