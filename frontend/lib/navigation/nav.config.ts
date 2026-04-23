/**
 * nav.config.ts — Arbre de navigation complet de tous les portails TranslogPro
 *
 * Chaque item déclare `anyOf: string[]` : la liste des permissions qui donnent
 * accès à cet item. L'utilisateur doit posséder AU MOINS UNE de ces permissions.
 * Si `anyOf` est absent, l'item est visible pour tous les utilisateurs du portail.
 *
 * Les sections disparaissent automatiquement si aucun de leurs items n'est accessible.
 *
 * Portails couverts :
 *   admin          — TENANT_ADMIN, AGENCY_MANAGER, SUPERVISOR, CASHIER + SUPER_ADMIN
 *   station-agent  — STATION_AGENT, SUPERVISOR
 *   quai-agent     — QUAI_AGENT, SUPERVISOR
 *   driver         — DRIVER
 */

import type { PortalNavConfig } from './nav.types';

// ─── Références courtes (évite de taper les strings complets) ─────────────────

const P = {
  // IAM & Config
  IAM_MANAGE:            'control.iam.manage.tenant',
  IAM_AUDIT:             'control.iam.audit.tenant',
  AGENCY_MANAGE:         'control.agency.manage.tenant',
  AGENCY_READ:           'data.agency.read.tenant',
  STATION_MANAGE:        'control.station.manage.tenant',
  STATION_READ:          'data.station.read.tenant',
  INTEGRATION_SETUP:     'control.integration.setup.tenant',
  MODULE_INSTALL:        'control.module.install.tenant',
  SETTINGS_MANAGE:       'control.settings.manage.tenant',
  WORKFLOW_STUDIO_READ:  'control.workflow.studio.read.tenant',
  WORKFLOW_STUDIO_WRITE: 'control.workflow.studio.write.tenant',
  WORKFLOW_SIMULATE:     'control.workflow.simulate.tenant',
  WORKFLOW_MARKETPLACE:  'control.workflow.marketplace.read.tenant',
  // Routes & Trips
  ROUTE_MANAGE:          'control.route.manage.tenant',
  TRIP_CREATE:           'data.trip.create.tenant',
  TRIP_UPDATE:           'data.trip.update.agency',
  TRIP_DELAY:            'control.trip.delay.agency',
  TRIP_CANCEL:           'control.trip.cancel.tenant',
  TRIP_READ_OWN:         'data.trip.read.own',
  TRIP_READ_TENANT:      'data.trip.read.tenant',
  TRIP_CHECK_OWN:        'data.trip.check.own',
  TRIP_REPORT_OWN:       'data.trip.report.own',
  TRIP_LOG_EVENT:        'control.trip.log_event.own',
  // Tickets
  TICKET_CREATE:         'data.ticket.create.agency',
  TICKET_READ_AGENCY:    'data.ticket.read.agency',
  TICKET_READ_TENANT:    'data.ticket.read.tenant',
  TICKET_SCAN:           'data.ticket.scan.agency',
  TICKET_CANCEL:         'data.ticket.cancel.agency',
  TICKET_PRINT:          'data.ticket.print.agency',
  TRAVELER_VERIFY:       'data.traveler.verify.agency',
  LUGGAGE_WEIGH:         'data.luggage.weigh.agency',
  // Parcels
  PARCEL_CREATE:         'data.parcel.create.agency',
  PARCEL_SCAN:           'data.parcel.scan.agency',
  PARCEL_UPDATE_AGENCY:  'data.parcel.update.agency',
  PARCEL_UPDATE_TENANT:  'data.parcel.update.tenant',
  PARCEL_REPORT:         'data.parcel.report.agency',
  PARCEL_PRINT:          'data.parcel.print.agency',
  PARCEL_READ_OWN:       'data.parcel.read.own',
  PARCEL_TRACK_OWN:      'data.parcel.track.own',
  SHIPMENT_GROUP:        'data.shipment.group.agency',
  // Customer self-service
  TICKET_READ_OWN:       'data.ticket.read.own',
  SAV_REPORT_OWN:        'data.sav.report.own',
  INCIDENT_REPORT_OWN:   'data.incident.report.own',
  // Fleet
  FLEET_MANAGE:          'control.fleet.manage.tenant',
  FLEET_LAYOUT:          'control.fleet.layout.tenant',
  FLEET_STATUS:          'data.fleet.status.agency',
  FLEET_TRACKING:        'data.fleet.tracking.tenant',
  FLEET_TRACKING_CREATE: 'data.fleet.tracking_create.agency',
  MAINTENANCE_UPDATE:    'data.maintenance.update.own',
  MAINTENANCE_APPROVE:   'data.maintenance.approve.tenant',
  // Manifests
  MANIFEST_READ_OWN:     'data.manifest.read.own',
  MANIFEST_GENERATE:     'data.manifest.generate.agency',
  MANIFEST_SIGN:         'data.manifest.sign.agency',
  MANIFEST_PRINT:        'data.manifest.print.agency',
  // Finance
  PRICING_MANAGE:        'control.pricing.manage.tenant',
  PRICING_YIELD:         'control.pricing.yield.tenant',
  PRICING_READ:          'data.pricing.read.agency',
  PROFITABILITY_READ_TENANT: 'data.profitability.read.tenant',
  CASHIER_OPEN:          'data.cashier.open.own',
  CASHIER_TX:            'data.cashier.transaction.own',
  CASHIER_CLOSE:         'data.cashier.close.agency',
  INVOICE_PRINT:         'data.invoice.print.agency',
  // SAV
  SAV_REPORT:            'data.sav.report.agency',
  SAV_CLAIM:             'data.sav.claim.tenant',
  SAV_DELIVER:           'data.sav.deliver.agency',
  REFUND_READ:           'data.refund.read.tenant',
  // Vouchers (2026-04-19)
  VOUCHER_READ_TENANT:   'data.voucher.read.tenant',
  VOUCHER_READ_OWN:      'data.voucher.read.own',
  VOUCHER_ISSUE_TENANT:  'control.voucher.issue.tenant',
  VOUCHER_ISSUE_AGENCY:  'data.voucher.issue.agency',
  VOUCHER_REDEEM_AGENCY: 'data.voucher.redeem.agency',
  // Staff & Crew
  STAFF_MANAGE:          'control.staff.manage.tenant',
  STAFF_READ:            'data.staff.read.agency',
  CREW_MANAGE:           'data.crew.manage.tenant',
  // CRM
  CRM_READ:              'data.crm.read.tenant',
  CAMPAIGN_MANAGE:       'control.campaign.manage.tenant',
  FEEDBACK_SUBMIT:       'data.feedback.submit.own',
  // Safety & Stats
  STATS_READ:            'control.stats.read.tenant',
  SAFETY_MONITOR:        'control.safety.monitor.global',
  // Display
  DISPLAY_UPDATE:        'data.display.update.agency',
  // Templates & Docs
  TEMPLATE_READ:         'data.template.read.agency',
  TEMPLATE_WRITE:        'data.template.write.agency',
  // Platform (SUPER_ADMIN / SUPPORT_L1 / SUPPORT_L2)
  TENANT_MANAGE:         'control.tenant.manage.global',
  PLATFORM_STAFF:        'control.platform.staff.global',
  IMPERSONATION_SWITCH:  'control.impersonation.switch.global',
  WORKFLOW_DEBUG:        'data.workflow.debug.global',
  OUTBOX_REPLAY:         'data.outbox.replay.global',
  PLATFORM_PLANS_MANAGE:   'control.platform.plans.manage.global',
  PLATFORM_BILLING_MANAGE: 'control.platform.billing.manage.global',
  PLATFORM_METRICS_READ:   'data.platform.metrics.read.global',
  PLATFORM_KPI_ADOPTION:   'data.platform.kpi.adoption.read.global',
  PLATFORM_SUPPORT_READ:   'control.platform.support.read.global',
  PLATFORM_CONFIG_MANAGE:  'control.platform.config.manage.global',
  PLATFORM_AUDIT_READ:     'data.platform.audit.read.global',
  PLATFORM_IAM_READ:       'data.platform.iam.read.global',
  PLATFORM_SESSION_REVOKE: 'control.platform.session.revoke.global',
  // Support (côté tenant)
  SUPPORT_CREATE_TENANT: 'data.support.create.tenant',
  SUPPORT_READ_TENANT:   'data.support.read.tenant',
  // Session
  SESSION_REVOKE_TENANT: 'data.session.revoke.tenant',
  // Driver & HR (Fleet Docs, rest, training, remediation)
  DRIVER_MANAGE:         'control.driver.manage.tenant',
  DRIVER_PROFILE:        'data.driver.profile.agency',
  DRIVER_REST_OWN:       'data.driver.rest.own',
  // QHSE & Accidents
  QHSE_MANAGE:           'control.qhse.manage.tenant',
  ACCIDENT_REPORT:       'data.accident.report.own',
  // Tarification
  TARIFF_MANAGE:         'control.tariff.manage.tenant',
  TARIFF_READ:           'data.tariff.read.agency',
  PROMOTION_MANAGE:      'control.promotion.manage.tenant',
  PROMOTION_READ:        'data.promotion.read.agency',
  // Facturation
  INVOICE_MANAGE:        'control.invoice.manage.tenant',
  INVOICE_CREATE:        'data.invoice.create.agency',
  INVOICE_READ:          'data.invoice.read.agency',
  INVOICE_READ_TENANT:   'data.invoice.read.tenant',
  // Taxes & Fiscalité
  TAX_READ:              'data.tax.read.tenant',
  TAX_MANAGE:            'control.tax.manage.tenant',
  // Classes de voyage (TenantFareClass)
  FARE_CLASS_READ:       'data.fareClass.read.tenant',
  FARE_CLASS_MANAGE:     'control.fareClass.manage.tenant',
  // Périodes peak (calendrier yield)
  PEAK_PERIOD_READ:      'data.peakPeriod.read.tenant',
  PEAK_PERIOD_MANAGE:    'control.peakPeriod.manage.tenant',
  // Quais & Annonces
  PLATFORM_MANAGE:       'control.platform.manage.tenant',
  PLATFORM_READ:         'data.platform.read.agency',
  ANNOUNCEMENT_MANAGE:   'control.announcement.manage.tenant',
  ANNOUNCEMENT_READ:     'data.announcement.read.agency',
  // Bulk Import
  BULK_IMPORT:           'control.bulk.import.tenant',
  // Backup & RGPD
  BACKUP_READ:           'data.backup.read.tenant',
};

