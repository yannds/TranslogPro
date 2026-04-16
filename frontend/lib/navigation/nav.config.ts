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
  CASHIER_OPEN:          'data.cashier.open.own',
  CASHIER_TX:            'data.cashier.transaction.own',
  CASHIER_CLOSE:         'data.cashier.close.agency',
  INVOICE_PRINT:         'data.invoice.print.agency',
  // SAV
  SAV_REPORT:            'data.sav.report.agency',
  SAV_CLAIM:             'data.sav.claim.tenant',
  SAV_DELIVER:           'data.sav.deliver.agency',
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
  // Platform (SUPER_ADMIN)
  TENANT_MANAGE:         'control.tenant.manage.global',
  PLATFORM_STAFF:        'control.platform.staff.global',
  IMPERSONATION_SWITCH:  'control.impersonation.switch.global',
  WORKFLOW_DEBUG:        'data.workflow.debug.global',
  OUTBOX_REPLAY:         'data.outbox.replay.global',
  // Session
  SESSION_REVOKE_TENANT: 'data.session.revoke.tenant',
  // Driver & HR (Fleet Docs, rest, training, remediation)
  DRIVER_MANAGE:         'control.driver.manage.tenant',
  DRIVER_PROFILE:        'data.driver.profile.agency',
  DRIVER_REST_OWN:       'data.driver.rest.own',
  // QHSE & Accidents
  QHSE_MANAGE:           'control.qhse.manage.tenant',
  ACCIDENT_REPORT:       'data.accident.report.own',
};

// ─── Portail Admin ─────────────────────────────────────────────────────────────

