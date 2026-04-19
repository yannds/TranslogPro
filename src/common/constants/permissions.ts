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
export const P_USER_RESET_PASSWORD_TENANT  = 'control.iam.user.reset-password.tenant';
export const P_USER_BULK_DELETE_TENANT     = 'control.iam.user.bulk-delete.tenant';
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
export const P_TRIP_READ_AGENCY            = 'data.trip.read.agency';
export const P_TRIP_READ_TENANT            = 'data.trip.read.tenant';
export const P_TRIP_UPDATE_AGENCY          = 'data.trip.update.agency';
export const P_TRIP_CHECK_OWN              = 'data.trip.check.own';
export const P_TRIP_REPORT_OWN             = 'data.trip.report.own';
// Signalement d'incident par le voyageur authentifié (CUSTOMER).
// Distinct de P_TRIP_REPORT_OWN (chauffeur/staff) : scope "own" signifie
// que le voyageur ne peut créer/voir que SES incidents (reportedById = userId).
export const P_INCIDENT_REPORT_OWN          = 'data.incident.report.own';
export const P_TRIP_DELAY_AGENCY           = 'control.trip.delay.agency';
export const P_TRIP_DELETE_TENANT           = 'control.trip.delete.tenant';
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
export const P_MANIFEST_READ_AGENCY        = 'data.manifest.read.agency';
export const P_MANIFEST_GENERATE_AGENCY    = 'data.manifest.generate.agency';
export const P_MANIFEST_SIGN_AGENCY        = 'data.manifest.sign.agency';
export const P_NOTIFICATION_READ_OWN       = 'data.notification.read.own';

// ─── Fleet Tracking (suivi kilométrique & carburant) ──────────────────────
export const P_FLEET_TRACKING_MANAGE_TENANT = 'data.fleet.tracking.tenant';
export const P_FLEET_TRACKING_CREATE_AGENCY = 'data.fleet.tracking_create.agency';

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

// ─── Refunds ─────────────────────────────────────────────────────────────────
export const P_REFUND_READ_TENANT      = 'data.refund.read.tenant';
export const P_REFUND_READ_AGENCY      = 'data.refund.read.agency';
export const P_REFUND_APPROVE_TENANT   = 'data.refund.approve.tenant';
export const P_REFUND_APPROVE_AGENCY   = 'data.refund.approve.agency';
export const P_REFUND_PROCESS_TENANT   = 'data.refund.process.tenant';
export const P_REFUND_REQUEST_OWN      = 'data.refund.request.own';

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
// Quai management — portail agent de quai (chargement fret + embarquement).
// Référencée par resolvePortal.ts pour orienter l'user vers /quai. Accordée
// au rôle système AGENT_QUAI, optionnellement à des rôles custom tenant.
export const P_QUAI_MANAGE_TENANT          = 'control.quai.manage.tenant';

// ─── CRM & Campagnes ─────────────────────────────────────────────────────────
export const P_CRM_READ_TENANT             = 'data.crm.read.tenant';
export const P_CRM_READ_AGENCY             = 'data.crm.read.agency';
export const P_CRM_WRITE_TENANT            = 'data.crm.write.tenant';   // upsert CUSTOMER shadow, édition
export const P_CRM_WRITE_AGENCY            = 'data.crm.write.agency';   // édition limitée à son agence
export const P_CRM_MERGE_TENANT            = 'data.crm.merge.tenant';   // fusion Customer (op destructive, audit log)
export const P_CRM_DELETE_TENANT           = 'data.crm.delete.tenant';  // RGPD droit à l'oubli
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

// ─── Tarification (grille tarifaire, promotions) ─────────────────────────────
export const P_TARIFF_MANAGE_TENANT        = 'control.tariff.manage.tenant';
export const P_TARIFF_READ_AGENCY          = 'data.tariff.read.agency';
export const P_PROMOTION_MANAGE_TENANT     = 'control.promotion.manage.tenant';
export const P_PROMOTION_READ_AGENCY       = 'data.promotion.read.agency';

// ─── Facturation ─────────────────────────────────────────────────────────────
export const P_INVOICE_MANAGE_TENANT       = 'control.invoice.manage.tenant';
export const P_INVOICE_CREATE_AGENCY       = 'data.invoice.create.agency';
export const P_INVOICE_READ_AGENCY         = 'data.invoice.read.agency';
export const P_INVOICE_READ_TENANT         = 'data.invoice.read.tenant';

// ─── Quais & Annonces gare ───────────────────────────────────────────────────
export const P_PLATFORM_MANAGE_TENANT      = 'control.platform.manage.tenant';
export const P_PLATFORM_READ_AGENCY        = 'data.platform.read.agency';
export const P_ANNOUNCEMENT_MANAGE_TENANT  = 'control.announcement.manage.tenant';
export const P_ANNOUNCEMENT_READ_AGENCY    = 'data.announcement.read.agency';

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