// ─── Portail Admin ─────────────────────────────────────────────────────────────
// Structure L0 → L1 → L2 :
//   NavSection (icon + title, accordion L0)
//   └── NavGroup  (icon + label, accordion L1)
//        └── NavLeaf (lien final L2)
//
// Notifications et Aide & Support sont dans la bottom bar d'AdminDashboard
// (pas dans la nav — toujours visibles pour tout staff connecté).
//
// Adaptation par rôle : automatique via anyOf permissions.
// Caissier → voit COMMERCE (ventes/caisse) + TABLEAU DE BORD uniquement.
// Chauffeur → ne rentre pas dans ce portail (utilise DRIVER_NAV).
// Agency Manager → voit OPÉRATIONS + COMMERCE + RESSOURCES + ANALYTICS.
// Tenant Admin → voit tout.

export const ADMIN_NAV: PortalNavConfig = {
  portalId: 'admin',
  sections: [

    // ── Tableau de bord ──────────────────────────────────────────────────────
    // Section à item unique → rendu direct (pas d'accordion).
    {
      id: 'dashboard',
      title: 'nav.dashboard',
      icon: 'LayoutDashboard',
      anyOf: [
        P.STATS_READ, P.TRIP_UPDATE, P.TICKET_READ_TENANT,
        P.CASHIER_OPEN, P.CASHIER_TX, P.TICKET_CREATE,
        P.PARCEL_CREATE, P.STAFF_READ, P.DRIVER_PROFILE,
      ],
      items: [
        {
          kind: 'leaf',
          id: 'dashboard',
          label: 'nav.dashboard',
          href: '/admin',
          icon: 'LayoutDashboard',
          anyOf: [
            P.STATS_READ, P.TRIP_UPDATE, P.TICKET_READ_TENANT,
            P.CASHIER_OPEN, P.CASHIER_TX, P.TICKET_CREATE,
            P.PARCEL_CREATE, P.STAFF_READ, P.DRIVER_PROFILE,
          ],
        },
      ],
    },

    // ── OPÉRATIONS ───────────────────────────────────────────────────────────
    // Icône : Route — les routes/trajets sont l'essence du transport.
    // Profil cashier : ne voit aucun groupe (pas de perm trip/parcel/display).
    // Profil supervisor : voit Flux Passagers + Logistique + Affichage.
    {
      id: 'operations',
      title: 'nav.operations',
      icon: 'Route',
      anyOf: [
        P.TRIP_CREATE, P.TRIP_UPDATE, P.ROUTE_MANAGE, P.TRIP_DELAY,
        P.PARCEL_CREATE, P.PARCEL_UPDATE_AGENCY, P.SHIPMENT_GROUP, P.MANIFEST_GENERATE,
        P.STATION_MANAGE, P.STATION_READ, P.PLATFORM_MANAGE, P.PLATFORM_READ,
        P.DISPLAY_UPDATE, P.ANNOUNCEMENT_MANAGE, P.ANNOUNCEMENT_READ,
      ],
      items: [
        {
          kind: 'group',
          id: 'passenger-flow',
          label: { fr: 'Flux Passagers', en: 'Passenger Flow' },
          icon: 'Users',
          anyOf: [P.TRIP_CREATE, P.TRIP_UPDATE, P.ROUTE_MANAGE, P.TRIP_DELAY, P.TRIP_CANCEL],
          children: [
            { kind: 'leaf', id: 'trips-list',     label: 'nav.today_s_trips',    href: '/admin/trips',          icon: 'List',          anyOf: [P.TRIP_UPDATE, P.TRIP_CREATE] },
            { kind: 'leaf', id: 'trips-planning', label: 'nav.weekly_planning',  href: '/admin/trips/planning', icon: 'CalendarDays',  anyOf: [P.TRIP_CREATE, P.ROUTE_MANAGE] },
            { kind: 'leaf', id: 'trips-scheduler', label: 'nav.recurring_trips', href: '/admin/trips/scheduler', icon: 'Repeat',       anyOf: [P.TRIP_CREATE, P.TRIP_READ_TENANT] },
            { kind: 'leaf', id: 'trips-delays',   label: 'nav.delays_alerts',    href: '/admin/trips/delays',   icon: 'AlertTriangle', anyOf: [P.TRIP_DELAY, P.TRIP_UPDATE] },
          ],
        },
        {
          kind: 'group',
          id: 'logistics',
          label: 'nav.parcels_logistics',
          icon: 'Package',
          anyOf: [P.PARCEL_CREATE, P.PARCEL_UPDATE_AGENCY, P.PARCEL_UPDATE_TENANT, P.SHIPMENT_GROUP, P.MANIFEST_GENERATE],
          children: [
            { kind: 'leaf', id: 'parcel-new',   label: 'nav.register_parcel',   href: '/admin/parcels/new',  icon: 'PackagePlus',   anyOf: [P.PARCEL_CREATE] },
            { kind: 'leaf', id: 'parcels-list', label: 'nav.track_parcels',     href: '/admin/parcels',      icon: 'Truck',         anyOf: [P.PARCEL_UPDATE_AGENCY, P.PARCEL_UPDATE_TENANT] },
            { kind: 'leaf', id: 'shipments',    label: 'nav.group_shipments',   href: '/admin/shipments',    icon: 'Boxes',         anyOf: [P.SHIPMENT_GROUP] },
            { kind: 'leaf', id: 'manifests',    label: 'nav.manifests',         href: '/admin/manifests',    icon: 'ClipboardList', anyOf: [P.MANIFEST_GENERATE, P.MANIFEST_READ_OWN] },
          ],
        },
        {
          kind: 'group',
          id: 'infrastructure',
          label: { fr: 'Infrastructure & Info', en: 'Infrastructure & Info' },
          icon: 'MapPin',
          anyOf: [P.STATION_MANAGE, P.STATION_READ, P.ROUTE_MANAGE, P.PLATFORM_MANAGE, P.PLATFORM_READ],
          children: [
            { kind: 'leaf', id: 'stations',  label: 'nav.stations',            href: '/admin/stations',   icon: 'MapPin',    anyOf: [P.STATION_MANAGE, P.STATION_READ] },
            { kind: 'leaf', id: 'platforms', label: 'nav.platform_management', href: '/admin/platforms',  icon: 'MapPinned', anyOf: [P.PLATFORM_MANAGE, P.PLATFORM_READ] },
            { kind: 'leaf', id: 'routes',    label: 'nav.routes_lines',        href: '/admin/routes',     icon: 'Route',     anyOf: [P.ROUTE_MANAGE] },
          ],
        },
        {
          kind: 'group',
          id: 'display',
          label: 'nav.display_station',
          icon: 'Monitor',
          anyOf: [P.DISPLAY_UPDATE, P.PLATFORM_MANAGE, P.PLATFORM_READ, P.ANNOUNCEMENT_MANAGE, P.ANNOUNCEMENT_READ],
          children: [
            { kind: 'leaf', id: 'display-screens',       label: 'nav.screens_displays',      href: '/admin/display',               icon: 'Monitor',  anyOf: [P.DISPLAY_UPDATE] },
            { kind: 'leaf', id: 'display-quais',         label: 'nav.platform_display',      href: '/admin/display/quais',         icon: 'MapPinned', anyOf: [P.PLATFORM_MANAGE, P.PLATFORM_READ, P.TRIP_UPDATE, P.DISPLAY_UPDATE] },
            { kind: 'leaf', id: 'display-bus',           label: 'nav.bus_onboard_display',   href: '/admin/display/bus',           icon: 'Bus',      anyOf: [P.DISPLAY_UPDATE, P.FLEET_MANAGE, P.FLEET_STATUS] },
            { kind: 'leaf', id: 'display-announcements', label: 'nav.station_announcements', href: '/admin/display/announcements', icon: 'Volume2',  anyOf: [P.ANNOUNCEMENT_MANAGE, P.ANNOUNCEMENT_READ, P.DISPLAY_UPDATE] },
          ],
        },
      ],
    },

    // ── COMMERCE & SAV ───────────────────────────────────────────────────────
    // Icône : Ticket — le billet est le cœur du commerce transport.
    // Profil cashier : voit uniquement Ventes & Caisse (ses perms).
    // Profil supervisor : voit Ventes + SAV.
    {
      id: 'commerce',
      title: { fr: 'Commerce & SAV', en: 'Commerce & Customer Service' },
      icon: 'Ticket',
      anyOf: [
        P.TICKET_CREATE, P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT,
        P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE,
        P.SAV_CLAIM, P.SAV_REPORT, P.SAV_DELIVER, P.REFUND_READ,
        P.VOUCHER_READ_TENANT, P.VOUCHER_ISSUE_AGENCY,
        P.CRM_READ, P.CAMPAIGN_MANAGE,
      ],
      items: [
        {
          kind: 'group',
          id: 'sales-cashier',
          label: { fr: 'Ventes & Caisse', en: 'Sales & Cashier' },
          icon: 'Landmark',
          anyOf: [
            P.TICKET_CREATE, P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT,
            P.TICKET_CANCEL, P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE,
          ],
          children: [
            { kind: 'leaf', id: 'tickets-new',        label: 'nav.sell_ticket',        href: '/admin/tickets/new',        icon: 'Plus',          anyOf: [P.TICKET_CREATE] },
            { kind: 'leaf', id: 'tickets-list',       label: 'nav.issued_tickets',     href: '/admin/tickets',            icon: 'List',          anyOf: [P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT] },
            { kind: 'leaf', id: 'tickets-cancel',     label: 'nav.cancellations',      href: '/admin/tickets/cancel',     icon: 'XCircle',       anyOf: [P.TICKET_CANCEL] },
            { kind: 'leaf', id: 'cashier',            label: 'nav.cashier',            href: '/admin/cashier',            icon: 'Landmark',      anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE] },
            { kind: 'leaf', id: 'cash-discrepancies', label: 'nav.cash_discrepancies', href: '/admin/cash-discrepancies', icon: 'AlertTriangle', anyOf: [P.CASHIER_CLOSE, P.STATS_READ] },
          ],
        },
        {
          kind: 'group',
          id: 'sav',
          label: { fr: 'Support & SAV', en: 'Support & Customer Service' },
          icon: 'LifeBuoy',
          anyOf: [P.SAV_CLAIM, P.SAV_REPORT, P.SAV_DELIVER, P.REFUND_READ, P.VOUCHER_READ_TENANT, P.VOUCHER_ISSUE_AGENCY],
          moduleKey: 'SAV_MODULE',
          children: [
            { kind: 'leaf', id: 'sav-claims',  label: 'nav.claims',   href: '/admin/sav/claims',   icon: 'FileWarning', anyOf: [P.SAV_CLAIM] },
            { kind: 'leaf', id: 'sav-reports', label: 'nav.reports',  href: '/admin/sav/reports',  icon: 'Flag',        anyOf: [P.SAV_REPORT] },
            { kind: 'leaf', id: 'sav-returns', label: 'nav.refunds',  href: '/admin/sav/returns',  icon: 'RotateCcw',   anyOf: [P.REFUND_READ] },
            { kind: 'leaf', id: 'vouchers',    label: 'nav.vouchers', href: '/admin/sav/vouchers', icon: 'Gift',        anyOf: [P.VOUCHER_READ_TENANT, P.VOUCHER_ISSUE_AGENCY] },
          ],
        },
        {
          kind: 'group',
          id: 'crm',
          label: { fr: 'CRM & Marketing', en: 'CRM & Marketing' },
          icon: 'Users2',
          anyOf: [P.CRM_READ, P.CAMPAIGN_MANAGE],
          moduleKey: 'CRM',
          children: [
            { kind: 'leaf', id: 'crm-clients',   label: 'nav.customers_crm',   href: '/admin/crm',           icon: 'Users2',        anyOf: [P.CRM_READ] },
            { kind: 'leaf', id: 'crm-campaigns', label: 'nav.campaigns',       href: '/admin/crm/campaigns', icon: 'Megaphone',     anyOf: [P.CAMPAIGN_MANAGE] },
            { kind: 'leaf', id: 'crm-loyalty',   label: 'nav.loyalty_program', href: '/admin/crm/loyalty',   icon: 'Star',          anyOf: [P.CRM_READ], wip: true },
            { kind: 'leaf', id: 'crm-feedback',  label: 'nav.reviews_feedback',href: '/admin/crm/feedback',  icon: 'MessageCircle', anyOf: [P.CRM_READ] },
          ],
        },
      ],
    },

    // ── RESSOURCES ───────────────────────────────────────────────────────────
    // Icône : Bus — le véhicule EST la ressource principale en transport.
    // Flotte + Personnel + Maintenance : tout ce qui fait rouler le bus.
    // Crew (planning, calendrier, briefing) aplati dans Personnel & Équipages.
    {
      id: 'resources',
      title: { fr: 'Ressources', en: 'Resources' },
      icon: 'Bus',
      anyOf: [
        P.FLEET_MANAGE, P.FLEET_LAYOUT, P.FLEET_STATUS, P.FLEET_TRACKING,
        P.MAINTENANCE_APPROVE, P.MAINTENANCE_UPDATE,
        P.DRIVER_MANAGE, P.DRIVER_PROFILE, P.CREW_MANAGE, P.STAFF_MANAGE, P.STAFF_READ,
      ],
      items: [
        {
          kind: 'group',
          id: 'fleet',
          label: { fr: 'Flotte (Garage)', en: 'Fleet (Garage)' },
          icon: 'Truck',
          anyOf: [P.FLEET_MANAGE, P.FLEET_LAYOUT, P.FLEET_STATUS, P.FLEET_TRACKING, P.FLEET_TRACKING_CREATE],
          children: [
            { kind: 'leaf', id: 'fleet-vehicles', label: 'nav.vehicles',              href: '/admin/fleet',          icon: 'Bus',        anyOf: [P.FLEET_MANAGE, P.FLEET_STATUS] },
            { kind: 'leaf', id: 'fleet-tracking', label: 'nav.mileage_fuel',          href: '/admin/fleet/tracking', icon: 'Gauge',      anyOf: [P.FLEET_MANAGE, P.FLEET_STATUS, P.FLEET_TRACKING, P.FLEET_TRACKING_CREATE] },
            { kind: 'leaf', id: 'fleet-seats',    label: 'nav.seat_plans',            href: '/admin/fleet/seats',    icon: 'LayoutGrid', anyOf: [P.FLEET_LAYOUT] },
            { kind: 'leaf', id: 'fleet-docs',     label: 'nav.documents_consumables', href: '/admin/fleet-docs',     icon: 'FileCheck',  anyOf: [P.FLEET_MANAGE, P.DRIVER_MANAGE], moduleKey: 'FLEET_DOCS' },
          ],
        },
        {
          // crew.children aplanis ici — plus de groupe imbriqué dans un groupe.
          kind: 'group',
          id: 'staff-crew',
          label: { fr: 'Personnel & Équipages', en: 'Staff & Crew' },
          icon: 'UsersRound',
          anyOf: [P.CREW_MANAGE, P.STAFF_MANAGE, P.STAFF_READ, P.DRIVER_MANAGE, P.DRIVER_PROFILE],
          children: [
            { kind: 'leaf', id: 'staff-list',      label: 'nav.all_staff',               href: '/admin/staff',                icon: 'Users',          anyOf: [P.STAFF_MANAGE, P.STAFF_READ] },
            { kind: 'leaf', id: 'drivers',         label: 'nav.drivers',                 href: '/admin/drivers',              icon: 'Steer',          anyOf: [P.CREW_MANAGE, P.STAFF_MANAGE, P.DRIVER_MANAGE, P.DRIVER_PROFILE], moduleKey: 'DRIVER_PROFILE' },
            { kind: 'leaf', id: 'driver-scoring',  label: 'nav.driver_scoring',          href: '/admin/drivers/scoring',      icon: 'Trophy',         anyOf: [P.DRIVER_PROFILE, P.STAFF_MANAGE, P.CREW_MANAGE], moduleKey: 'DRIVER_PROFILE' },
            { kind: 'leaf', id: 'crew-planning',   label: 'nav.crew_planning',           href: '/admin/crew/planning',        icon: 'CalendarRange',  anyOf: [P.CREW_MANAGE], moduleKey: 'CREW_BRIEFING' },
            { kind: 'leaf', id: 'driver-calendar', label: 'nav.driver_calendar',         href: '/admin/crew/driver-calendar', icon: 'CalendarDays',   anyOf: [P.TRIP_READ_TENANT, P.CREW_MANAGE, P.STAFF_READ] },
            { kind: 'leaf', id: 'crew-briefing',   label: 'nav.pre_departure_briefings', href: '/admin/crew/briefing',        icon: 'ClipboardCheck', anyOf: [P.CREW_MANAGE], moduleKey: 'CREW_BRIEFING' },
          ],
        },
        {
          kind: 'group',
          id: 'maintenance',
          label: 'nav.maintenance_garage',
          icon: 'Wrench',
          anyOf: [P.MAINTENANCE_APPROVE, P.MAINTENANCE_UPDATE],
          moduleKey: 'GARAGE_PRO',
          children: [
            { kind: 'leaf', id: 'maintenance-list',     label: 'nav.maintenance_sheets', href: '/admin/maintenance',          icon: 'ClipboardCheck', anyOf: [P.MAINTENANCE_APPROVE] },
            { kind: 'leaf', id: 'maintenance-planning', label: 'nav.garage_planning',    href: '/admin/maintenance/planning', icon: 'CalendarClock',  anyOf: [P.MAINTENANCE_APPROVE] },
            { kind: 'leaf', id: 'maintenance-alerts',   label: 'nav.technical_alerts',   href: '/admin/maintenance/alerts',   icon: 'AlertCircle',    anyOf: [P.MAINTENANCE_APPROVE, P.FLEET_STATUS] },
          ],
        },
      ],
    },

    // ── STRATÉGIE & PRIX ─────────────────────────────────────────────────────
    // Icône : TrendingUp — tarification et rentabilité.
    // Facturation + Taxes déplacées ici depuis l'ancienne section Finance.
    {
      id: 'strategy',
      title: { fr: 'Stratégie & Prix', en: 'Strategy & Pricing' },
      icon: 'TrendingUp',
      anyOf: [
        P.PRICING_MANAGE, P.PRICING_YIELD, P.PRICING_READ,
        P.TARIFF_MANAGE, P.TARIFF_READ, P.PROMOTION_MANAGE, P.PROMOTION_READ,
        P.FARE_CLASS_READ, P.FARE_CLASS_MANAGE, P.PEAK_PERIOD_READ, P.PEAK_PERIOD_MANAGE,
        P.INVOICE_PRINT, P.INVOICE_READ, P.INVOICE_READ_TENANT, P.INVOICE_MANAGE,
        P.TAX_READ, P.TAX_MANAGE, P.SETTINGS_MANAGE,
      ],
      items: [
        {
          kind: 'group',
          id: 'pricing',
          label: 'nav.pricing_and_classes',
          icon: 'Tags',
          anyOf: [
            P.PRICING_MANAGE, P.PRICING_YIELD, P.PRICING_READ,
            P.TARIFF_MANAGE, P.TARIFF_READ, P.PROMOTION_MANAGE, P.PROMOTION_READ,
            P.FARE_CLASS_READ, P.FARE_CLASS_MANAGE, P.PEAK_PERIOD_READ, P.PEAK_PERIOD_MANAGE,
          ],
          children: [
            { kind: 'leaf', id: 'pricing-grid',        label: 'nav.pricing_grid',     href: '/admin/pricing',               icon: 'Grid3x3',    anyOf: [P.TARIFF_MANAGE, P.TARIFF_READ, P.PRICING_MANAGE, P.PRICING_READ] },
            { kind: 'leaf', id: 'pricing-simulator',   label: 'nav.pricing_simulator', href: '/admin/pricing/simulator',    icon: 'Calculator', anyOf: [P.PROFITABILITY_READ_TENANT] },
            { kind: 'leaf', id: 'pricing-yield',       label: 'nav.yield_management', href: '/admin/pricing/yield',         icon: 'TrendingUp', anyOf: [P.PRICING_YIELD], moduleKey: 'YIELD_ENGINE' },
            { kind: 'leaf', id: 'pricing-promo',       label: 'nav.promotions',       href: '/admin/pricing/promo',         icon: 'Percent',    anyOf: [P.PROMOTION_MANAGE, P.PROMOTION_READ] },
            { kind: 'leaf', id: 'tenant-fare-classes', label: 'nav.fare_classes',     href: '/admin/settings/fare-classes', icon: 'Tags',       anyOf: [P.FARE_CLASS_READ, P.FARE_CLASS_MANAGE] },
            { kind: 'leaf', id: 'peak-periods',        label: 'nav.peak_periods',     href: '/admin/settings/peak-periods', icon: 'Calendar',   anyOf: [P.PEAK_PERIOD_READ, P.PEAK_PERIOD_MANAGE] },
          ],
        },
        {
          kind: 'group',
          id: 'finance-taxes',
          label: 'nav.finance_fiscality',
          icon: 'Receipt',
          anyOf: [
            P.INVOICE_PRINT, P.INVOICE_READ, P.INVOICE_READ_TENANT, P.INVOICE_MANAGE,
            P.TAX_READ, P.TAX_MANAGE, P.SETTINGS_MANAGE,
          ],
          children: [
            { kind: 'leaf', id: 'invoices',       label: 'nav.invoicing',         href: '/admin/invoices',         icon: 'Receipt',    anyOf: [P.INVOICE_PRINT, P.INVOICE_READ, P.INVOICE_READ_TENANT, P.INVOICE_MANAGE] },
            { kind: 'leaf', id: 'tenant-taxes',   label: 'nav.taxes_fiscality',   href: '/admin/settings/taxes',   icon: 'Calculator', anyOf: [P.TAX_READ, P.TAX_MANAGE] },
            { kind: 'leaf', id: 'tenant-rules',   label: 'nav.business_rules',    href: '/admin/settings/rules',   icon: 'ScrollText', anyOf: [P.SETTINGS_MANAGE] },
            { kind: 'leaf', id: 'tenant-payment', label: 'nav.payment_settings',  href: '/admin/settings/payment', icon: 'CreditCard', anyOf: [P.SETTINGS_MANAGE] },
          ],
        },
      ],
    },

    // ── QHSE & SÉCURITÉ ──────────────────────────────────────────────────────
    // Icône : ShieldCheck — sécurité et conformité opérationnelle.
    // Incidents de sécurité + QHSE regroupés (tous liés aux risques terrain).
    {
      id: 'qhse',
      title: 'nav.qhse',
      icon: 'ShieldCheck',
      anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT, P.SAFETY_MONITOR, P.SAV_REPORT],
      items: [
        {
          kind: 'group',
          id: 'risks-audit',
          label: { fr: 'Risques & Audit', en: 'Risks & Audit' },
          icon: 'AlertOctagon',
          anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT, P.SAFETY_MONITOR, P.SAV_REPORT],
          children: [
            { kind: 'leaf', id: 'qhse',             label: 'nav.qhse_accidents', href: '/admin/qhse',             icon: 'AlertOctagon', anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT], moduleKey: 'QHSE' },
            { kind: 'leaf', id: 'safety-incidents', label: 'nav.incidents',      href: '/admin/safety/incidents', icon: 'ShieldAlert',  anyOf: [P.SAFETY_MONITOR, P.SAV_REPORT] },
            { kind: 'leaf', id: 'safety-monitor',   label: 'nav.live_monitoring',href: '/admin/safety',           icon: 'Radar',        anyOf: [P.SAFETY_MONITOR] },
            { kind: 'leaf', id: 'safety-sos',       label: 'nav.sos_alerts',     href: '/admin/safety/sos',       icon: 'Siren',        anyOf: [P.SAFETY_MONITOR] },
          ],
        },
      ],
    },

    // ── ANALYTICS & BI ───────────────────────────────────────────────────────
    // Icône : BarChart3 — données et prévisions.
    // Note : PageAnalytics a des données mock (REVENUE, PASSENGERS_BY_LINE,
    // TICKETS_BY_CHANNEL, PARCELS_BY_WEIGHT) — à remplacer par API.
    // PageAiRoutes utilise déjà /api/tenants/:id/analytics/ai-routes.
    {
      id: 'analytics',
      title: 'nav.intelligence',
      icon: 'BarChart3',
      anyOf: [P.STATS_READ],
      items: [
        {
          kind: 'group',
          id: 'performance',
          label: { fr: 'Pilotage Performance', en: 'Performance Tracking' },
          icon: 'LineChart',
          anyOf: [P.STATS_READ],
          children: [
            { kind: 'leaf', id: 'analytics',   label: 'nav.analytics',        href: '/admin/analytics',            icon: 'BarChart3',    anyOf: [P.STATS_READ] },
            { kind: 'leaf', id: 'seasonality', label: 'nav.seasonality',      href: '/admin/analytics/seasonality',icon: 'CalendarRange',anyOf: [P.STATS_READ] },
            { kind: 'leaf', id: 'reports',     label: 'nav.periodic_reports', href: '/admin/reports',              icon: 'FileBarChart', anyOf: [P.STATS_READ] },
          ],
        },
        {
          kind: 'group',
          id: 'ai',
          label: 'nav.ai_recommendations',
          icon: 'Brain',
          anyOf: [P.STATS_READ],
          children: [
            { kind: 'leaf', id: 'ai-routes',  label: 'nav.route_profitability', href: '/admin/ai/routes',  icon: 'TrendingUp', anyOf: [P.STATS_READ] },
            { kind: 'leaf', id: 'ai-fleet',   label: 'nav.fleet_optimization',  href: '/admin/ai/fleet',   icon: 'Bus',        anyOf: [P.STATS_READ, P.FLEET_MANAGE] },
            { kind: 'leaf', id: 'ai-demand',  label: 'nav.demand_forecast',     href: '/admin/ai/demand',  icon: 'Activity',   anyOf: [P.STATS_READ] },
            { kind: 'leaf', id: 'ai-pricing', label: 'nav.dynamic_pricing',     href: '/admin/ai/pricing', icon: 'Zap',        anyOf: [P.PRICING_YIELD, P.STATS_READ] },
          ],
        },
      ],
    },

    // ── CONFIGURATION ────────────────────────────────────────────────────────
    // Icône : SlidersHorizontal — paramètres et configuration tenant.
    // Workflow Studio + Documents + Structure + IAM + Écosystème & Portail.
    {
      id: 'config',
      title: 'nav.configuration',
      icon: 'SlidersHorizontal',
      anyOf: [
        P.WORKFLOW_STUDIO_READ, P.WORKFLOW_STUDIO_WRITE, P.WORKFLOW_SIMULATE,
        P.MODULE_INSTALL, P.SETTINGS_MANAGE, P.INTEGRATION_SETUP,
        P.IAM_MANAGE, P.IAM_AUDIT,
        P.TEMPLATE_WRITE, P.TEMPLATE_READ,
        P.AGENCY_MANAGE, P.AGENCY_READ,
        P.BULK_IMPORT,
      ],
      items: [
        {
          kind: 'group',
          id: 'workflow-studio',
          label: 'nav.workflow_studio',
          icon: 'GitFork',
          anyOf: [P.WORKFLOW_STUDIO_READ, P.WORKFLOW_STUDIO_WRITE, P.WORKFLOW_SIMULATE, P.WORKFLOW_MARKETPLACE],
          moduleKey: 'WORKFLOW_STUDIO',
          children: [
            { kind: 'leaf', id: 'wf-designer',    label: 'nav.workflow_editor', href: '/admin/workflow-studio',            icon: 'PenLine',    anyOf: [P.WORKFLOW_STUDIO_WRITE] },
            { kind: 'leaf', id: 'wf-blueprints',  label: 'nav.blueprints',      href: '/admin/workflow-studio/blueprints', icon: 'ScrollText', anyOf: [P.WORKFLOW_STUDIO_READ] },
            { kind: 'leaf', id: 'wf-marketplace', label: 'nav.marketplace',     href: '/admin/workflow-studio/market',     icon: 'Store',      anyOf: [P.WORKFLOW_MARKETPLACE] },
            { kind: 'leaf', id: 'wf-simulate',    label: 'nav.simulator',       href: '/admin/workflow-studio/simulate',   icon: 'PlayCircle', anyOf: [P.WORKFLOW_SIMULATE] },
          ],
        },
        {
          kind: 'group',
          id: 'documents',
          label: { fr: 'Documents Officiels', en: 'Official Documents' },
          icon: 'FileText',
          anyOf: [P.TEMPLATE_WRITE, P.TEMPLATE_READ],
          children: [
            { kind: 'leaf', id: 'documents-templates', label: 'nav.document_templates', href: '/admin/templates', icon: 'FileType', anyOf: [P.TEMPLATE_WRITE, P.TEMPLATE_READ] },
          ],
        },
        {
          kind: 'group',
          id: 'structure',
          label: { fr: 'Structure', en: 'Structure' },
          icon: 'Building2',
          anyOf: [P.AGENCY_MANAGE, P.AGENCY_READ, P.MODULE_INSTALL, P.SETTINGS_MANAGE],
          children: [
            { kind: 'leaf', id: 'agencies',      label: 'nav.agencies',          href: '/admin/settings/agencies', icon: 'Building2',  anyOf: [P.AGENCY_MANAGE, P.AGENCY_READ] },
            { kind: 'leaf', id: 'modules',       label: 'nav.modules_extensions', href: '/admin/modules',          icon: 'Puzzle',     anyOf: [P.MODULE_INSTALL] },
            { kind: 'leaf', id: 'tenant-company',label: 'nav.company_info',      href: '/admin/settings/company',  icon: 'Building',   anyOf: [P.SETTINGS_MANAGE] },
          ],
        },
        {
          kind: 'group',
          id: 'outils',
          label: 'nav.tools',
          icon: 'Wrench',
          anyOf: [P.BULK_IMPORT, P.BACKUP_READ, P.SETTINGS_MANAGE],
          children: [
            { kind: 'leaf', id: 'bulk-import',    label: 'nav.bulk_import',   href: '/admin/settings/bulk-import', icon: 'Upload',    anyOf: [P.BULK_IMPORT] },
            { kind: 'leaf', id: 'tenant-backup',  label: 'nav.backup',        href: '/admin/settings/backup',      icon: 'HardDrive', anyOf: [P.BACKUP_READ] },
            { kind: 'leaf', id: 'tenant-quotas',  label: 'nav.tenant_quotas', href: '/admin/settings/quotas',      icon: 'Activity',  anyOf: [P.SETTINGS_MANAGE] },
          ],
        },
        {
          kind: 'group',
          id: 'iam',
          label: 'nav.users_roles',
          icon: 'ShieldCheck',
          anyOf: [P.IAM_MANAGE, P.IAM_AUDIT],
          children: [
            { kind: 'leaf', id: 'iam-users',    label: 'nav.users',      href: '/admin/iam/users',    icon: 'User',     anyOf: [P.IAM_MANAGE] },
            { kind: 'leaf', id: 'iam-roles',    label: 'nav.roles',      href: '/admin/iam/roles',    icon: 'Shield',   anyOf: [P.IAM_MANAGE] },
            { kind: 'leaf', id: 'iam-audit',    label: 'nav.access_log', href: '/admin/iam/audit',    icon: 'BookOpen', anyOf: [P.IAM_AUDIT] },
            { kind: 'leaf', id: 'iam-sessions', label: 'nav.sessions',   href: '/admin/iam/sessions', icon: 'KeyRound', anyOf: [P.IAM_MANAGE] },
          ],
        },
        {
          kind: 'group',
          id: 'ecosystem',
          label: { fr: 'Écosystème & Portail', en: 'Ecosystem & Portal' },
          icon: 'Globe',
          anyOf: [P.INTEGRATION_SETUP, P.SETTINGS_MANAGE],
          children: [
            { kind: 'leaf', id: 'integrations',      label: 'nav.api_integrations',  href: '/admin/integrations',               icon: 'Link2',    anyOf: [P.INTEGRATION_SETUP] },
            { kind: 'leaf', id: 'white-label',       label: 'nav.white_label_theme', href: '/admin/settings/branding',          icon: 'Palette',  anyOf: [P.SETTINGS_MANAGE], moduleKey: 'WHITE_LABEL' },
            { kind: 'leaf', id: 'portal-admin',      label: 'nav.portal_settings',   href: '/admin/settings/portal',            icon: 'Settings', anyOf: [P.SETTINGS_MANAGE] },
            { kind: 'leaf', id: 'portal-marketplace',label: 'nav.portal_marketplace',href: '/admin/settings/portal/marketplace',icon: 'Store',    anyOf: [P.SETTINGS_MANAGE] },
            { kind: 'leaf', id: 'cms-pages',         label: 'nav.cms_pages',         href: '/admin/settings/portal/pages',      icon: 'FileText', anyOf: [P.SETTINGS_MANAGE] },
            { kind: 'leaf', id: 'cms-posts',         label: 'nav.cms_posts',         href: '/admin/settings/portal/posts',      icon: 'Newspaper',anyOf: [P.SETTINGS_MANAGE] },
          ],
        },
      ],
    },

    // ── PLATEFORME (SUPER_ADMIN / SUPPORT L1-L2) ─────────────────────────────
    // Icône : Crown — panneau de contrôle plateforme, réservé super admins.
    // Composé automatiquement selon les permissions globales de l'acteur.
    {
      id: 'platform',
      title: 'nav.platform',
      icon: 'Crown',
      anyOf: [
        P.TENANT_MANAGE, P.PLATFORM_STAFF, P.IMPERSONATION_SWITCH,
        P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY,
        P.PLATFORM_PLANS_MANAGE, P.PLATFORM_BILLING_MANAGE,
        P.PLATFORM_METRICS_READ, P.PLATFORM_SUPPORT_READ,
        P.PLATFORM_CONFIG_MANAGE,
        P.PLATFORM_AUDIT_READ, P.PLATFORM_IAM_READ, P.PLATFORM_SESSION_REVOKE,
      ],
      items: [
        {
          kind: 'leaf',
          id: 'platform-dashboard',
          label: 'nav.platform_dashboard',
          href: '/admin/platform/dashboard',
          icon: 'LayoutDashboard',
          anyOf: [
            P.TENANT_MANAGE, P.PLATFORM_STAFF, P.IMPERSONATION_SWITCH,
            P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY,
            P.PLATFORM_PLANS_MANAGE, P.PLATFORM_BILLING_MANAGE,
            P.PLATFORM_METRICS_READ, P.PLATFORM_SUPPORT_READ,
            P.PLATFORM_CONFIG_MANAGE,
          ],
        },
        {
          kind: 'leaf',
          id: 'tenants',
          label: 'nav.tenant_management',
          href: '/admin/platform/tenants',
          icon: 'Building2',
          anyOf: [P.TENANT_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-plans',
          label: 'nav.platform_plans',
          href: '/admin/platform/plans',
          icon: 'Wallet',
          anyOf: [P.PLATFORM_PLANS_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-billing',
          label: 'nav.platform_billing',
          href: '/admin/platform/billing',
          icon: 'CreditCard',
          anyOf: [P.PLATFORM_BILLING_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-support',
          label: 'nav.platform_support',
          href: '/admin/platform/support',
          icon: 'LifeBuoy',
          anyOf: [P.PLATFORM_SUPPORT_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-staff',
          label: 'nav.platform_staff',
          href: '/admin/platform/staff',
          icon: 'UserCog',
          anyOf: [P.PLATFORM_STAFF],
        },
        {
          kind: 'leaf',
          id: 'impersonation',
          label: 'nav.jit_impersonation',
          href: '/admin/platform/impersonation',
          icon: 'UserCheck',
          anyOf: [P.IMPERSONATION_SWITCH],
        },
        {
          kind: 'leaf',
          id: 'platform-audit',
          label: 'nav.platform_audit',
          href: '/admin/platform/audit',
          icon: 'ScrollText',
          anyOf: [P.PLATFORM_AUDIT_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-sessions',
          label: 'nav.platform_sessions',
          href: '/admin/platform/sessions',
          icon: 'KeyRound',
          anyOf: [P.PLATFORM_SESSION_REVOKE],
        },
        {
          kind: 'leaf',
          id: 'platform-users',
          label: 'nav.platform_users',
          href: '/admin/platform/users',
          icon: 'Users',
          anyOf: [P.PLATFORM_IAM_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-roles',
          label: 'nav.platform_roles',
          href: '/admin/platform/roles',
          icon: 'Shield',
          anyOf: [P.PLATFORM_IAM_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-modules-usage',
          label: 'nav.platform_modules_usage',
          href: '/admin/platform/modules-usage',
          icon: 'Package',
          anyOf: [P.PLATFORM_KPI_ADOPTION],
        },
        {
          kind: 'leaf',
          id: 'platform-settings',
          label: 'nav.platform_settings',
          href: '/admin/platform/settings',
          icon: 'Settings',
          anyOf: [P.PLATFORM_CONFIG_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-email',
          label: 'nav.platform_email',
          href: '/admin/platform/email',
          icon: 'Mail',
          anyOf: [P.PLATFORM_CONFIG_MANAGE],
        },
        {
          kind: 'group',
          id: 'debug',
          label: 'nav.technical_debug',
          icon: 'Terminal',
          anyOf: [P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY],
          children: [
            { kind: 'leaf', id: 'debug-workflow', label: 'nav.workflow_debug', href: '/admin/platform/debug/workflow', icon: 'Bug',       anyOf: [P.WORKFLOW_DEBUG] },
            { kind: 'leaf', id: 'debug-outbox',   label: 'nav.outbox_replay',  href: '/admin/platform/debug/outbox',   icon: 'RefreshCw', anyOf: [P.OUTBOX_REPLAY] },
          ],
        },
      ],
    },

    // ── Utilitaire (invisible — hrefs réservés pour le bottom bar) ──────────────
    // anyOf contient une permission impossible → section jamais rendue dans le
    // sidebar. findActiveIdInConfig parcourt le config brut et trouve quand même
    // ces hrefs pour que PageRouter resolve correctement.
    {
      id: '_utility',
      anyOf: ['___never___'],
      items: [
        { kind: 'leaf', id: 'notifications',          label: 'nav.notifications',       href: '/admin/notifications',         icon: 'Bell' },
        { kind: 'leaf', id: 'notifications-prefs',    label: 'nav.notification_prefs',  href: '/admin/notifications/prefs',   icon: 'Settings2' },
        { kind: 'leaf', id: 'support',                label: 'nav.contact_support',     href: '/admin/support',               icon: 'LifeBuoy' },
        { kind: 'leaf', id: 'account',                label: 'account.title',           href: '/admin/account',               icon: 'UserCircle2' },
        // tenant-billing + tenant-payment-methods retirés : les URL /admin/billing
        // et /admin/billing/methods sont désormais redirigées vers /account?tab=billing
        // par le router principal (main.tsx). L'abonnement est un onglet de « Mon compte ».
      ],
    },

  ],
};

// ─── Portail Plateforme (SUPER_ADMIN / SUPPORT_L1 / SUPPORT_L2) ──────────────
// Utilisé par AdminDashboard quand resolveHost().isAdmin === true
// (le host est admin.translog.test / admin.translogpro.com).
// Contient uniquement les items Control Plane — pas de tenant-ops.
// Pendant une impersonation, le host redevient celui du tenant donc ADMIN_NAV
// est automatiquement re-sélectionné.

export const PLATFORM_NAV: PortalNavConfig = {
  portalId: 'admin',
  sections: [
    {
      id: 'platform',
      items: [
        {
          kind: 'leaf',
          id: 'platform-dashboard',
          label: 'nav.platform_dashboard',
          href: '/admin/platform/dashboard',
          icon: 'LayoutDashboard',
          anyOf: [
            P.TENANT_MANAGE, P.PLATFORM_STAFF, P.IMPERSONATION_SWITCH,
            P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY,
            P.PLATFORM_PLANS_MANAGE, P.PLATFORM_BILLING_MANAGE,
            P.PLATFORM_METRICS_READ, P.PLATFORM_SUPPORT_READ,
            P.PLATFORM_CONFIG_MANAGE,
          ],
        },
        {
          kind: 'leaf',
          id: 'tenants',
          label: 'nav.tenant_management',
          href: '/admin/platform/tenants',
          icon: 'Building2',
          anyOf: [P.TENANT_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-plans',
          label: 'nav.platform_plans',
          href: '/admin/platform/plans',
          icon: 'Wallet',
          anyOf: [P.PLATFORM_PLANS_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-billing',
          label: 'nav.platform_billing',
          href: '/admin/platform/billing',
          icon: 'CreditCard',
          anyOf: [P.PLATFORM_BILLING_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-support',
          label: 'nav.platform_support',
          href: '/admin/platform/support',
          icon: 'LifeBuoy',
          anyOf: [P.PLATFORM_SUPPORT_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-staff',
          label: 'nav.platform_staff',
          href: '/admin/platform/staff',
          icon: 'UserCog',
          anyOf: [P.PLATFORM_STAFF],
        },
        {
          kind: 'leaf',
          id: 'impersonation',
          label: 'nav.jit_impersonation',
          href: '/admin/platform/impersonation',
          icon: 'UserCheck',
          anyOf: [P.IMPERSONATION_SWITCH],
        },
        {
          kind: 'leaf',
          id: 'platform-audit',
          label: 'nav.platform_audit',
          href: '/admin/platform/audit',
          icon: 'ScrollText',
          anyOf: [P.PLATFORM_AUDIT_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-sessions',
          label: 'nav.platform_sessions',
          href: '/admin/platform/sessions',
          icon: 'KeyRound',
          anyOf: [P.PLATFORM_SESSION_REVOKE],
        },
        {
          kind: 'leaf',
          id: 'platform-users',
          label: 'nav.platform_users',
          href: '/admin/platform/users',
          icon: 'Users',
          anyOf: [P.PLATFORM_IAM_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-roles',
          label: 'nav.platform_roles',
          href: '/admin/platform/roles',
          icon: 'Shield',
          anyOf: [P.PLATFORM_IAM_READ],
        },
        {
          kind: 'leaf',
          id: 'platform-modules-usage',
          label: 'nav.platform_modules_usage',
          href: '/admin/platform/modules-usage',
          icon: 'Package',
          anyOf: [P.PLATFORM_KPI_ADOPTION],
        },
        {
          kind: 'leaf',
          id: 'platform-settings',
          label: 'nav.platform_settings',
          href: '/admin/platform/settings',
          icon: 'Settings',
          anyOf: [P.PLATFORM_CONFIG_MANAGE],
        },
      ],
    },
    {
      id: 'platform-debug',
      title: 'nav.technical_debug',
      anyOf: [P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY],
      items: [
        { kind: 'leaf', id: 'debug-workflow', label: 'nav.workflow_debug', href: '/admin/platform/debug/workflow', icon: 'Bug',       anyOf: [P.WORKFLOW_DEBUG] },
        { kind: 'leaf', id: 'debug-outbox',   label: 'nav.outbox_replay',  href: '/admin/platform/debug/outbox',   icon: 'RefreshCw', anyOf: [P.OUTBOX_REPLAY] },
      ],
    },
    { id: '_utility', anyOf: ['___never___'], items: [
      { kind: 'leaf', id: 'notifications', label: 'nav.notifications', href: '/admin/notifications', icon: 'Bell' },
      { kind: 'leaf', id: 'support',       label: 'nav.contact_support', href: '/admin/support',   icon: 'LifeBuoy' },
      { kind: 'leaf', id: 'account',       label: 'account.title',       href: '/admin/account',  icon: 'UserCircle2' },
    ]},
  ],
};

// ─── Portail Agent de Gare ────────────────────────────────────────────────────

export const STATION_AGENT_NAV: PortalNavConfig = {
  portalId: 'station-agent',
  sections: [
    {
      id:    'main',
      title: { fr: 'Guichet', en: 'Counter' },
      icon:  'Ticket',
      items: [
        { kind: 'leaf', id: 'sa-home',     label: 'nav.overview', href: '/agent',          icon: 'LayoutDashboard', anyOf: [P.TICKET_CREATE, P.TICKET_SCAN] },
        { kind: 'leaf', id: 'sa-sell',     label: 'nav.sell_ticket',   href: '/agent/sell',     icon: 'Ticket',          anyOf: [P.TICKET_CREATE] },
        { kind: 'leaf', id: 'sa-checkin',  label: 'nav.check_in',        href: '/agent/checkin',  icon: 'ScanLine',        anyOf: [P.TICKET_SCAN, P.TRAVELER_VERIFY] },
        { kind: 'leaf', id: 'sa-luggage',  label: 'nav.luggage',         href: '/agent/luggage',  icon: 'Luggage',         anyOf: [P.LUGGAGE_WEIGH] },
        { kind: 'leaf', id: 'sa-parcel',   label: 'nav.parcels',           href: '/agent/parcel',   icon: 'Package',         anyOf: [P.PARCEL_CREATE, P.PARCEL_SCAN] },
        { kind: 'leaf', id: 'sa-manifest', label: 'nav.manifests',      href: '/agent/manifests', icon: 'ClipboardList', anyOf: [P.MANIFEST_GENERATE] },
      ],
    },
    {
      id:    'sa-ops',
      title: 'nav.cashier_finance',
      icon:  'Landmark',
      anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE],
      items: [
        { kind: 'leaf', id: 'sa-cashier',  label: 'nav.cashier',          href: '/agent/cashier',  icon: 'Landmark',        anyOf: [P.CASHIER_OPEN, P.CASHIER_TX] },
        { kind: 'leaf', id: 'sa-receipts', label: 'nav.receipts_tickets', href: '/agent/receipts', icon: 'Receipt',         anyOf: [P.TICKET_PRINT] },
      ],
    },
    {
      id:    'sa-display',
      title: 'nav.display',
      icon:  'Monitor',
      anyOf: [P.DISPLAY_UPDATE],
      items: [
        { kind: 'leaf', id: 'sa-display',  label: 'nav.station_screens',     href: '/agent/display',  icon: 'Monitor',         anyOf: [P.DISPLAY_UPDATE] },
      ],
    },
    {
      id:    'sa-sav',
      title: 'nav.after_sales',
      icon:  'LifeBuoy',
      anyOf: [P.SAV_REPORT, P.SAV_DELIVER],
      items: [
        { kind: 'leaf', id: 'sa-sav',      label: 'nav.report_incident', href: '/agent/sav',    icon: 'MessageSquareWarning', anyOf: [P.SAV_REPORT] },
      ],
    },
    { id: '_utility', anyOf: ['___never___'], items: [
      { kind: 'leaf', id: 'notifications', label: 'nav.notifications', href: '/agent/notifications', icon: 'Bell' },
      { kind: 'leaf', id: 'support',       label: 'nav.contact_support', href: '/agent/support',     icon: 'LifeBuoy' },
      { kind: 'leaf', id: 'account',       label: 'account.title',       href: '/agent/account',     icon: 'UserCircle2' },
    ]},
  ],
};

// ─── Portail Agent de Quai ────────────────────────────────────────────────────

export const QUAI_AGENT_NAV: PortalNavConfig = {
  portalId: 'quai-agent',
  sections: [
    {
      id:    'qa-main',
      title: { fr: 'Quai', en: 'Platform' },
      icon:  'Truck',
      items: [
        { kind: 'leaf', id: 'qa-home',     label: 'nav.my_platform',        href: '/quai',           icon: 'LayoutDashboard', anyOf: [P.TRIP_UPDATE, P.MANIFEST_SIGN] },
        // Même composant PageQuaiScan, pré-routé via `?type=` pour que l'agent
        // sache ce qu'il scanne (évite le "oups j'ai scanné un colis comme billet").
        // L'auto-détection reste possible via l'URL QR publique (/verify/ticket/... ou /verify/parcel/...).
        { kind: 'leaf', id: 'qa-scan',         label: 'nav.scan_ticket',  href: '/quai/scan?type=ticket',  icon: 'ScanLine',      anyOf: [P.TICKET_SCAN] },
        { kind: 'leaf', id: 'qa-scan-parcel',  label: 'nav.scan_parcel',  href: '/quai/scan?type=parcel',  icon: 'PackageSearch', anyOf: [P.PARCEL_SCAN] },
        { kind: 'leaf', id: 'qa-boarding', label: 'nav.boarding',    href: '/quai/boarding',  icon: 'Users',           anyOf: [P.TRIP_UPDATE, P.TICKET_SCAN] },
        { kind: 'leaf', id: 'qa-freight',  label: 'nav.freight_loading', href: '/quai/freight',  icon: 'Package',       anyOf: [P.PARCEL_SCAN, P.PARCEL_UPDATE_AGENCY] },
        { kind: 'leaf', id: 'qa-manifest', label: 'nav.manifest',       href: '/quai/manifest',  icon: 'ClipboardList',   anyOf: [P.MANIFEST_SIGN, P.MANIFEST_GENERATE] },
        { kind: 'leaf', id: 'qa-luggage',  label: 'nav.luggage_check', href: '/quai/luggage',  icon: 'Luggage',         anyOf: [P.LUGGAGE_WEIGH] },
      ],
    },
    {
      id:    'qa-ops',
      title: 'nav.operations',
      icon:  'Route',
      anyOf: [P.TRIP_DELAY, P.DISPLAY_UPDATE],
      items: [
        { kind: 'leaf', id: 'qa-delay',    label: 'nav.declare_delay', href: '/quai/delay',     icon: 'Clock',           anyOf: [P.TRIP_DELAY] },
        { kind: 'leaf', id: 'qa-display',  label: 'nav.platform_screen',      href: '/quai/display',   icon: 'Monitor',         anyOf: [P.DISPLAY_UPDATE] },
      ],
    },
    {
      id:    'qa-sav',
      title: 'nav.after_sales',
      icon:  'LifeBuoy',
      anyOf: [P.SAV_REPORT],
      items: [
        { kind: 'leaf', id: 'qa-sav',      label: 'nav.report_incident', href: '/quai/sav',     icon: 'AlertTriangle',   anyOf: [P.SAV_REPORT] },
      ],
    },
    { id: '_utility', anyOf: ['___never___'], items: [
      { kind: 'leaf', id: 'notifications', label: 'nav.notifications', href: '/quai/notifications', icon: 'Bell' },
      { kind: 'leaf', id: 'support',       label: 'nav.contact_support', href: '/quai/support',     icon: 'LifeBuoy' },
      { kind: 'leaf', id: 'account',       label: 'account.title',       href: '/quai/account',     icon: 'UserCircle2' },
    ]},
  ],
};

// ─── Espace Chauffeur ─────────────────────────────────────────────────────────

export const DRIVER_NAV: PortalNavConfig = {
  portalId: 'driver',
  sections: [
    {
      id:    'drv-main',
      title: { fr: 'Mon service', en: 'My Service' },
      icon:  'MapPin',
      items: [
        { kind: 'leaf', id: 'drv-home',     label: 'nav.my_trip',       href: '/driver',              icon: 'MapPin',        anyOf: [P.TRIP_READ_OWN, P.TRIP_CHECK_OWN] },
        { kind: 'leaf', id: 'drv-manifest', label: 'nav.manifest',        href: '/driver/manifest',     icon: 'ClipboardList', anyOf: [P.MANIFEST_READ_OWN] },
        { kind: 'leaf', id: 'drv-checkin',  label: 'nav.passenger_check',  href: '/driver/checkin',      icon: 'Users',         anyOf: [P.TRIP_CHECK_OWN] },
        // Scan billets — route unifiée avec query param `type=ticket` pour
        // faire comprendre au scanner quel endpoint essayer en premier.
        { kind: 'leaf', id: 'drv-scan',        label: 'nav.scan_ticket',  href: '/driver/scan?type=ticket',  icon: 'ScanLine', anyOf: [P.TICKET_SCAN, P.TRAVELER_VERIFY] },
        // Scan colis — même composant, type=parcel. Visible seulement si
        // la perm parcel scan est là.
        { kind: 'leaf', id: 'drv-scan-parcel', label: 'nav.scan_parcel',  href: '/driver/scan?type=parcel',  icon: 'PackageSearch', anyOf: [P.PARCEL_SCAN] },
        { kind: 'leaf', id: 'drv-freight',  label: 'nav.freight_loading', href: '/driver/freight',     icon: 'Package',       anyOf: [P.PARCEL_SCAN, P.PARCEL_UPDATE_AGENCY] },
        { kind: 'leaf', id: 'drv-events',   label: 'nav.logbook',  href: '/driver/events',       icon: 'ScrollText',    anyOf: [P.TRIP_LOG_EVENT] },
        { kind: 'leaf', id: 'drv-briefing', label: 'nav.pre_departure_briefing', href: '/driver/briefing',  icon: 'ClipboardCheck', anyOf: [P.DRIVER_REST_OWN], moduleKey: 'CREW_BRIEFING' },
      ],
    },
    {
      id:    'drv-ops',
      title: 'nav.operations',
      icon:  'Route',
      anyOf: [P.TRIP_REPORT_OWN, P.MAINTENANCE_UPDATE],
      items: [
        { kind: 'leaf', id: 'drv-report',   label: 'nav.trip_report', href: '/driver/report',      icon: 'FileText',      anyOf: [P.TRIP_REPORT_OWN] },
        { kind: 'leaf', id: 'drv-maint',    label: 'nav.report_breakdown',    href: '/driver/maintenance', icon: 'Wrench',        anyOf: [P.MAINTENANCE_UPDATE] },
      ],
    },
    {
      id:    'drv-personal',
      title: 'nav.my_space',
      icon:  'User',
      items: [
        { kind: 'leaf', id: 'drv-schedule', label: 'nav.my_schedule',      href: '/driver/schedule',    icon: 'Calendar' },
        { kind: 'leaf', id: 'drv-docs',     label: 'nav.my_documents',     href: '/driver/documents',   icon: 'FileCheck',     anyOf: [P.DRIVER_REST_OWN, P.DRIVER_PROFILE] },
        { kind: 'leaf', id: 'drv-rest',     label: 'nav.my_rest_times', href: '/driver/rest',       icon: 'Coffee',        anyOf: [P.DRIVER_REST_OWN] },
        { kind: 'leaf', id: 'drv-feedback', label: 'nav.traveler_feedback', href: '/driver/feedback',    icon: 'Star',          anyOf: [P.FEEDBACK_SUBMIT] },
      ],
    },
    { id: '_utility', anyOf: ['___never___'], items: [
      { kind: 'leaf', id: 'notifications', label: 'nav.notifications', href: '/driver/notifications', icon: 'Bell' },
      { kind: 'leaf', id: 'support',       label: 'nav.contact_support', href: '/driver/support',     icon: 'LifeBuoy' },
      { kind: 'leaf', id: 'account',       label: 'account.title',       href: '/driver/account',     icon: 'UserCircle2' },
    ]},
  ],
};

// ─── Espace Client (CUSTOMER) ─────────────────────────────────────────────────
// Profil unifié voyageur + expéditeur. Navigation adaptative : si le client
// n'a jamais voyagé / expédié, les sections vides restent visibles (découverte).
// Le filtrage activité/UX se fait dans les pages elles-mêmes (empty states).

export const CUSTOMER_NAV: PortalNavConfig = {
  portalId: 'customer',
  sections: [
    {
      id: 'cust-main',
      items: [
        { kind: 'leaf', id: 'cust-home',    label: 'nav.home',      href: '/customer',           icon: 'Home' },
      ],
    },
    {
      id: 'cust-travel',
      title: 'nav.my_trips',
      anyOf: [P.TICKET_READ_OWN],
      items: [
        { kind: 'leaf', id: 'cust-trips',   label: 'nav.my_tickets',  href: '/customer/trips',     icon: 'Ticket',  anyOf: [P.TICKET_READ_OWN] },
      ],
    },
    {
      id: 'cust-shipping',
      title: 'nav.my_parcels',
      anyOf: [P.PARCEL_READ_OWN, P.PARCEL_TRACK_OWN],
      items: [
        { kind: 'leaf', id: 'cust-parcels', label: 'nav.track_parcels',  href: '/customer/parcels',   icon: 'Package', anyOf: [P.PARCEL_READ_OWN, P.PARCEL_TRACK_OWN] },
      ],
    },
    {
      id: 'cust-vouchers-section',
      title: 'nav.my_vouchers',
      anyOf: [P.VOUCHER_READ_OWN],
      items: [
        { kind: 'leaf', id: 'cust-vouchers', label: 'nav.my_vouchers', href: '/customer/vouchers', icon: 'Gift', anyOf: [P.VOUCHER_READ_OWN] },
      ],
    },
    {
      id: 'cust-safety',
      title: 'nav.my_incidents',
      anyOf: [P.INCIDENT_REPORT_OWN],
      items: [
        { kind: 'leaf', id: 'cust-incidents', label: 'nav.my_incidents', href: '/customer/incidents', icon: 'AlertTriangle', anyOf: [P.INCIDENT_REPORT_OWN] },
      ],
    },
    {
      id: 'cust-support',
      title: 'nav.support',
      anyOf: [P.SAV_REPORT_OWN, P.FEEDBACK_SUBMIT],
      items: [
        { kind: 'leaf', id: 'cust-retro',    label: 'nav.retro_claim', href: '/customer/retro-claim', icon: 'History',              anyOf: [P.FEEDBACK_SUBMIT] },
        { kind: 'leaf', id: 'cust-claim',    label: 'nav.claim',    href: '/customer/claim',    icon: 'MessageSquareWarning', anyOf: [P.SAV_REPORT_OWN] },
        { kind: 'leaf', id: 'cust-feedback', label: 'nav.leave_a_review', href: '/customer/feedback', icon: 'Star',                 anyOf: [P.FEEDBACK_SUBMIT] },
      ],
    },
  ],
};
