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
          label: 'Tableau de bord',
          href: '/admin',
          icon: 'LayoutDashboard',
          anyOf: [P.STATS_READ, P.TRIP_UPDATE, P.TICKET_READ_TENANT],
        },
        {
          kind: 'leaf',
          id: 'notifications',
          label: 'Notifications',
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
      title: 'Opérations',
      anyOf: [P.TRIP_CREATE, P.TRIP_UPDATE, P.TICKET_CREATE, P.TICKET_READ_TENANT, P.PARCEL_CREATE, P.MANIFEST_GENERATE, P.SAV_CLAIM],
      items: [
        {
          kind: 'group',
          id: 'trips',
          label: 'Trajets & Planning',
          icon: 'MapPin',
          anyOf: [P.TRIP_CREATE, P.TRIP_UPDATE, P.ROUTE_MANAGE, P.TRIP_DELAY, P.TRIP_CANCEL],
          children: [
            { kind: 'leaf', id: 'trips-list',     label: 'Trajets du jour',    href: '/admin/trips',          icon: 'List',        anyOf: [P.TRIP_UPDATE, P.TRIP_CREATE] },
            { kind: 'leaf', id: 'trips-planning', label: 'Planning hebdomadaire', href: '/admin/trips/planning', icon: 'CalendarDays', anyOf: [P.TRIP_CREATE, P.ROUTE_MANAGE] },
            { kind: 'leaf', id: 'stations',       label: 'Gares & Stations',   href: '/admin/stations',       icon: 'MapPin',      anyOf: [P.STATION_MANAGE, P.STATION_READ] },
            { kind: 'leaf', id: 'routes',         label: 'Lignes & Routes',    href: '/admin/routes',         icon: 'Route',       anyOf: [P.ROUTE_MANAGE] },
            { kind: 'leaf', id: 'trips-delays',   label: 'Retards & Alertes',  href: '/admin/trips/delays',   icon: 'AlertTriangle', anyOf: [P.TRIP_DELAY, P.TRIP_UPDATE] },
          ],
        },
        {
          kind: 'group',
          id: 'ticketing',
          label: 'Billetterie',
          icon: 'Ticket',
          anyOf: [P.TICKET_CREATE, P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT, P.TICKET_CANCEL],
          children: [
            { kind: 'leaf', id: 'tickets-new',    label: 'Vendre un billet',   href: '/admin/tickets/new',    icon: 'Plus',        anyOf: [P.TICKET_CREATE] },
            { kind: 'leaf', id: 'tickets-list',   label: 'Billets émis',       href: '/admin/tickets',        icon: 'List',        anyOf: [P.TICKET_READ_AGENCY, P.TICKET_READ_TENANT] },
            { kind: 'leaf', id: 'tickets-cancel', label: 'Annulations',        href: '/admin/tickets/cancel', icon: 'XCircle',     anyOf: [P.TICKET_CANCEL] },
            { kind: 'leaf', id: 'manifests',      label: 'Manifestes',         href: '/admin/manifests',      icon: 'ClipboardList', anyOf: [P.MANIFEST_GENERATE, P.MANIFEST_READ_OWN] },
          ],
        },
        {
          kind: 'group',
          id: 'logistics',
          label: 'Colis & Logistique',
          icon: 'Package',
          anyOf: [P.PARCEL_CREATE, P.PARCEL_UPDATE_AGENCY, P.PARCEL_UPDATE_TENANT, P.SHIPMENT_GROUP],
          children: [
            { kind: 'leaf', id: 'parcel-new',     label: 'Enregistrer un colis', href: '/admin/parcels/new',  icon: 'PackagePlus', anyOf: [P.PARCEL_CREATE] },
            { kind: 'leaf', id: 'parcels-list',   label: 'Suivi colis',         href: '/admin/parcels',       icon: 'Truck',       anyOf: [P.PARCEL_UPDATE_AGENCY, P.PARCEL_UPDATE_TENANT] },
            { kind: 'leaf', id: 'shipments',      label: 'Expéditions groupées', href: '/admin/shipments',    icon: 'Boxes',       anyOf: [P.SHIPMENT_GROUP] },
          ],
        },
        {
          kind: 'group',
          id: 'sav',
          label: 'SAV & Réclamations',
          icon: 'MessageSquareWarning',
          anyOf: [P.SAV_CLAIM, P.SAV_REPORT, P.SAV_DELIVER],
          moduleKey: 'SAV_MODULE',
          children: [
            { kind: 'leaf', id: 'sav-claims',    label: 'Réclamations',        href: '/admin/sav/claims',    icon: 'FileWarning', anyOf: [P.SAV_CLAIM] },
            { kind: 'leaf', id: 'sav-reports',   label: 'Signalements',        href: '/admin/sav/reports',   icon: 'Flag',        anyOf: [P.SAV_REPORT] },
            { kind: 'leaf', id: 'sav-returns',   label: 'Remboursements',      href: '/admin/sav/returns',   icon: 'RotateCcw',   anyOf: [P.SAV_CLAIM, P.SAV_DELIVER] },
          ],
        },
      ],
    },

    // ── Finance ──────────────────────────────────────────────────────────────
    {
      id: 'finance',
      title: 'Finance',
      anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE, P.PRICING_MANAGE, P.PRICING_YIELD, P.PRICING_READ, P.INVOICE_PRINT],
      items: [
        {
          kind: 'leaf',
          id: 'cashier',
          label: 'Caisse',
          href: '/admin/cashier',
          icon: 'Landmark',
          anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE],
        },
        {
          kind: 'group',
          id: 'pricing',
          label: 'Tarification',
          icon: 'Tags',
          anyOf: [P.PRICING_MANAGE, P.PRICING_YIELD, P.PRICING_READ],
          children: [
            { kind: 'leaf', id: 'pricing-grid',   label: 'Grille tarifaire',    href: '/admin/pricing',        icon: 'Grid3x3',     anyOf: [P.PRICING_MANAGE, P.PRICING_READ] },
            { kind: 'leaf', id: 'pricing-yield',  label: 'Yield Management',    href: '/admin/pricing/yield',  icon: 'TrendingUp',  anyOf: [P.PRICING_YIELD], moduleKey: 'YIELD_ENGINE' },
            { kind: 'leaf', id: 'pricing-promo',  label: 'Promotions',          href: '/admin/pricing/promo',  icon: 'Percent',     anyOf: [P.PRICING_MANAGE], wip: true },
          ],
        },
        {
          kind: 'leaf',
          id: 'invoices',
          label: 'Facturation',
          href: '/admin/invoices',
          icon: 'Receipt',
          anyOf: [P.INVOICE_PRINT],
        },
      ],
    },

    // ── Intelligence & Analytics ─────────────────────────────────────────────
    {
      id: 'intelligence',
      title: 'Intelligence',
      anyOf: [P.STATS_READ],
      items: [
        {
          kind: 'leaf',
          id: 'analytics',
          label: 'Tableaux analytiques',
          href: '/admin/analytics',
          icon: 'BarChart3',
          anyOf: [P.STATS_READ],
        },
        {
          kind: 'group',
          id: 'ai',
          label: 'Recommandations IA',
          icon: 'Brain',
          anyOf: [P.STATS_READ],
          children: [
            { kind: 'leaf', id: 'ai-routes',      label: 'Lignes rentables',    href: '/admin/ai/routes',      icon: 'TrendingUp',  anyOf: [P.STATS_READ] },
            { kind: 'leaf', id: 'ai-fleet',       label: 'Optimisation flotte', href: '/admin/ai/fleet',       icon: 'Bus',         anyOf: [P.STATS_READ, P.FLEET_MANAGE] },
            { kind: 'leaf', id: 'ai-demand',      label: 'Prévisions demande',  href: '/admin/ai/demand',      icon: 'Activity',    anyOf: [P.STATS_READ], wip: true },
            { kind: 'leaf', id: 'ai-pricing',     label: 'Tarifs dynamiques',   href: '/admin/ai/pricing',     icon: 'Zap',         anyOf: [P.PRICING_YIELD, P.STATS_READ], wip: true },
          ],
        },
        {
          kind: 'leaf',
          id: 'reports',
          label: 'Rapports périodiques',
          href: '/admin/reports',
          icon: 'FileBarChart',
          anyOf: [P.STATS_READ],
        },
      ],
    },

    // ── Flotte ───────────────────────────────────────────────────────────────
    {
      id: 'fleet',
      title: 'Flotte',
      anyOf: [P.FLEET_MANAGE, P.FLEET_LAYOUT, P.FLEET_STATUS, P.MAINTENANCE_APPROVE, P.MAINTENANCE_UPDATE, P.DRIVER_MANAGE],
      items: [
        {
          kind: 'leaf',
          id: 'fleet-vehicles',
          label: 'Véhicules',
          href: '/admin/fleet',
          icon: 'Bus',
          anyOf: [P.FLEET_MANAGE, P.FLEET_STATUS],
        },
        {
          kind: 'leaf',
          id: 'fleet-seats',
          label: 'Plans de sièges',
          href: '/admin/fleet/seats',
          icon: 'LayoutGrid',
          anyOf: [P.FLEET_LAYOUT],
        },
        {
          kind: 'group',
          id: 'maintenance',
          label: 'Maintenance / Garage',
          icon: 'Wrench',
          anyOf: [P.MAINTENANCE_APPROVE, P.MAINTENANCE_UPDATE],
          moduleKey: 'GARAGE_PRO',
          children: [
            { kind: 'leaf', id: 'maintenance-list',     label: 'Fiches de maintenance',  href: '/admin/maintenance',          icon: 'ClipboardCheck', anyOf: [P.MAINTENANCE_APPROVE] },
            { kind: 'leaf', id: 'maintenance-planning', label: 'Planning garage',         href: '/admin/maintenance/planning', icon: 'CalendarClock',  anyOf: [P.MAINTENANCE_APPROVE] },
            { kind: 'leaf', id: 'maintenance-alerts',   label: 'Alertes techniques',      href: '/admin/maintenance/alerts',   icon: 'AlertCircle',    anyOf: [P.MAINTENANCE_APPROVE, P.FLEET_STATUS] },
          ],
        },
        {
          kind: 'group',
          id: 'fleet-docs',
          label: 'Documents & Consommables',
          icon: 'FileCheck',
          anyOf: [P.FLEET_MANAGE, P.DRIVER_MANAGE],
          moduleKey: 'FLEET_DOCS',
          children: [
            { kind: 'leaf', id: 'fleet-docs-alerts',      label: 'Documents en alerte',   href: '/admin/fleet-docs',                icon: 'FileWarning',    anyOf: [P.FLEET_MANAGE] },
            { kind: 'leaf', id: 'fleet-docs-consumables', label: 'Consommables',           href: '/admin/fleet-docs/consumables',    icon: 'Gauge',          anyOf: [P.FLEET_MANAGE] },
            { kind: 'leaf', id: 'fleet-docs-config',      label: 'Configuration docs',     href: '/admin/fleet-docs/config',         icon: 'Settings',       anyOf: [P.FLEET_MANAGE] },
          ],
        },
      ],
    },

    // ── Personnel & Équipages ─────────────────────────────────────────────────
    {
      id: 'staff',
      title: 'Personnel',
      anyOf: [P.CREW_MANAGE, P.STAFF_MANAGE, P.STAFF_READ, P.DRIVER_MANAGE, P.DRIVER_PROFILE],
      items: [
        {
          kind: 'leaf',
          id: 'drivers',
          label: 'Chauffeurs',
          icon: 'Steer',
          href: '/admin/drivers',
          anyOf: [P.CREW_MANAGE, P.STAFF_MANAGE, P.DRIVER_MANAGE, P.DRIVER_PROFILE],
          moduleKey: 'DRIVER_PROFILE',
        },
        {
          kind: 'leaf',
          id: 'staff-list',
          label: 'Tout le personnel',
          href: '/admin/staff',
          icon: 'Users',
          anyOf: [P.STAFF_MANAGE, P.STAFF_READ],
        },
        {
          kind: 'group',
          id: 'crew',
          label: 'Équipages',
          icon: 'UsersRound',
          anyOf: [P.CREW_MANAGE],
          moduleKey: 'CREW_BRIEFING',
          children: [
            { kind: 'leaf', id: 'crew-planning',   label: 'Planning équipages',  href: '/admin/crew/planning',  icon: 'CalendarRange',  anyOf: [P.CREW_MANAGE] },
            { kind: 'leaf', id: 'crew-briefing',   label: 'Briefings pré-départ', href: '/admin/crew/briefing', icon: 'ClipboardCheck', anyOf: [P.CREW_MANAGE] },
          ],
        },
      ],
    },

    // ── QHSE & Sécurité opérationnelle ────────────────────────────────────────
    {
      id: 'qhse',
      title: 'QHSE',
      anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT],
      items: [
        {
          kind: 'group',
          id: 'qhse-accidents',
          label: 'Accidents & Incidents',
          icon: 'AlertOctagon',
          anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT],
          moduleKey: 'QHSE',
          children: [
            { kind: 'leaf', id: 'qhse-accidents-list',   label: 'Rapports d\'accidents', href: '/admin/qhse/accidents',          icon: 'FileWarning',    anyOf: [P.QHSE_MANAGE, P.ACCIDENT_REPORT] },
            { kind: 'leaf', id: 'qhse-disputes',         label: 'Litiges & Sinistres',    href: '/admin/qhse/disputes',          icon: 'Gavel',          anyOf: [P.QHSE_MANAGE] },
          ],
        },
        {
          kind: 'leaf',
          id: 'qhse-procedures',
          label: 'Procédures QHSE',
          href: '/admin/qhse/procedures',
          icon: 'ListChecks',
          anyOf: [P.QHSE_MANAGE],
          moduleKey: 'QHSE',
        },
        {
          kind: 'leaf',
          id: 'qhse-config',
          label: 'Configuration QHSE',
          href: '/admin/qhse/config',
          icon: 'Settings',
          anyOf: [P.QHSE_MANAGE],
        },
      ],
    },

    // ── Commercial & CRM ─────────────────────────────────────────────────────
    {
      id: 'crm',
      title: 'Commercial',
      anyOf: [P.CRM_READ, P.CAMPAIGN_MANAGE],
      moduleKey: 'CRM',
      items: [
        {
          kind: 'leaf',
          id: 'crm-clients',
          label: 'Clients / CRM',
          href: '/admin/crm',
          icon: 'Users2',
          anyOf: [P.CRM_READ],
        },
        {
          kind: 'leaf',
          id: 'crm-campaigns',
          label: 'Campagnes',
          href: '/admin/crm/campaigns',
          icon: 'Megaphone',
          anyOf: [P.CAMPAIGN_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'crm-loyalty',
          label: 'Programme fidélité',
          href: '/admin/crm/loyalty',
          icon: 'Star',
          anyOf: [P.CRM_READ], wip: true,
        },
        {
          kind: 'leaf',
          id: 'crm-feedback',
          label: 'Avis & Feedbacks',
          href: '/admin/crm/feedback',
          icon: 'MessageCircle',
          anyOf: [P.CRM_READ],
        },
      ],
    },

    // ── Affichage & Gare ─────────────────────────────────────────────────────
    {
      id: 'display',
      title: 'Affichage & Gare',
      anyOf: [P.DISPLAY_UPDATE, P.TRIP_UPDATE],
      items: [
        {
          kind: 'leaf',
          id: 'display-screens',
          label: 'Écrans & afficheurs',
          href: '/admin/display',
          icon: 'Monitor',
          anyOf: [P.DISPLAY_UPDATE],
        },
        {
          kind: 'leaf',
          id: 'display-quais',
          label: 'Gestion des quais',
          href: '/admin/display/quais',
          icon: 'MapPinned',
          anyOf: [P.TRIP_UPDATE, P.DISPLAY_UPDATE],
        },
        {
          kind: 'leaf',
          id: 'display-announcements',
          label: 'Annonces gare',
          href: '/admin/display/announcements',
          icon: 'Volume2',
          anyOf: [P.DISPLAY_UPDATE],
        },
      ],
    },

    // ── Sécurité & Incidents ─────────────────────────────────────────────────
    {
      id: 'safety',
      title: 'Sécurité',
      anyOf: [P.SAFETY_MONITOR, P.SAV_REPORT],
      items: [
        {
          kind: 'leaf',
          id: 'safety-incidents',
          label: 'Incidents',
          href: '/admin/safety/incidents',
          icon: 'ShieldAlert',
          anyOf: [P.SAFETY_MONITOR, P.SAV_REPORT],
        },
        {
          kind: 'leaf',
          id: 'safety-monitor',
          label: 'Suivi temps réel',
          href: '/admin/safety',
          icon: 'Radar',
          anyOf: [P.SAFETY_MONITOR],
        },
        {
          kind: 'leaf',
          id: 'safety-sos',
          label: 'Alertes SOS',
          href: '/admin/safety/sos',
          icon: 'Siren',
          anyOf: [P.SAFETY_MONITOR],
        },
      ],
    },

    // ── Configuration ────────────────────────────────────────────────────────
    {
      id: 'config',
      title: 'Configuration',
      anyOf: [P.WORKFLOW_STUDIO_READ, P.MODULE_INSTALL, P.SETTINGS_MANAGE, P.INTEGRATION_SETUP, P.IAM_MANAGE, P.TEMPLATE_WRITE, P.IAM_AUDIT, P.AGENCY_MANAGE, P.AGENCY_READ],
      items: [
        {
          kind: 'group',
          id: 'workflow-studio',
          label: 'Workflow Studio',
          icon: 'GitFork',
          anyOf: [P.WORKFLOW_STUDIO_READ, P.WORKFLOW_STUDIO_WRITE, P.WORKFLOW_SIMULATE],
          moduleKey: 'WORKFLOW_STUDIO',
          children: [
            { kind: 'leaf', id: 'wf-designer',    label: 'Éditeur de workflows',  href: '/admin/workflow-studio',            icon: 'PenLine',       anyOf: [P.WORKFLOW_STUDIO_WRITE] },
            { kind: 'leaf', id: 'wf-blueprints',  label: 'Blueprints',            href: '/admin/workflow-studio/blueprints', icon: 'ScrollText',    anyOf: [P.WORKFLOW_STUDIO_READ] },
            { kind: 'leaf', id: 'wf-marketplace', label: 'Marketplace',           href: '/admin/workflow-studio/market',     icon: 'Store',         anyOf: [P.WORKFLOW_MARKETPLACE] },
            { kind: 'leaf', id: 'wf-simulate',    label: 'Simulateur',            href: '/admin/workflow-studio/simulate',   icon: 'PlayCircle',    anyOf: [P.WORKFLOW_SIMULATE] },
          ],
        },
        {
          kind: 'leaf',
          id: 'agencies',
          label: 'Agences',
          href: '/admin/settings/agencies',
          icon: 'Building2',
          anyOf: [P.AGENCY_MANAGE, P.AGENCY_READ],
        },
        {
          kind: 'leaf',
          id: 'modules',
          label: 'Modules & Extensions',
          href: '/admin/modules',
          icon: 'Puzzle',
          anyOf: [P.MODULE_INSTALL],
        },
        {
          kind: 'leaf',
          id: 'tenant-company',
          label: 'Informations société',
          href: '/admin/settings/company',
          icon: 'Building2',
          anyOf: [P.SETTINGS_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'white-label',
          label: 'White-label & Thème',
          href: '/admin/settings/branding',
          icon: 'Palette',
          anyOf: [P.SETTINGS_MANAGE],
          moduleKey: 'WHITE_LABEL',
        },
        {
          kind: 'leaf',
          id: 'integrations',
          label: 'Intégrations API',
          href: '/admin/integrations',
          icon: 'Link2',
          anyOf: [P.INTEGRATION_SETUP],
        },
        {
          kind: 'leaf',
          id: 'documents-templates',
          label: 'Modèles de documents',
          href: '/admin/templates',
          icon: 'FileType',
          anyOf: [P.TEMPLATE_WRITE, P.TEMPLATE_READ],
        },
        {
          kind: 'group',
          id: 'iam',
          label: 'Utilisateurs & Rôles',
          icon: 'ShieldCheck',
          anyOf: [P.IAM_MANAGE, P.IAM_AUDIT],
          children: [
            { kind: 'leaf', id: 'iam-users',  label: 'Utilisateurs', href: '/admin/iam/users',  icon: 'User',       anyOf: [P.IAM_MANAGE] },
            { kind: 'leaf', id: 'iam-roles',  label: 'Rôles',        href: '/admin/iam/roles',  icon: 'Shield',     anyOf: [P.IAM_MANAGE] },
            { kind: 'leaf', id: 'iam-audit',  label: 'Journal accès', href: '/admin/iam/audit',  icon: 'BookOpen',   anyOf: [P.IAM_AUDIT] },
            { kind: 'leaf', id: 'iam-sessions', label: 'Sessions',   href: '/admin/iam/sessions', icon: 'KeyRound',  anyOf: [P.IAM_MANAGE] },
          ],
        },
      ],
    },

    // ── Plateforme (SUPER_ADMIN uniquement) ───────────────────────────────────
    {
      id: 'platform',
      title: 'Plateforme',
      anyOf: [P.TENANT_MANAGE, P.PLATFORM_STAFF, P.IMPERSONATION_SWITCH, P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY],
      items: [
        {
          kind: 'leaf',
          id: 'tenants',
          label: 'Gestion des tenants',
          href: '/platform/tenants',
          icon: 'Building2',
          anyOf: [P.TENANT_MANAGE],
        },
        {
          kind: 'leaf',
          id: 'platform-staff',
          label: 'Staff plateforme',
          href: '/platform/staff',
          icon: 'UserCog',
          anyOf: [P.PLATFORM_STAFF],
        },
        {
          kind: 'leaf',
          id: 'impersonation',
          label: 'Impersonation JIT',
          href: '/platform/impersonation',
          icon: 'UserCheck',
          anyOf: [P.IMPERSONATION_SWITCH],
        },
        {
          kind: 'group',
          id: 'debug',
          label: 'Debug technique',
          icon: 'Terminal',
          anyOf: [P.WORKFLOW_DEBUG, P.OUTBOX_REPLAY],
          children: [
            { kind: 'leaf', id: 'debug-workflow', label: 'Workflow debug',   href: '/platform/debug/workflow', icon: 'Bug',     anyOf: [P.WORKFLOW_DEBUG] },
            { kind: 'leaf', id: 'debug-outbox',   label: 'Outbox replay',    href: '/platform/debug/outbox',   icon: 'RefreshCw', anyOf: [P.OUTBOX_REPLAY] },
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
        { kind: 'leaf', id: 'sa-home',     label: 'Vue d\'ensemble', href: '/agent',          icon: 'LayoutDashboard', anyOf: [P.TICKET_CREATE, P.TICKET_SCAN] },
        { kind: 'leaf', id: 'sa-sell',     label: 'Vendre billet',   href: '/agent/sell',     icon: 'Ticket',          anyOf: [P.TICKET_CREATE] },
        { kind: 'leaf', id: 'sa-checkin',  label: 'Check-in',        href: '/agent/checkin',  icon: 'ScanLine',        anyOf: [P.TICKET_SCAN, P.TRAVELER_VERIFY] },
        { kind: 'leaf', id: 'sa-luggage',  label: 'Bagages',         href: '/agent/luggage',  icon: 'Luggage',         anyOf: [P.LUGGAGE_WEIGH] },
        { kind: 'leaf', id: 'sa-parcel',   label: 'Colis',           href: '/agent/parcel',   icon: 'Package',         anyOf: [P.PARCEL_CREATE, P.PARCEL_SCAN] },
        { kind: 'leaf', id: 'sa-manifest', label: 'Manifestes',      href: '/agent/manifests', icon: 'ClipboardList', anyOf: [P.MANIFEST_GENERATE] },
      ],
    },
    {
      id: 'sa-ops',
      title: 'Caisse & Finance',
      anyOf: [P.CASHIER_OPEN, P.CASHIER_TX, P.CASHIER_CLOSE],
      items: [
        { kind: 'leaf', id: 'sa-cashier',  label: 'Caisse',          href: '/agent/cashier',  icon: 'Landmark',        anyOf: [P.CASHIER_OPEN, P.CASHIER_TX] },
        { kind: 'leaf', id: 'sa-receipts', label: 'Reçus & Billets', href: '/agent/receipts', icon: 'Receipt',         anyOf: [P.TICKET_PRINT] },
      ],
    },
    {
      id: 'sa-display',
      title: 'Affichage',
      anyOf: [P.DISPLAY_UPDATE],
      items: [
        { kind: 'leaf', id: 'sa-display',  label: 'Écrans gare',     href: '/agent/display',  icon: 'Monitor',         anyOf: [P.DISPLAY_UPDATE] },
      ],
    },
    {
      id: 'sa-sav',
      title: 'SAV',
      anyOf: [P.SAV_REPORT, P.SAV_DELIVER],
      items: [
        { kind: 'leaf', id: 'sa-sav',      label: 'Signaler incident', href: '/agent/sav',    icon: 'MessageSquareWarning', anyOf: [P.SAV_REPORT] },
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
        { kind: 'leaf', id: 'qa-home',     label: 'Mon quai',        href: '/quai',           icon: 'LayoutDashboard', anyOf: [P.TRIP_UPDATE, P.MANIFEST_SIGN] },
        { kind: 'leaf', id: 'qa-scan',     label: 'Scanner billet',  href: '/quai/scan',      icon: 'ScanLine',        anyOf: [P.TICKET_SCAN] },
        { kind: 'leaf', id: 'qa-boarding', label: 'Embarquement',    href: '/quai/boarding',  icon: 'Users',           anyOf: [P.TRIP_UPDATE, P.TICKET_SCAN] },
        { kind: 'leaf', id: 'qa-manifest', label: 'Manifeste',       href: '/quai/manifest',  icon: 'ClipboardList',   anyOf: [P.MANIFEST_SIGN, P.MANIFEST_GENERATE] },
        { kind: 'leaf', id: 'qa-luggage',  label: 'Contrôle bagages', href: '/quai/luggage',  icon: 'Luggage',         anyOf: [P.LUGGAGE_WEIGH] },
      ],
    },
    {
      id: 'qa-ops',
      title: 'Opérations',
      anyOf: [P.TRIP_DELAY, P.DISPLAY_UPDATE],
      items: [
        { kind: 'leaf', id: 'qa-delay',    label: 'Déclarer retard', href: '/quai/delay',     icon: 'Clock',           anyOf: [P.TRIP_DELAY] },
        { kind: 'leaf', id: 'qa-display',  label: 'Écran quai',      href: '/quai/display',   icon: 'Monitor',         anyOf: [P.DISPLAY_UPDATE] },
      ],
    },
    {
      id: 'qa-sav',
      title: 'SAV',
      anyOf: [P.SAV_REPORT],
      items: [
        { kind: 'leaf', id: 'qa-sav',      label: 'Signaler incident', href: '/quai/sav',     icon: 'AlertTriangle',   anyOf: [P.SAV_REPORT] },
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
        { kind: 'leaf', id: 'drv-home',     label: 'Mon trajet',       href: '/driver',              icon: 'MapPin',        anyOf: [P.TRIP_READ_OWN, P.TRIP_CHECK_OWN] },
        { kind: 'leaf', id: 'drv-manifest', label: 'Manifeste',        href: '/driver/manifest',     icon: 'ClipboardList', anyOf: [P.MANIFEST_READ_OWN] },
        { kind: 'leaf', id: 'drv-checkin',  label: 'Check passagers',  href: '/driver/checkin',      icon: 'Users',         anyOf: [P.TRIP_CHECK_OWN] },
        { kind: 'leaf', id: 'drv-events',   label: 'Journal de bord',  href: '/driver/events',       icon: 'ScrollText',    anyOf: [P.TRIP_LOG_EVENT] },
      ],
    },
    {
      id: 'drv-ops',
      title: 'Opérations',
      anyOf: [P.TRIP_REPORT_OWN, P.MAINTENANCE_UPDATE],
      items: [
        { kind: 'leaf', id: 'drv-report',   label: 'Rapport de voyage', href: '/driver/report',      icon: 'FileText',      anyOf: [P.TRIP_REPORT_OWN] },
        { kind: 'leaf', id: 'drv-maint',    label: 'Signaler panne',    href: '/driver/maintenance', icon: 'Wrench',        anyOf: [P.MAINTENANCE_UPDATE] },
      ],
    },
    {
      id: 'drv-personal',
      title: 'Mon espace',
      items: [
        { kind: 'leaf', id: 'drv-schedule', label: 'Mon planning',      href: '/driver/schedule',    icon: 'Calendar' },
        { kind: 'leaf', id: 'drv-docs',     label: 'Mes documents',     href: '/driver/documents',   icon: 'FileCheck',     anyOf: [P.DRIVER_REST_OWN, P.DRIVER_PROFILE] },
        { kind: 'leaf', id: 'drv-rest',     label: 'Mes temps de repos', href: '/driver/rest',       icon: 'Coffee',        anyOf: [P.DRIVER_REST_OWN] },
        { kind: 'leaf', id: 'drv-feedback', label: 'Feedback voyageur', href: '/driver/feedback',    icon: 'Star',          anyOf: [P.FEEDBACK_SUBMIT] },
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
        { kind: 'leaf', id: 'cust-home',    label: 'Accueil',      href: '/customer',           icon: 'Home' },
      ],
    },
    {
      id: 'cust-travel',
      title: 'Mes voyages',
      anyOf: [P.TICKET_READ_OWN],
      items: [
        { kind: 'leaf', id: 'cust-trips',   label: 'Mes billets',  href: '/customer/trips',     icon: 'Ticket',  anyOf: [P.TICKET_READ_OWN] },
      ],
    },
    {
      id: 'cust-shipping',
      title: 'Mes colis',
      anyOf: [P.PARCEL_READ_OWN, P.PARCEL_TRACK_OWN],
      items: [
        { kind: 'leaf', id: 'cust-parcels', label: 'Suivi colis',  href: '/customer/parcels',   icon: 'Package', anyOf: [P.PARCEL_READ_OWN, P.PARCEL_TRACK_OWN] },
      ],
    },
    {
      id: 'cust-support',
      title: 'Assistance',
      anyOf: [P.SAV_REPORT_OWN, P.FEEDBACK_SUBMIT],
      items: [
        { kind: 'leaf', id: 'cust-claim',    label: 'Réclamation',    href: '/customer/claim',    icon: 'MessageSquareWarning', anyOf: [P.SAV_REPORT_OWN] },
        { kind: 'leaf', id: 'cust-feedback', label: 'Donner un avis', href: '/customer/feedback', icon: 'Star',                 anyOf: [P.FEEDBACK_SUBMIT] },
      ],
    },
  ],
};