// ─── Portail plateforme SaaS (SA / L1 / L2) ─────────────────────────────────
// Plans : création / édition / retrait des plans proposés dans le catalogue.
// Billing : gestion des souscriptions et factures plateforme → tenant.
// Metrics : lecture des agrégats analytics cross-tenant (DAU, adoption, health).
// Support : queue des tickets des tenants + répondre / assigner / escalader.
export const P_PLATFORM_PLANS_MANAGE_GLOBAL    = 'control.platform.plans.manage.global';
export const P_PLATFORM_BILLING_MANAGE_GLOBAL  = 'control.platform.billing.manage.global';
export const P_PLATFORM_METRICS_READ_GLOBAL    = 'data.platform.metrics.read.global';
export const P_PLATFORM_SUPPORT_READ_GLOBAL    = 'control.platform.support.read.global';
export const P_PLATFORM_SUPPORT_WRITE_GLOBAL   = 'control.platform.support.write.global';
export const P_PLATFORM_CONFIG_MANAGE_GLOBAL   = 'control.platform.config.manage.global';

// ─── Portail plateforme — IAM global (audit, sessions, users, MFA) ──────────
// Audit : lecture cross-tenant du journal d'accès (toutes les lignes AuditLog)
// IAM  : lecture cross-tenant des users/rôles pour support/diagnostic
// Session: révocation de n'importe quelle session active (hors plateforme)
// MFA  : reset à distance d'un TOTP (escalade utilisateur verrouillé hors de son MFA)
export const P_PLATFORM_AUDIT_READ_GLOBAL      = 'data.platform.audit.read.global';
export const P_PLATFORM_IAM_READ_GLOBAL        = 'data.platform.iam.read.global';
export const P_PLATFORM_SESSION_REVOKE_GLOBAL  = 'control.platform.session.revoke.global';
export const P_PLATFORM_MFA_RESET_GLOBAL       = 'control.platform.mfa.reset.global';
// Reset password cross-tenant (support utilisateur verrouillé sur un autre
// tenant). Mode 'link' recommandé en cross-tenant (audit plus propre) ;
// mode 'set' réservé aux escalades critiques avec justification audit.
export const P_PLATFORM_USER_RESET_PWD_GLOBAL  = 'control.platform.user.reset-password.global';

// ─── Support ticket (côté tenant client) ────────────────────────────────────
// Un utilisateur tenant peut ouvrir un ticket vers la plateforme. La
// permission tenant couvre aussi le read de ses propres tickets.
export const P_SUPPORT_CREATE_TENANT           = 'data.support.create.tenant';
export const P_SUPPORT_READ_TENANT             = 'data.support.read.tenant';

// ─── Plan du tenant (auto-service) ───────────────────────────────────────────
// Un TENANT_ADMIN peut consulter le catalogue public et basculer son plan
// dans les limites autorisées par la plateforme.
export const P_TENANT_PLAN_READ_TENANT         = 'data.tenant.plan.read.tenant';
export const P_TENANT_PLAN_CHANGE_TENANT       = 'control.tenant.plan.change.tenant';

