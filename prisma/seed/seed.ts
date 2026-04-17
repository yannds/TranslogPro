/**
 * Prisma seed — Marketplace Blueprints TranslogPro
 *
 * Exécuter avec : npx prisma db seed
 *
 * Crée les blueprints système et publics du marketplace.
 * Idempotent : upsert par slug + version.
 */

import { PrismaClient } from '@prisma/client';
import { seedSystemTemplates } from '../../server/seed/templates/templates.seeder';
import { backfillVehicleDocumentTypes, backfillDefaultWorkflows } from '../seeds/iam.seed';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function edge(source: string, label: string, target: string, permission = '', guards: string[] = []) {
  return {
    id:          `${source}___${label}___${target}`,
    source,
    target,
    label,
    permission,
    guards,
    sideEffects: [] as string[],
    metadata:    {},
  };
}

function node(id: string, type: 'initial' | 'state' | 'terminal', x: number, y: number) {
  return { id, label: id.replace(/_/g, ' '), type, position: { x, y }, metadata: {} };
}

function graph(entityType: string, nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) {
  return { entityType, nodes, edges, version: '1.0.0', checksum: '', metadata: {} };
}

// ─── Blueprints ───────────────────────────────────────────────────────────────

const BLUEPRINTS = [

  // ── Ticket : cycle de vie complet ─────────────────────────────────────────
  {
    slug: 'ticket-full-lifecycle', name: 'Ticket — Cycle complet',
    description: 'DRAFT → CONFIRMED → BOARDED → COMPLETED avec annulation et remboursement possible. Idéal pour la billetterie passager standard.',
    entityType: 'Ticket', isPublic: true, isSystem: true, tags: ['ticket', 'billetterie', 'standard'],
    graphData: graph('Ticket', [
      node('DRAFT',       'initial',  60,  60),
      node('CONFIRMED',   'state',   280,  60),
      node('CHECKED_IN',  'state',   500,  60),
      node('BOARDED',     'state',   720,  60),
      node('COMPLETED',   'terminal', 940,  60),
      node('CANCELLED',   'terminal', 280, 220),
      node('REFUNDED',    'terminal', 500, 220),
      node('NO_SHOW',     'terminal', 720, 220),
    ], [
      edge('DRAFT',      'confirm',       'CONFIRMED',  'data.ticket.create.agency'),
      edge('CONFIRMED',  'check_in',      'CHECKED_IN', 'data.ticket.scan.agency'),
      edge('CONFIRMED',  'cancel',        'CANCELLED',  'data.ticket.cancel.agency'),
      edge('CHECKED_IN', 'board',         'BOARDED',    'data.traveler.verify.agency'),
      edge('CHECKED_IN', 'cancel',        'CANCELLED',  'data.ticket.cancel.agency'),
      edge('BOARDED',    'complete',      'COMPLETED',  'data.trip.update.agency'),
      edge('BOARDED',    'mark_no_show',  'NO_SHOW',    'data.trip.update.agency'),
      edge('CANCELLED',  'refund',        'REFUNDED',   'data.cashier.transaction.own'),
    ]),
  },

  // ── Ticket : express (sans check-in) ─────────────────────────────────────
  {
    slug: 'ticket-express', name: 'Ticket — Express (sans check-in)',
    description: 'Workflow simplifié : vente directe, embarquement, fin de trajet. Adapté aux courtes distances.',
    entityType: 'Ticket', isPublic: true, isSystem: false, tags: ['ticket', 'express', 'simplifié'],
    graphData: graph('Ticket', [
      node('SOLD',      'initial',  60,  80),
      node('BOARDING',  'state',   280,  80),
      node('DONE',      'terminal', 500,  80),
      node('VOIDED',    'terminal', 280, 220),
    ], [
      edge('SOLD',     'start_boarding', 'BOARDING', 'data.ticket.scan.agency'),
      edge('SOLD',     'void',           'VOIDED',   'data.ticket.cancel.agency'),
      edge('BOARDING', 'complete',       'DONE',     'data.trip.update.agency'),
      edge('BOARDING', 'void',           'VOIDED',   'data.ticket.cancel.agency'),
    ]),
  },

  // ── Trip : trajet planifié (ALIGNÉ sur runtime — workflow-states.ts) ─────
  // Les IDs d'état et d'action DOIVENT matcher DEFAULT_WORKFLOW_CONFIGS
  // (prisma/seeds/iam.seed.ts) pour que l'overlay node-type sur le graphe
  // actif du tenant fonctionne — sinon les scénarios ne se génèrent pas
  // (PageWfSimulate buildScenarios échoue sans état initial).
  {
    slug: 'trip-standard', name: 'Trajet — Opérationnel standard',
    description: 'PLANNED → OPEN → BOARDING → IN_PROGRESS → COMPLETED, avec pause/retard et annulation.',
    entityType: 'Trip', isPublic: true, isSystem: true, tags: ['trip', 'trajet', 'transport'],
    graphData: graph('Trip', [
      node('PLANNED',              'initial',   60,  80),
      node('OPEN',                 'state',    240,  80),
      node('BOARDING',             'state',    420,  80),
      node('IN_PROGRESS',          'state',    600,  80),
      node('COMPLETED',            'terminal', 780,  80),
      node('IN_PROGRESS_PAUSED',   'state',    600, 220),
      node('IN_PROGRESS_DELAYED',  'state',    780, 220),
      node('CANCELLED',            'terminal', 420, 220),
    ], [
      edge('PLANNED',             'START_BOARDING',  'OPEN',                 'data.trip.update.agency'),
      edge('PLANNED',             'CANCEL',          'CANCELLED',            'data.trip.update.agency'),
      edge('OPEN',                'BEGIN_BOARDING',  'BOARDING',             'data.trip.update.agency'),
      edge('BOARDING',            'DEPART',          'IN_PROGRESS',          'data.trip.update.agency'),
      edge('IN_PROGRESS',         'PAUSE',           'IN_PROGRESS_PAUSED',   'data.trip.report.own'),
      edge('IN_PROGRESS_PAUSED',  'RESUME',          'IN_PROGRESS',          'data.trip.report.own'),
      edge('IN_PROGRESS',         'REPORT_INCIDENT', 'IN_PROGRESS_DELAYED',  'data.trip.report.own'),
      edge('IN_PROGRESS_DELAYED', 'CLEAR_INCIDENT',  'IN_PROGRESS',          'data.trip.report.own'),
      edge('IN_PROGRESS',         'END_TRIP',        'COMPLETED',            'data.trip.update.agency'),
    ]),
  },

  // ── Trip : charter ────────────────────────────────────────────────────────
  {
    slug: 'trip-charter', name: 'Trajet — Affrètement / Charter',
    description: 'Workflow spécialisé pour les trajets charter avec pré-réservation et validation client.',
    entityType: 'Trip', isPublic: true, isSystem: false, tags: ['trip', 'charter', 'affrètement'],
    graphData: graph('Trip', [
      node('REQUESTED',  'initial',   60,  80),
      node('QUOTED',     'state',    280,  80),
      node('APPROVED',   'state',    500,  80),
      node('EXECUTING',  'state',    720,  80),
      node('COMPLETED',  'terminal', 940,  80),
      node('REJECTED',   'terminal', 280, 220),
      node('ABORTED',    'terminal', 720, 220),
    ], [
      edge('REQUESTED', 'send_quote',  'QUOTED',    'data.trip.create.tenant'),
      edge('QUOTED',    'approve',     'APPROVED',  'data.trip.create.tenant'),
      edge('QUOTED',    'reject',      'REJECTED',  'control.trip.cancel.tenant'),
      edge('APPROVED',  'start',       'EXECUTING', 'data.trip.update.agency'),
      edge('EXECUTING', 'complete',    'COMPLETED', 'data.trip.update.agency'),
      edge('EXECUTING', 'abort',       'ABORTED',   'control.trip.cancel.tenant'),
    ]),
  },

  // ── Parcel : colis standard ───────────────────────────────────────────────
  {
    slug: 'parcel-standard', name: 'Colis — Traçabilité complète',
    description: 'REGISTERED → SORTED → LOADED → IN_TRANSIT → DELIVERED. Gestion des pertes et retours.',
    entityType: 'Parcel', isPublic: true, isSystem: true, tags: ['parcel', 'colis', 'logistique'],
    graphData: graph('Parcel', [
      node('REGISTERED',  'initial',   60,  80),
      node('SORTED',      'state',    280,  80),
      node('LOADED',      'state',    500,  80),
      node('IN_TRANSIT',  'state',    720,  80),
      node('DELIVERED',   'terminal', 940,  80),
      node('MISSING',     'terminal', 500, 220),
      node('RETURNED',    'terminal', 720, 220),
    ], [
      edge('REGISTERED', 'sort',        'SORTED',     'data.parcel.scan.agency'),
      edge('SORTED',     'load',        'LOADED',     'data.parcel.update.agency'),
      edge('SORTED',     'mark_missing','MISSING',    'data.parcel.report.agency'),
      edge('LOADED',     'depart',      'IN_TRANSIT', 'data.parcel.update.agency'),
      edge('IN_TRANSIT', 'deliver',     'DELIVERED',  'data.parcel.update.agency'),
      edge('IN_TRANSIT', 'report_lost', 'MISSING',    'data.parcel.report.agency'),
      edge('IN_TRANSIT', 'return',      'RETURNED',   'data.parcel.update.agency'),
    ]),
  },

  // ── Bus : cycle opérationnel (ALIGNÉ sur runtime — workflow-states.ts) ───
  {
    slug: 'bus-maintenance', name: 'Bus — Cycle opérationnel',
    description: 'AVAILABLE → BOARDING → DEPARTED → ARRIVED → CLOSED, avec retour MAINTENANCE en cas d\'incident.',
    entityType: 'Bus', isPublic: true, isSystem: true, tags: ['bus', 'maintenance', 'flotte'],
    graphData: graph('Bus', [
      node('AVAILABLE',   'initial',   60,  80),
      node('BOARDING',    'state',    240,  80),
      node('DEPARTED',    'state',    420,  80),
      node('ARRIVED',     'state',    600,  80),
      // CLOSED marqué terminal pour la génération de scénarios (fin naturelle
      // d'un cycle journalier). L'edge RESTORE CLOSED→AVAILABLE reste valide
      // en runtime — le simulateur peut toujours l'emprunter.
      node('CLOSED',      'terminal', 780,  80),
      node('MAINTENANCE', 'state',    420, 220),
    ], [
      edge('AVAILABLE',   'OPEN_BOARDING',       'BOARDING',    'data.trip.update.agency'),
      edge('BOARDING',    'DEPART',              'DEPARTED',    'data.trip.update.agency'),
      edge('DEPARTED',    'ARRIVE',              'ARRIVED',     'data.trip.update.agency'),
      edge('ARRIVED',     'CLEAN',               'CLOSED',      'data.trip.update.agency'),
      edge('CLOSED',      'RESTORE',             'AVAILABLE',   'data.fleet.status.agency'),
      edge('AVAILABLE',   'INCIDENT_MECHANICAL', 'MAINTENANCE', 'data.maintenance.update.own'),
      edge('BOARDING',    'INCIDENT_MECHANICAL', 'MAINTENANCE', 'data.maintenance.update.own'),
      edge('DEPARTED',    'INCIDENT_MECHANICAL', 'MAINTENANCE', 'data.maintenance.update.own'),
      edge('MAINTENANCE', 'RESTORE',             'AVAILABLE',   'data.maintenance.approve.tenant'),
    ]),
  },

  // ── Fiche maintenance ─────────────────────────────────────────────────────
  {
    slug: 'maintenance-ticket', name: 'Maintenance — Fiche d\'intervention',
    description: 'Cycle de vie d\'une fiche de maintenance : OPEN → IN_PROGRESS → VALIDATED → CLOSED.',
    entityType: 'Maintenance', isPublic: true, isSystem: true, tags: ['maintenance', 'garage', 'intervention'],
    graphData: graph('Maintenance', [
      node('OPEN',        'initial',  60,  80),
      node('ASSIGNED',    'state',   280,  80),
      node('IN_PROGRESS', 'state',   500,  80),
      node('PENDING_PARTS', 'state', 500, 220),
      node('DONE',        'state',   720,  80),
      node('VALIDATED',   'terminal', 940, 80),
      node('CANCELLED',   'terminal', 720, 220),
    ], [
      edge('OPEN',          'assign',        'ASSIGNED',     'data.maintenance.approve.tenant'),
      edge('ASSIGNED',      'start_work',    'IN_PROGRESS',  'data.maintenance.update.own'),
      edge('ASSIGNED',      'cancel',        'CANCELLED',    'data.maintenance.approve.tenant'),
      edge('IN_PROGRESS',   'wait_parts',    'PENDING_PARTS','data.maintenance.update.own'),
      edge('IN_PROGRESS',   'complete',      'DONE',         'data.maintenance.update.own'),
      edge('PENDING_PARTS', 'parts_arrived', 'IN_PROGRESS',  'data.maintenance.update.own'),
      edge('DONE',          'validate',      'VALIDATED',    'data.maintenance.approve.tenant'),
      edge('DONE',          'reopen',        'IN_PROGRESS',  'data.maintenance.approve.tenant'),
    ]),
  },

  // ── Manifeste ─────────────────────────────────────────────────────────────
  {
    slug: 'manifest-standard', name: 'Manifeste — Signature & Archivage',
    description: 'DRAFT → SUBMITTED → SIGNED → ARCHIVED. Workflow de validation des manifestes de voyage.',
    entityType: 'Manifest', isPublic: true, isSystem: true, tags: ['manifest', 'signature', 'conformité'],
    graphData: graph('Manifest', [
      node('DRAFT',     'initial',  60,  80),
      node('SUBMITTED', 'state',   280,  80),
      node('SIGNED',    'state',   500,  80),
      node('ARCHIVED',  'terminal', 720, 80),
      node('REJECTED',  'terminal', 280, 220),
    ], [
      edge('DRAFT',     'submit',   'SUBMITTED', 'data.manifest.generate.agency'),
      edge('SUBMITTED', 'sign',     'SIGNED',    'data.manifest.sign.agency'),
      edge('SUBMITTED', 'reject',   'REJECTED',  'data.manifest.sign.agency'),
      edge('SIGNED',    'archive',  'ARCHIVED',  'data.manifest.print.agency'),
      edge('REJECTED',  'revise',   'DRAFT',     'data.manifest.generate.agency'),
    ]),
  },

  // ── Réclamation SAV ───────────────────────────────────────────────────────
  {
    slug: 'claim-sav', name: 'Réclamation SAV — Traitement complet',
    description: 'OPEN → INVESTIGATING → RESOLVED/REJECTED. Workflow SAV avec escalade possible.',
    entityType: 'Claim', isPublic: true, isSystem: true, tags: ['sav', 'réclamation', 'qualité'],
    graphData: graph('Claim', [
      node('OPEN',         'initial',  60,  80),
      node('ASSIGNED',     'state',   280,  80),
      node('INVESTIGATING','state',   500,  80),
      node('ESCALATED',    'state',   500, 220),
      node('RESOLVED',     'terminal', 720, 80),
      node('REJECTED',     'terminal', 720, 220),
    ], [
      edge('OPEN',          'assign',     'ASSIGNED',     'data.sav.report.agency'),
      edge('ASSIGNED',      'investigate','INVESTIGATING', 'data.sav.deliver.agency'),
      edge('INVESTIGATING', 'resolve',    'RESOLVED',     'data.sav.claim.tenant'),
      edge('INVESTIGATING', 'reject',     'REJECTED',     'data.sav.claim.tenant'),
      edge('INVESTIGATING', 'escalate',   'ESCALATED',    'data.sav.claim.tenant'),
      edge('ESCALATED',     'resolve',    'RESOLVED',     'data.sav.claim.tenant'),
      edge('ESCALATED',     'reject',     'REJECTED',     'data.sav.claim.tenant'),
    ]),
  },

  // ── Checklist départ ─────────────────────────────────────────────────────
  {
    slug: 'checklist-departure', name: 'Checklist — Pré-départ obligatoire',
    description: 'Vérifications pré-départ : technique, sécurité, documents. Bloque le départ si non validée.',
    entityType: 'Checklist', isPublic: true, isSystem: true, tags: ['checklist', 'sécurité', 'départ'],
    graphData: graph('Checklist', [
      node('PENDING',      'initial',  60,  80),
      node('TECH_CHECK',   'state',   280,  80),
      node('SAFETY_CHECK', 'state',   500,  80),
      node('DOCS_CHECK',   'state',   720,  80),
      node('APPROVED',     'terminal', 940, 80),
      node('BLOCKED',      'terminal', 500, 220),
    ], [
      edge('PENDING',      'start_tech',    'TECH_CHECK',   'data.maintenance.update.own'),
      edge('TECH_CHECK',   'pass_tech',     'SAFETY_CHECK', 'data.maintenance.update.own'),
      edge('TECH_CHECK',   'fail_tech',     'BLOCKED',      'data.maintenance.update.own'),
      edge('SAFETY_CHECK', 'pass_safety',   'DOCS_CHECK',   'data.trip.update.agency'),
      edge('SAFETY_CHECK', 'fail_safety',   'BLOCKED',      'data.trip.update.agency'),
      edge('DOCS_CHECK',   'approve_all',   'APPROVED',     'data.manifest.sign.agency'),
      edge('DOCS_CHECK',   'docs_missing',  'BLOCKED',      'data.manifest.sign.agency'),
      edge('BLOCKED',      'fix_and_retry', 'PENDING',      'data.maintenance.approve.tenant'),
    ]),
  },

  // ── Équipage — affectation et repos ──────────────────────────────────────
  {
    slug: 'crew-assignment', name: 'Équipage — Affectation & Repos',
    description: 'Gestion du cycle d\'affectation d\'un équipage : STANDBY → BRIEFING → ON_DUTY → DEBRIEFING → REST.',
    entityType: 'Crew', isPublic: true, isSystem: true, tags: ['équipage', 'RH', 'affectation'],
    graphData: graph('Crew', [
      node('STANDBY',    'initial',  60,  80),
      node('BRIEFING',   'state',   280,  80),
      node('ON_DUTY',    'state',   500,  80),
      node('DEBRIEFING', 'state',   720,  80),
      node('REST',       'state',   720, 220),
      node('SUSPENDED',  'terminal', 500, 220),
    ], [
      edge('STANDBY',    'assign_briefing', 'BRIEFING',   'control.driver.manage.tenant'),
      edge('BRIEFING',   'start_duty',      'ON_DUTY',    'data.trip.update.agency'),
      edge('BRIEFING',   'cancel',          'STANDBY',    'control.driver.manage.tenant'),
      edge('ON_DUTY',    'end_duty',        'DEBRIEFING', 'control.trip.log_event.own'),
      edge('ON_DUTY',    'emergency_off',   'SUSPENDED',  'control.driver.manage.tenant'),
      edge('DEBRIEFING', 'start_rest',      'REST',       'data.driver.rest.own'),
      edge('REST',       'rest_complete',   'STANDBY',    'data.driver.rest.own'),
      edge('SUSPENDED',  'reinstate',       'STANDBY',    'control.driver.manage.tenant'),
    ]),
  },

  // ── Voyageur (Traveler) — cycle passager sur un trajet ───────────────────
  {
    slug: 'traveler-journey', name: 'Voyageur — Embarquement & descente',
    description: 'Cycle passager sur un trajet : REGISTERED → VERIFIED → CHECKED_IN → BOARDED → ARRIVED → EXITED. Distinct du profil utilisateur.',
    entityType: 'Traveler', isPublic: true, isSystem: true, tags: ['voyageur', 'passager', 'embarquement'],
    graphData: graph('Traveler', [
      node('REGISTERED', 'initial',   60,  80),
      node('VERIFIED',   'state',    260,  80),
      node('CHECKED_IN', 'state',    460,  80),
      node('BOARDED',    'state',    660,  80),
      node('ARRIVED',    'state',    860,  80),
      node('EXITED',     'terminal', 1060, 80),
    ], [
      edge('REGISTERED', 'verify',     'VERIFIED',   'data.traveler.verify.agency'),
      edge('VERIFIED',   'scan_in',    'CHECKED_IN', 'data.ticket.scan.agency'),
      edge('CHECKED_IN', 'scan_board', 'BOARDED',    'data.traveler.verify.agency'),
      edge('BOARDED',    'scan_out',   'ARRIVED',    'data.traveler.verify.agency'),
      edge('ARRIVED',    'exit',       'EXITED',     'data.traveler.verify.agency'),
    ]),
  },

  // ── Shipment — groupage de colis ──────────────────────────────────────────
  {
    slug: 'shipment-grouping', name: 'Shipment — Groupage colis',
    description: 'Regroupement de colis pour un même trajet : OPEN → LOADED → IN_TRANSIT → ARRIVED → CLOSED.',
    entityType: 'Shipment', isPublic: true, isSystem: true, tags: ['shipment', 'colis', 'groupage'],
    graphData: graph('Shipment', [
      node('OPEN',       'initial',   60,  80),
      node('LOADED',     'state',    280,  80),
      node('IN_TRANSIT', 'state',    500,  80),
      node('ARRIVED',    'state',    720,  80),
      node('CLOSED',     'terminal', 940,  80),
    ], [
      edge('OPEN',       'load',    'LOADED',     'data.shipment.group.agency'),
      edge('LOADED',     'depart',  'IN_TRANSIT', 'data.trip.update.agency'),
      edge('IN_TRANSIT', 'arrive',  'ARRIVED',    'data.trip.update.agency'),
      edge('ARRIVED',    'close',   'CLOSED',     'data.shipment.group.agency'),
    ]),
  },

  // ── Chauffeur — disponibilité ─────────────────────────────────────────────
  {
    slug: 'driver-availability', name: 'Chauffeur — Disponibilité & Repos',
    description: 'Gestion de la disponibilité chauffeur : AVAILABLE → ON_DUTY → REST_REQUIRED → RESTING.',
    entityType: 'Driver', isPublic: true, isSystem: true, tags: ['chauffeur', 'RH', 'temps de repos'],
    graphData: graph('Driver', [
      node('AVAILABLE',    'initial',  60,  80),
      node('ASSIGNED',     'state',   280,  80),
      node('ON_DUTY',      'state',   500,  80),
      node('REST_REQUIRED','state',   720,  80),
      node('RESTING',      'state',   720, 220),
      node('SUSPENDED',    'terminal', 500, 220),
    ], [
      edge('AVAILABLE',     'assign',        'ASSIGNED',      'control.driver.manage.tenant'),
      edge('ASSIGNED',      'start_duty',    'ON_DUTY',       'data.trip.update.agency'),
      edge('ASSIGNED',      'unassign',      'AVAILABLE',     'control.driver.manage.tenant'),
      edge('ON_DUTY',       'end_shift',     'REST_REQUIRED', 'control.trip.log_event.own'),
      edge('ON_DUTY',       'emergency_off', 'SUSPENDED',     'control.driver.manage.tenant'),
      edge('REST_REQUIRED', 'start_rest',    'RESTING',       'data.driver.rest.own'),
      edge('RESTING',       'rest_complete', 'AVAILABLE',     'data.driver.rest.own'),
      edge('SUSPENDED',     'reinstate',     'AVAILABLE',     'control.driver.manage.tenant'),
    ]),
  },

  // ── Remboursement ────────────────────────────────────────────────────────
  {
    slug: 'refund-standard', name: 'Remboursement — Approbation standard',
    description: 'PENDING → APPROVED → PROCESSED ou REJECTED. Workflow d\'approbation des remboursements.',
    entityType: 'Refund', isPublic: true, isSystem: true, tags: ['remboursement', 'SAV', 'finance'],
    graphData: graph('Refund', [
      node('PENDING',   'initial',  60,  80),
      node('APPROVED',  'state',   280,  80),
      node('PROCESSED', 'terminal', 500,  80),
      node('REJECTED',  'terminal', 280, 220),
    ], [
      edge('PENDING',  'approve', 'APPROVED',  'data.refund.approve.tenant'),
      edge('PENDING',  'reject',  'REJECTED',  'data.refund.approve.tenant'),
      edge('APPROVED', 'process', 'PROCESSED', 'data.refund.process.tenant'),
      edge('APPROVED', 'reject',  'REJECTED',  'data.refund.approve.tenant'),
    ]),
  },

  // ── Caisse ───────────────────────────────────────────────────────────────
  {
    slug: 'cash-register-cycle', name: 'Caisse — Cycle ouverture / fermeture',
    description: 'CLOSED → OPEN → CLOSED, avec branche DISCREPANCY en cas d\'écart.',
    entityType: 'CashRegister', isPublic: true, isSystem: true, tags: ['caisse', 'comptabilité', 'cashier'],
    graphData: graph('CashRegister', [
      node('CLOSED',      'initial',  60,  80),
      node('OPEN',         'state',   280,  80),
      node('DISCREPANCY',  'state',   280, 220),
    ], [
      edge('CLOSED',      'open',    'OPEN',        'data.cashier.open.own'),
      edge('OPEN',         'close',   'CLOSED',      'data.cashier.close.agency'),
      edge('OPEN',         'flag',    'DISCREPANCY', 'data.cashier.close.agency'),
      edge('DISCREPANCY',  'resolve', 'CLOSED',      'data.cashier.close.agency'),
    ]),
  },

  // ── Incident ─────────────────────────────────────────────────────────────
  {
    slug: 'incident-resolution', name: 'Incident — Déclaration & Résolution',
    description: 'OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED. Workflow pour les événements exceptionnels (PRD §IV.11).',
    entityType: 'Incident', isPublic: true, isSystem: true, tags: ['incident', 'sécurité', 'QHSE'],
    graphData: graph('Incident', [
      node('OPEN',        'initial',  60,  80),
      node('ASSIGNED',    'state',   280,  80),
      node('IN_PROGRESS', 'state',   500,  80),
      node('RESOLVED',    'state',   720,  80),
      node('CLOSED',      'terminal', 940,  80),
    ], [
      edge('OPEN',        'assign',     'ASSIGNED',    'data.trip.update.agency'),
      edge('ASSIGNED',    'start_work', 'IN_PROGRESS', 'data.trip.report.own'),
      edge('IN_PROGRESS', 'resolve',    'RESOLVED',    'data.trip.report.own'),
      edge('RESOLVED',    'close',      'CLOSED',      'data.trip.update.agency'),
      edge('RESOLVED',    'reopen',     'IN_PROGRESS', 'data.trip.update.agency'),
    ]),
  },
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding workflow blueprints marketplace…');

  // Catégorie par défaut
  const cats = await Promise.all([
    prisma.blueprintCategory.upsert({
      where:  { slug: 'transport-core' },
      update: { name: 'Transport — Cœur', sortOrder: 1 },
      create: { name: 'Transport — Cœur', slug: 'transport-core', icon: '🚌', sortOrder: 1 },
    }),
    prisma.blueprintCategory.upsert({
      where:  { slug: 'operations' },
      update: { name: 'Opérations', sortOrder: 2 },
      create: { name: 'Opérations', slug: 'operations', icon: '⚙️', sortOrder: 2 },
    }),
    prisma.blueprintCategory.upsert({
      where:  { slug: 'qualite-sav' },
      update: { name: 'Qualité & SAV', sortOrder: 3 },
      create: { name: 'Qualité & SAV', slug: 'qualite-sav', icon: '🎗️', sortOrder: 3 },
    }),
    prisma.blueprintCategory.upsert({
      where:  { slug: 'rh-conformite' },
      update: { name: 'RH & Conformité', sortOrder: 4 },
      create: { name: 'RH & Conformité', slug: 'rh-conformite', icon: '👥', sortOrder: 4 },
    }),
  ]);

  const [transportCat, opsCat, qualiteCat, rhCat] = cats;

  const categoryMap: Record<string, string> = {
    Ticket:      transportCat!.id,
    Trip:        transportCat!.id,
    Traveler:    transportCat!.id,
    Parcel:      opsCat!.id,
    Shipment:    opsCat!.id,
    Bus:         opsCat!.id,
    Maintenance: opsCat!.id,
    Manifest:    opsCat!.id,
    Claim:        qualiteCat!.id,
    Checklist:    opsCat!.id,
    Driver:       rhCat!.id,
    Crew:         rhCat!.id,
    Refund:       qualiteCat!.id,
    CashRegister: opsCat!.id,
    Incident:     qualiteCat!.id,
  };

  let created = 0;
  let updated = 0;

  for (const bp of BLUEPRINTS) {
    const existing = await prisma.workflowBlueprint.findFirst({
      where: { authorTenantId: null, slug: bp.slug },
    });

    const data = {
      name:           bp.name,
      description:    bp.description,
      entityType:     bp.entityType,
      graphJson:      bp.graphData as any,
      checksum:       Buffer.from(JSON.stringify(bp.graphData)).toString('base64').slice(0, 64),
      isPublic:       bp.isPublic,
      isSystem:       bp.isSystem,
      tags:           bp.tags as any,
      version:        '1.0.0',
      authorTenantId: null,
      categoryId:     categoryMap[bp.entityType] ?? null,
    };

    if (existing) {
      await prisma.workflowBlueprint.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.workflowBlueprint.create({ data: { ...data, slug: bp.slug } });
      created++;
    }
  }

  console.log(`✅ Blueprints — ${created} créés, ${updated} mis à jour`);

  // ── Templates de documents système (factures, billets, talons, manifestes…) ──
  await seedSystemTemplates(prisma);

  // ── Types de documents véhicule par défaut (backfill tenants existants) ─────
  const docTypeReport = await backfillVehicleDocumentTypes(prisma);
  if (docTypeReport.rowsCreated > 0) {
    console.log(`✅ VehicleDocumentTypes — ${docTypeReport.rowsCreated} type(s) créé(s) sur ${docTypeReport.scanned} tenant(s)`);
  }

  // ── Backfill WorkflowConfig pour tous les tenants existants ────────────────
  const wfReport = await backfillDefaultWorkflows(prisma);
  if (wfReport.rowsCreated > 0) {
    console.log(`✅ WorkflowConfigs — ${wfReport.rowsCreated} transition(s) créée(s) sur ${wfReport.scanned} tenant(s)`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