export const ADMIN_NAV: PortalNavConfig = {
  portalId: 'admin',
  sections: [

    // ── Vue d'ensemble ───────────────────────────────────────────────────────
    {
      id: 'overview',
      items: [
        {
          kind: 'leaf',
          id: 'dashboard',
          label: 'nav.dashboard',
          href: '/admin',
          icon: 'LayoutDashboard',
          anyOf: [P.STATS_READ, P.TRIP_UPDATE, P.TICKET_READ_TENANT],
        },
        {
          kind: 'leaf',
          id: 'notifications',
          label: 'nav.notifications',
          href: '/admin/notifications',
          icon: 'Bell',
          // tous les admins
          anyOf: [P.STATS_READ, P.TRIP_UPDATE, P.IAM_MANAGE],
        },
      ],
    },

    // ── Opérations ───────────────────────────────────────────────────────────
    {
      id: 'ops',
      title: 'nav.operations',
      anyOf: [P.TRIP_CREATE, P.TRIP_UPDATE, P.TICKET_CREATE, P.TICKET_READ_TENANT, P.PARCEL_CREATE, P.MANIFEST_GENERATE, P.SAV_CLAIM],
      items: [
        {
          kind: 'group',
          id: 'trips',
          label: 'nav.trips_planning',
          icon: 'MapPin',
          anyOf: [P.TRIP_CREATE, P.TRIP_UPDATE, P.ROUTE_MANAGE, P.TRIP_DELAY, P.TRIP_CANCEL],
          children: [
            { kind: 'leaf', id: 'trips-list',     label: 'nav.today_s_trips',    href: '/admin/trips',          icon: 'List',        anyOf: [P.TRIP_UPDATE, P.TRIP_CREATE] },
            { kind: 'leaf', id: 'trips-planning', label: 'nav.weekly_planning', href: '/admin/trips/planning', icon: 'CalendarDays', anyOf: [P.TRIP_CREATE, P.ROUTE_MANAGE] },
            { kind: 'leaf', id: 'stations',       label: 'nav.stations',   href: '/admin/stations',       icon: 'MapPin',      anyOf: [P.STATION_MANAGE, P.STATION_READ] },
            { kind: 'leaf', id: 'routes',         label: 'nav.routes_lines',    href: '/admin/routes',         icon: 'Route',       anyOf: [P.ROUTE_MANAGE] },
            { kind: 'leaf', id: 'trips-delays',   label: 'nav.delays_alerts',  href: '/admin/trips/delays',   icon: 'AlertTriangle', anyOf: [P.TRIP_DELAY, P.TRIP_UPDATE] },
          ],
        },
        {
          kind: 'group',
          id: 'ticketing',
          label: 'nav.ticketing',
          icon: 'Ticket',
          anyOf: [P.TICKET_CREATE, P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT, P.TICKET_CANCEL],
          children: [
            { kind: 'leaf', id: 'tickets-new',    label: 'nav.sell_ticket',   href: '/admin/tickets/new',    icon: 'Plus',        anyOf: [P.TICKET_CREATE] },
            { kind: 'leaf', id: 'tickets-list',   label: 'nav.issued_tickets',       href: '/admin/tickets',        icon: 'List',        anyOf: [P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT] },
            { kind: 'leaf', id: 'tickets-cancel', label: 'nav.cancellations',        href: '/admin/tickets/cancel', icon: 'XCircle',     anyOf: [P.TICKET_CANCEL] },
            { kind: 'leaf', id: 'manifests',      label: 'nav.manifests',         href: '/admin/manifests',      icon: 'ClipboardList', anyOf: [P.MANIFEST_GENERATE, P.MANIFEST_READ_OWN] },
          ],
        },
        {
          kind: 'group',
          id: 'logistics',
          label: 'nav.parcels_logistics',
          icon: 'Package',
          anyOf: [P.PARCEL_CREATE, P.PARCEL_UPDATE_AGENCY, P.PARCEL_UPDATE_TENANT, P.SHIPMENT_GROUP],
          children: [
            { kind: 'leaf', id: 'parcel-new',     label: 'nav.register_parcel', href: '/admin/parcels/new',  icon: 'PackagePlus', anyOf: [P.PARCEL_CREATE] },
            { kind: 'leaf', id: 'parcels-list',   label: 'nav.track_parcels',         href: '/admin/parcels',       icon: 'Truck',       anyOf: [P.PARCEL_UPDATE_AGENCY, P.PARCEL_UPDATE_TENANT] },
            { kind: 'leaf', id: 'shipments',      label: 'nav.group_shipments', href: '/admin/shipments',    icon: 'Boxes',       anyOf: [P.SHIPMENT_GROUP] },
          ],
        },
        {
          kind: 'group',
          id: 'sav',
          label: 'nav.after_sales_claims',
          icon: 'MessageSquareWarning',
          anyOf: [P.SAV_CLAIM, P.SAV_REPORT, P.SAV_DELIVER],
          moduleKey: 'SAV_MODULE',
          children: [
            { kind: 'leaf', id: 'sav-claims',    label: 'nav.claims',        href: '/admin/sav/claims',    icon: 'FileWarning', anyOf: [P.SAV_CLAIM] },
            { kind: 'leaf', id: 'sav-reports',   label: 'nav.reports',        href: '/admin/sav/reports',   icon: 'Flag',        anyOf: [P.SAV_REPORT] },
            { kind: 'leaf', id: 'sav-returns',   label: 'nav.refunds',      href: '/admin/sav/returns',   icon: 'RotateCcw',   anyOf: [P.SAV_CLAIM, P.SAV_DELIVER] },
          ],
        },
      ],
    },

    // ── Finance ──────────────────────────────────────────────────────────────
    {
      id: 'finance',
      title: 'nav.finance',
      anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE, P.PRICING_MANAGE, P.PRICING_YIELD, P.PRICING_READ, P.INVOICE_PRINT],
      items: [
        {
          kind: 'leaf',
          id: 'cashier',
          label: 'nav.cashier',
          href: '/admin/cashier',
          icon: 'Landmark',
          anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE],
        },
        {
          kind: 'group',
          id: 'pricing',
          label: 'nav.pricing',
          icon: 'Tags',
          anyOf: [P.PRICING_MANAGE, P.PRICING_YIELD, P.PRICING_READ],
          children: [
            { kind: 'leaf', id: 'pricing-grid',   label: 'nav.pricing_grid',    href: '/admin/pricing',        icon: 'Grid3x3',     anyOf: [P.PRICING_MANAGE, P.PRICING_READ] },
            { kind: 'leaf', id: 'pricing-yield',  label: 'nav.yield_management',    href: '/admin/pricing/yield',  icon: 'TrendingUp',  anyOf: [P.PRICING_YIELD], moduleKey: 'YIELD_ENGINE' },
            { kind: 'leaf', id: 'pricing-promo',  label: 'nav.promotions',          href: '/admin/pricing/promo',  icon: 'Percent',     anyOf: [P.PRICING_MANAGE], wip: true },
          ],
        },
        {
          kind: 'leaf',
          id: 'invoices',
          label: 'nav.invoicing',
          href: '/admin/invoices',
          icon: 'Receipt',
          anyOf: [P.INVOICE_PRINT],
        },
      ],
    },

    // ── Intelligence & Analytics ─────────────────────────────────────────────
    {
      id: 'intelligence',
      title: 'nav.intelligence',
      anyOf: [P.STATS_READ],
      items: [
        {
          kind: 'leaf',
          id: 'analytics',
          label: 'nav.analytics',
          href: '/admin/analytics',
          icon: 'BarChart3',
          anyOf: [P.STATS_READ],
        },
        {
          kind: 'group',
          id: 'ai',
          label: 'nav.ai_recommendations',
          icon: 'Brain',
          anyOf: [P.STATS_READ],
          children: [
            { kind: 'leaf', id: 'ai-routes',      label: 'nav.route_profitability',    href: '/admin/ai/routes',      icon: 'TrendingUp',  anyOf: [P.STATS_READ] },
            { kind: 'leaf', id: 'ai-fleet',       label: 'nav.fleet_optimization', href: '/admin/ai/fleet',       icon: 'Bus',         anyOf: [P.STATS_READ, P.FLEET_MANAGE] },
            { kind: 'leaf', id: 'ai-demand',      label: 'nav.demand_forecast',  href: '/admin/ai/demand',      icon: 'Activity',    anyOf: [P.STATS_READ], wip: true },
            { kind: 'leaf', id: 'ai-pricing',     label: 'nav.dynamic_pricing',   href: '/admin/ai/pricing',     icon: 'Zap',         anyOf: [P.PRICING_YIELD, P.STATS_READ], wip: true },
          ],
        },
        {
          kind: 'leaf',
          id: 'reports',
          label: 'nav.periodic_reports',
          href: '/admin/reports',
          icon: 'FileBarChart',
          anyOf: [P.STATS_READ],
        },
      ],
    },

    // ── Flotte ───────────────────────────────────────────────────────────────
    {
      id: 'fleet',
      title: 'nav.fleet',
      anyOf: [P.FLEET_MANAGE, P.FLEET_LAYOUT, P.FLEET_STATUS, P.MAINTENANCE_APPROVE, P.MAINTENANCE_UPDATE, P.DRIVER_MANAGE],
      items: [
        {
          kind: 'leaf',
          id: 'fleet-vehicles',
          label: 'nav.vehicles',
          href: '/admin/fleet',
          icon: 'Bus',
          anyOf: [P.FLEET_MANAGE, P.FLEET_STATUS],
        },
        {
          kind: 'leaf',
          id: 'fleet-tracking',
          label: 'nav.mileage_fuel',
          href: '/admin/fleet/tracking',
          icon: 'Gauge',
          anyOf: [P.FLEET_MANAGE, P.FLEET_STATUS, P.FLEET_TRACKING, P.FLEET_TRACKING_CREATE],
        },
        {
          kind: 'leaf',
          id: 'fleet-seats',
          label: 'nav.seat_plans',
          href: '/admin/fleet/seats',
          icon: 'LayoutGrid',
          anyOf: [P.FLEET_LAYOUT],
        },
        {
          kind: 'group',
          id: 'maintenance',
          label: 'nav.maintenance_garage',
          icon: 'Wrench',
          anyOf: [P.MAINTENANCE_APPROVE, P.MAINTENANCE_UPDATE],
          moduleKey: 'GARAGE_PRO',
          children: [
            { kind: 'leaf', id: 'maintenance-list',     label: 'nav.maintenance_sheets',  href: '/admin/maintenance',          icon: 'ClipboardCheck', anyOf: [P.MAINTENANCE_APPROVE] },
            { kind: 'leaf', id: 'maintenance-planning', label: 'nav.garage_planning',         href: '/admin/maintenance/planning', icon: 'CalendarClock',  anyOf: [P.MAINTENANCE_APPROVE] },
            { kind: 'leaf', id: 'maintenance-alerts',   label: 'nav.technical_alerts',      href: '/admin/maintenance/alerts',   icon: 'AlertCircle',    anyOf: [P.MAINTENANCE_APPROVE, P.FLEET_STATUS] },
          ],
        },
        {
          kind: 'leaf',
          id: 'fleet-docs',
          label: 'nav.documents_consumables',
          icon: 'FileCheck',
          href: '/admin/fleet-docs',
          anyOf: [P.FLEET_MANAGE, P.DRIVER_MANAGE],
          moduleKey: 'FLEET_DOCS',
        },
      ],
    },

    // ── Personnel & Équipages ─────────────────────────────────────────────────
    {
      id: 'staff',
      title: 'nav.staff',
      anyOf: [P.CREW_MANAGE, P.STAFF_MANAGE, P.STAFF_READ, P.DRIVER_MANAGE, P.DRIVER_PROFILE],
      items: [
        {
          kind: 'leaf',
          id: 'drivers',
          label: 'nav.drivers',
          icon: 'Steer',
          href: '/admin/drivers',
          anyOf: [P.CREW_MANAGE, P.STAFF_MANAGE, P.DRIVER_MANAGE, P.DRIVER_PROFILE],
          moduleKey: 'DRIVER_PROFILE',
        },
        {
          kind: 'leaf',
          id: 'staff-list',
          label: 'nav.all_staff',
          href: '/admin/staff',
          icon: 'Users',
          anyOf: [P.STAFF_MANAGE, P.STAFF_READ],
        },
        {
          kind: 'group',
          id: 'crew',
          label: 'nav.crews',
          icon: 'UsersRound',
          anyOf: [P.CREW_MANAGE],
          moduleKey: 'CREW_BRIEFING',
          children: [
            { kind: 'leaf', id: 'crew-planning',   label: 'nav.crew_planning',  href: '/admin/crew/planning',  icon: 'CalendarRange',  anyOf: [P.CREW_MANAGE] },
            { kind: 'leaf', id: 'crew-briefing',   label: 'nav.pre_departure_briefings', href: '/admin/crew/briefing', icon: 'ClipboardCheck', anyOf: [P.CREW_MANAGE] },
          ],
        },
      ],
    },

    // ── QHSE & Sécurité opérationnelle ────────────────────────────────────────
    {
      id: 'qhse',
      title: 'nav.qhse',
      anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT],
      items: [
        {
          kind: 'leaf',
          id: 'qhse',
          label: 'nav.qhse_accidents',
          icon: 'AlertOctagon',
          href: '/admin/qhse',
          anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT],
          moduleKey: 'QHSE',
        },
      ],
    },

    // ── Commercial & CRM ─────────────────────────────────────────────────────
    {
      id: 'crm',
      title: 'nav.commercial',
      anyOf: [P.CRM_READ, P.CAMPAIGN_MANAGE],
      moduleKey: 'CRM',
      items: [
        {
          kind: 'leaf',
          id: 'crm-clients',
          label: 'nav.customers_crm',
          href: '/admin/crm',
          icon: 'Users2',
          anyOf: [P.CRM_READ],
        },
        {
          kind: 'leaf',
          id: 'crm-campaigns',
          label: 'nav.campaigns',
          href: '/admin/crm/campaigns',
          icon: 'Megaphone',
          anyOf: [P.CAMPAIGN_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'crm-loyalty',
          label: 'nav.loyalty_program',
          href: '/admin/crm/loyalty',
          icon: 'Star',
          anyOf: [P.CRM_READ], wip: true,
        },
        {
          kind: 'leaf',
          id: 'crm-feedback',
          label: 'nav.reviews_feedback',
          href: '/admin/crm/feedback',
          icon: 'MessageCircle',
          anyOf: [P.CRM_READ],
        },
      ],
    },

    // ── Affichage & Gare ─────────────────────────────────────────────────────
    {
      id: 'display',
      title: 'nav.display_station',
      anyOf: [P.DISPLAY_UPDATE, P.TRIP_UPDATE],
      items: [
        {
          kind: 'leaf',
          id: 'display-screens',
          label: 'nav.screens_displays',
          href: '/admin/display',
          icon: 'Monitor',
          anyOf: [P.DISPLAY_UPDATE],
        },
        {
          kind: 'leaf',
          id: 'display-quais',
          label: 'nav.platform_management',
          href: '/admin/display/quais',
          icon: 'MapPinned',
          anyOf: [P.TRIP_UPDATE, P.DISPLAY_UPDATE],
        },
        {
          kind: 'leaf',
          id: 'display-announcements',
          label: 'nav.station_announcements',
          href: '/admin/display/announcements',
          icon: 'Volume2',
          anyOf: [P.DISPLAY_UPDATE],
        },
      ],
    },

    // ── Sécurité & Incidents ─────────────────────────────────────────────────
    {
      id: 'safety',
      title: 'nav.security',
      anyOf: [P.SAFETY_MONITOR, P.SAV_REPORT],
      items: [
        {
          kind: 'leaf',
          id: 'safety-incidents',
          label: 'nav.incidents',
          href: '/admin/safety/incidents',
          icon: 'ShieldAlert',
          anyOf: [P.SAFETY_MONITOR, P.SAV_REPORT],
        },
        {
          kind: 'leaf',
          id: 'safety-monitor',
          label: 'nav.live_monitoring',
          href: '/admin/safety',
          icon: 'Radar',
          anyOf: [P.SAFETY_MONITOR],
        },
        {
          kind: 'leaf',
          id: 'safety-sos',
          label: 'nav.sos_alerts',
          href: '/admin/safety/sos',
          icon: 'Siren',
          anyOf: [P.SAFETY_MONITOR],
        },
      ],
    },

    // ── Configuration ────────────────────────────────────────────────────────
    {
      id: 'config',
      title: 'nav.configuration',
      anyOf: [P.WORKFLOW_STUDIO_READ, P.MODULE_INSTALL, P.SETTINGS_MANAGE, P.INTEGRATION_SETUP, P.IAM_MANAGE, P.TEMPLATE_WRITE, P.IAM_AUDIT, P.AGENCY_MANAGE, P.AGENCY_READ],
      items: [
        {
          kind: 'group',
          id: 'workflow-studio',
          label: 'nav.workflow_studio',
          icon: 'GitFork',
          anyOf: [P.WORKFLOW_STUDIO_READ, P.WORKFLOW_STUDIO_WRITE, P.WORKFLOW_SIMULATE],
          moduleKey: 'WORKFLOW_STUDIO',
          children: [
            { kind: 'leaf', id: 'wf-designer',    label: 'nav.workflow_editor',  href: '/admin/workflow-studio',            icon: 'PenLine',       anyOf: [P.WORKFLOW_STUDIO_WRITE] },
            { kind: 'leaf', id: 'wf-blueprints',  label: 'nav.blueprints',            href: '/admin/workflow-studio/blueprints', icon: 'ScrollText',    anyOf: [P.WORKFLOW_STUDIO_READ] },
            { kind: 'leaf', id: 'wf-marketplace', label: 'nav.marketplace',           href: '/admin/workflow-studio/market',     icon: 'Store',         anyOf: [P.WORKFLOW_MARKETPLACE] },
            { kind: 'leaf', id: 'wf-simulate',    label: 'nav.simulator',            href: '/admin/workflow-studio/simulate',   icon: 'PlayCircle',    anyOf: [P.WORKFLOW_SIMULATE] },
          ],
        },
        {
          kind: 'leaf',
          id: 'agencies',
          label: 'nav.agencies',
          href: '/admin/settings/agencies',
          icon: 'Building2',
          anyOf: [P.AGENCY_MANAGE, P.AGENCY_READ],
        },
        {
          kind: 'leaf',
          id: 'modules',
          label: 'nav.modules_extensions',
          href: '/admin/modules',
          icon: 'Puzzle',
          anyOf: [P.MODULE_INSTALL],
        },
        {
          kind: 'leaf',
          id: 'tenant-company',
          label: 'nav.company_info',
          href: '/admin/settings/company',
          icon: 'Building2',
          anyOf: [P.SETTINGS_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'white-label',
          label: 'nav.white_label_theme',
          href: '/admin/settings/branding',
          icon: 'Palette',
          anyOf: [P.SETTINGS_MANAGE],
          moduleKey: 'WHITE_LABEL',
        },
        {
          kind: 'leaf',
          id: 'integrations',
          label: 'nav.api_integrations',
          href: '/admin/integrations',
          icon: 'Link2',
          anyOf: [P.INTEGRATION_SETUP],
        },
        {
          kind: 'leaf',
          id: 'documents-templates',
          label: 'nav.document_templates',
          href: '/admin/templates',
          icon: 'FileType',
          anyOf: [P.TEMPLATE_WRITE, P.TEMPLATE_READ],
        },
        {
          kind: 'group',
          id: 'iam',
          label: 'nav.users_roles',
          icon: 'ShieldCheck',
          anyOf: [P.IAM_MANAGE, P.IAM_AUDIT],
          children: [
            { kind: 'leaf', id: 'iam-users',  label: 'nav.users', href: '/admin/iam/users',  icon: 'User',       anyOf: [P.IAM_MANAGE] },
            { kind: 'leaf', id: 'iam-roles',  label: 'nav.roles',        href: '/admin/iam/roles',  icon: 'Shield',     anyOf: [P.IAM_MANAGE] },
            { kind: 'leaf', id: 'iam-audit',  label: 'nav.access_log', href: '/admin/iam/audit',  icon: 'BookOpen',   anyOf: [P.IAM_AUDIT] },
            { kind: 'leaf', id: 'iam-sessions', label: 'nav.sessions',   href: '/admin/iam/sessions', icon: 'KeyRound',  anyOf: [P.IAM_MANAGE] },
          ],
        },
      ],
    },

    // ── Plateforme (SUPER_ADMIN uniquement) ───────────────────────────────────
    {
      id: 'platform',
      title: 'nav.platform',
      anyOf: [P.TENANT_MANAGE, P.PLATFORM_STAFF, P.IMPERSONATION_SWITCH, P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY],
      items: [
        {
          kind: 'leaf',
          id: 'tenants',
          label: 'nav.tenant_management',
          href: '/platform/tenants',
          icon: 'Building2',
          anyOf: [P.TENANT_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-staff',
          label: 'nav.platform_staff',
          href: '/platform/staff',
          icon: 'UserCog',
          anyOf: [P.PLATFORM_STAFF],
        },
        {
          kind: 'leaf',
          id: 'impersonation',
          label: 'nav.jit_impersonation',
          href: '/platform/impersonation',
          icon: 'UserCheck',
          anyOf: [P.IMPERSONATION_SWITCH],
        },
        {
          kind: 'group',
          id: 'debug',
          label: 'nav.technical_debug',
          icon: 'Terminal',
          anyOf: [P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY],
          children: [
            { kind: 'leaf', id: 'debug-workflow', label: 'nav.workflow_debug',   href: '/platform/debug/workflow', icon: 'Bug',     anyOf: [P.WORKFLOW_DEBUG] },
            { kind: 'leaf', id: 'debug-outbox',   label: 'nav.outbox_replay',    href: '/platform/debug/outbox',   icon: 'RefreshCw', anyOf: [P.OUTBOX_REPLAY] },
          ],
        },
      ],
    },

  ],
};

// ─── Portail Agent de Gare ────────────────────────────────────────────────────

export const STATION_AGENT_NAV: PortalNavConfig = {
  portalId: 'station-agent',
  sections: [
    {
      id: 'main',
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
      id: 'sa-ops',
      title: 'nav.cashier_finance',
      anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE],
      items: [
        { kind: 'leaf', id: 'sa-cashier',  label: 'nav.cashier',          href: '/agent/cashier',  icon: 'Landmark',        anyOf: [P.CASHIER_OPEN, P.CASHIER_TX] },
        { kind: 'leaf', id: 'sa-receipts', label: 'nav.receipts_tickets', href: '/agent/receipts', icon: 'Receipt',         anyOf: [P.TICKET_PRINT] },
      ],
    },
    {
      id: 'sa-display',
      title: 'nav.display',
      anyOf: [P.DISPLAY_UPDATE],
      items: [
        { kind: 'leaf', id: 'sa-display',  label: 'nav.station_screens',     href: '/agent/display',  icon: 'Monitor',         anyOf: [P.DISPLAY_UPDATE] },
      ],
    },
    {
      id: 'sa-sav',
      title: 'nav.after_sales',
      anyOf: [P.SAV_REPORT, P.SAV_DELIVER],
      items: [
        { kind: 'leaf', id: 'sa-sav',      label: 'nav.report_incident', href: '/agent/sav',    icon: 'MessageSquareWarning', anyOf: [P.SAV_REPORT] },
      ],
    },
  ],
};