// ─── Const object (compile-time lookup) ──────────────────────────────────────
export const Permission = {
  // IAM
  IAM_MANAGE_TENANT:          P_IAM_MANAGE_TENANT,
  IAM_AUDIT_TENANT:           P_IAM_AUDIT_TENANT,
  INTEGRATION_SETUP_TENANT:   P_INTEGRATION_SETUP_TENANT,
  USER_READ_AGENCY:           P_USER_READ_AGENCY,
  USER_RESET_PASSWORD_TENANT: P_USER_RESET_PASSWORD_TENANT,
  USER_BULK_DELETE_TENANT:    P_USER_BULK_DELETE_TENANT,
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
  TRIP_READ_AGENCY:           P_TRIP_READ_AGENCY,
  TRIP_READ_TENANT:           P_TRIP_READ_TENANT,
  TRIP_UPDATE_AGENCY:         P_TRIP_UPDATE_AGENCY,
  TRIP_CHECK_OWN:             P_TRIP_CHECK_OWN,
  TRIP_REPORT_OWN:            P_TRIP_REPORT_OWN,
  INCIDENT_REPORT_OWN:        P_INCIDENT_REPORT_OWN,
  TRIP_DELAY_AGENCY:          P_TRIP_DELAY_AGENCY,
  TRIP_DELETE_TENANT:          P_TRIP_DELETE_TENANT,
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
  MANIFEST_READ_AGENCY:       P_MANIFEST_READ_AGENCY,
  MANIFEST_GENERATE_AGENCY:   P_MANIFEST_GENERATE_AGENCY,
  MANIFEST_SIGN_AGENCY:       P_MANIFEST_SIGN_AGENCY,
  NOTIFICATION_READ_OWN:      P_NOTIFICATION_READ_OWN,
  // Fleet Tracking
  FLEET_TRACKING_MANAGE_TENANT: P_FLEET_TRACKING_MANAGE_TENANT,
  FLEET_TRACKING_CREATE_AGENCY: P_FLEET_TRACKING_CREATE_AGENCY,
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
  // Refunds
  REFUND_READ_TENANT:     P_REFUND_READ_TENANT,
  REFUND_READ_AGENCY:     P_REFUND_READ_AGENCY,
  REFUND_APPROVE_TENANT:  P_REFUND_APPROVE_TENANT,
  REFUND_APPROVE_AGENCY:  P_REFUND_APPROVE_AGENCY,
  REFUND_PROCESS_TENANT:  P_REFUND_PROCESS_TENANT,
  REFUND_REQUEST_OWN:     P_REFUND_REQUEST_OWN,
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
  QUAI_MANAGE_TENANT:         P_QUAI_MANAGE_TENANT,
  // CRM
  CRM_READ_TENANT:            P_CRM_READ_TENANT,
  CRM_READ_AGENCY:            P_CRM_READ_AGENCY,
  CRM_WRITE_TENANT:           P_CRM_WRITE_TENANT,
  CRM_WRITE_AGENCY:           P_CRM_WRITE_AGENCY,
  CRM_MERGE_TENANT:           P_CRM_MERGE_TENANT,
  CRM_DELETE_TENANT:          P_CRM_DELETE_TENANT,
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
  // Tarification
  TARIFF_MANAGE_TENANT:       P_TARIFF_MANAGE_TENANT,
  TARIFF_READ_AGENCY:         P_TARIFF_READ_AGENCY,
  PROMOTION_MANAGE_TENANT:    P_PROMOTION_MANAGE_TENANT,
  PROMOTION_READ_AGENCY:      P_PROMOTION_READ_AGENCY,
  // Facturation
  INVOICE_MANAGE_TENANT:      P_INVOICE_MANAGE_TENANT,
  INVOICE_CREATE_AGENCY:      P_INVOICE_CREATE_AGENCY,
  INVOICE_READ_AGENCY:        P_INVOICE_READ_AGENCY,
  INVOICE_READ_TENANT:        P_INVOICE_READ_TENANT,
  // Quais & Annonces
  PLATFORM_MANAGE_TENANT:     P_PLATFORM_MANAGE_TENANT,
  PLATFORM_READ_AGENCY:       P_PLATFORM_READ_AGENCY,
  ANNOUNCEMENT_MANAGE_TENANT: P_ANNOUNCEMENT_MANAGE_TENANT,
  ANNOUNCEMENT_READ_AGENCY:   P_ANNOUNCEMENT_READ_AGENCY,
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
  // Portail plateforme SaaS (SA / L1 / L2)
  PLATFORM_PLANS_MANAGE_GLOBAL:   P_PLATFORM_PLANS_MANAGE_GLOBAL,
  PLATFORM_BILLING_MANAGE_GLOBAL: P_PLATFORM_BILLING_MANAGE_GLOBAL,
  PLATFORM_METRICS_READ_GLOBAL:   P_PLATFORM_METRICS_READ_GLOBAL,
  PLATFORM_SUPPORT_READ_GLOBAL:   P_PLATFORM_SUPPORT_READ_GLOBAL,
  PLATFORM_SUPPORT_WRITE_GLOBAL:  P_PLATFORM_SUPPORT_WRITE_GLOBAL,
  PLATFORM_CONFIG_MANAGE_GLOBAL:  P_PLATFORM_CONFIG_MANAGE_GLOBAL,
  PLATFORM_AUDIT_READ_GLOBAL:     P_PLATFORM_AUDIT_READ_GLOBAL,
  PLATFORM_IAM_READ_GLOBAL:       P_PLATFORM_IAM_READ_GLOBAL,
  PLATFORM_SESSION_REVOKE_GLOBAL: P_PLATFORM_SESSION_REVOKE_GLOBAL,
  PLATFORM_MFA_RESET_GLOBAL:      P_PLATFORM_MFA_RESET_GLOBAL,
  PLATFORM_USER_RESET_PWD_GLOBAL: P_PLATFORM_USER_RESET_PWD_GLOBAL,
  // Support tenant (émetteur)
  SUPPORT_CREATE_TENANT:          P_SUPPORT_CREATE_TENANT,
  SUPPORT_READ_TENANT:            P_SUPPORT_READ_TENANT,
  // Plan tenant (auto-service)
  TENANT_PLAN_READ_TENANT:        P_TENANT_PLAN_READ_TENANT,
  TENANT_PLAN_CHANGE_TENANT:      P_TENANT_PLAN_CHANGE_TENANT,
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