// ─── Portail Agent de Quai ────────────────────────────────────────────────────

export const QUAI_AGENT_NAV: PortalNavConfig = {
  portalId: 'quai-agent',
  sections: [
    {
      id: 'qa-main',
      items: [
        { kind: 'leaf', id: 'qa-home',     label: 'nav.my_platform',        href: '/quai',           icon: 'LayoutDashboard', anyOf: [P.TRIP_UPDATE, P.MANIFEST_SIGN] },
        { kind: 'leaf', id: 'qa-scan',     label: 'nav.scan_ticket',  href: '/quai/scan',      icon: 'ScanLine',        anyOf: [P.TICKET_SCAN] },
        { kind: 'leaf', id: 'qa-boarding', label: 'nav.boarding',    href: '/quai/boarding',  icon: 'Users',           anyOf: [P.TRIP_UPDATE, P.TICKET_SCAN] },
        { kind: 'leaf', id: 'qa-manifest', label: 'nav.manifest',       href: '/quai/manifest',  icon: 'ClipboardList',   anyOf: [P.MANIFEST_SIGN, P.MANIFEST_GENERATE] },
        { kind: 'leaf', id: 'qa-luggage',  label: 'nav.luggage_check', href: '/quai/luggage',  icon: 'Luggage',         anyOf: [P.LUGGAGE_WEIGH] },
      ],
    },
    {
      id: 'qa-ops',
      title: 'nav.operations',
      anyOf: [P.TRIP_DELAY, P.DISPLAY_UPDATE],
      items: [
        { kind: 'leaf', id: 'qa-delay',    label: 'nav.declare_delay', href: '/quai/delay',     icon: 'Clock',           anyOf: [P.TRIP_DELAY] },
        { kind: 'leaf', id: 'qa-display',  label: 'nav.platform_screen',      href: '/quai/display',   icon: 'Monitor',         anyOf: [P.DISPLAY_UPDATE] },
      ],
    },
    {
      id: 'qa-sav',
      title: 'nav.after_sales',
      anyOf: [P.SAV_REPORT],
      items: [
        { kind: 'leaf', id: 'qa-sav',      label: 'nav.report_incident', href: '/quai/sav',     icon: 'AlertTriangle',   anyOf: [P.SAV_REPORT] },
      ],
    },
  ],
};

// ─── Espace Chauffeur ─────────────────────────────────────────────────────────

export const DRIVER_NAV: PortalNavConfig = {
  portalId: 'driver',
  sections: [
    {
      id: 'drv-main',
      items: [
        { kind: 'leaf', id: 'drv-home',     label: 'nav.my_trip',       href: '/driver',              icon: 'MapPin',        anyOf: [P.TRIP_READ_OWN, P.TRIP_CHECK_OWN] },
        { kind: 'leaf', id: 'drv-manifest', label: 'nav.manifest',        href: '/driver/manifest',     icon: 'ClipboardList', anyOf: [P.MANIFEST_READ_OWN] },
        { kind: 'leaf', id: 'drv-checkin',  label: 'nav.passenger_check',  href: '/driver/checkin',      icon: 'Users',         anyOf: [P.TRIP_CHECK_OWN] },
        { kind: 'leaf', id: 'drv-events',   label: 'nav.logbook',  href: '/driver/events',       icon: 'ScrollText',    anyOf: [P.TRIP_LOG_EVENT] },
        { kind: 'leaf', id: 'drv-briefing', label: 'nav.pre_departure_briefing', href: '/driver/briefing',  icon: 'ClipboardCheck', anyOf: [P.DRIVER_REST_OWN], moduleKey: 'CREW_BRIEFING' },
      ],
    },
    {
      id: 'drv-ops',
      title: 'nav.operations',
      anyOf: [P.TRIP_REPORT_OWN, P.MAINTENANCE_UPDATE],
      items: [
        { kind: 'leaf', id: 'drv-report',   label: 'nav.trip_report', href: '/driver/report',      icon: 'FileText',      anyOf: [P.TRIP_REPORT_OWN] },
        { kind: 'leaf', id: 'drv-maint',    label: 'nav.report_breakdown',    href: '/driver/maintenance', icon: 'Wrench',        anyOf: [P.MAINTENANCE_UPDATE] },
      ],
    },
    {
      id: 'drv-personal',
      title: 'nav.my_space',
      items: [
        { kind: 'leaf', id: 'drv-schedule', label: 'nav.my_schedule',      href: '/driver/schedule',    icon: 'Calendar' },
        { kind: 'leaf', id: 'drv-docs',     label: 'nav.my_documents',     href: '/driver/documents',   icon: 'FileCheck',     anyOf: [P.DRIVER_REST_OWN, P.DRIVER_PROFILE] },
        { kind: 'leaf', id: 'drv-rest',     label: 'nav.my_rest_times', href: '/driver/rest',       icon: 'Coffee',        anyOf: [P.DRIVER_REST_OWN] },
        { kind: 'leaf', id: 'drv-feedback', label: 'nav.traveler_feedback', href: '/driver/feedback',    icon: 'Star',          anyOf: [P.FEEDBACK_SUBMIT] },
      ],
    },
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
      id: 'cust-support',
      title: 'nav.support',
      anyOf: [P.SAV_REPORT_OWN, P.FEEDBACK_SUBMIT],
      items: [
        { kind: 'leaf', id: 'cust-claim',    label: 'nav.claim',    href: '/customer/claim',    icon: 'MessageSquareWarning', anyOf: [P.SAV_REPORT_OWN] },
        { kind: 'leaf', id: 'cust-feedback', label: 'nav.leave_a_review', href: '/customer/feedback', icon: 'Star',                 anyOf: [P.FEEDBACK_SUBMIT] },
      ],
    },
  ],
};
