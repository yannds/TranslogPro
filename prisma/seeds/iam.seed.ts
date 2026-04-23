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
  // Portail plateforme SaaS — plans / billing / metrics / support / config
  'control.platform.plans.manage.global',
  'control.platform.billing.manage.global',
  'data.platform.metrics.read.global',
  // KPI SaaS fine-grained — SUPER_ADMIN voit TOUT (business + adoption + retention + ops)
  'data.platform.kpi.business.read.global',
  'data.platform.kpi.adoption.read.global',
  'data.platform.kpi.retention.read.global',
  'data.platform.kpi.ops.read.global',
  'control.platform.support.read.global',
  'control.platform.support.write.global',
  'control.platform.config.manage.global',
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
  // Platform IAM global (audit cross-tenant, sessions, users, MFA reset)
  'data.platform.audit.read.global',
  'data.platform.iam.read.global',
  'control.platform.session.revoke.global',
  'control.platform.mfa.reset.global',
  'control.platform.user.reset-password.global',
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
  // Portail plateforme — metrics (lecture) et support (lire + répondre)
  'data.platform.metrics.read.global',
  // KPI SaaS fine-grained — L1 voit adoption + ops (identifier tenants à
  // accompagner : webinaires, formation, onboarding ciblé). Pas de business
  // (MRR, ARPU, GMV) ni de cohorts retention (investigation = L2).
  'data.platform.kpi.adoption.read.global',
  'data.platform.kpi.ops.read.global',
  'control.platform.support.read.global',
  'control.platform.support.write.global',
  // Platform IAM — lecture audit + users pour diagnostic ticket support
  'data.platform.audit.read.global',
  'data.platform.iam.read.global',
];

// ─── Permissions SUPPORT_L2 : L1 + debug technique ───────────────────────────
// L2 peut rejouer des événements outbox et inspecter le state machine
// pour diagnostiquer des incidents. Toujours sans accès Control Plane.
const SUPPORT_L2_PERMISSIONS = [
  ...SUPPORT_L1_PERMISSIONS,
  // KPI SaaS retention — L2 a besoin des cohortes pour investiguer tickets complexes
  // (usage baissé, activation bloquée). L2 ne voit toujours PAS le business (MRR/ARPU).
  'data.platform.kpi.retention.read.global',
  // Debug technique
  'data.workflow.debug.global',
  'data.outbox.replay.global',
  // Révocation de session impersonation (escalade L2)
  'control.impersonation.revoke.global',
  // Platform IAM — L2 peut révoquer sessions + reset MFA en escalade
  'control.platform.session.revoke.global',
  'control.platform.mfa.reset.global',
  // Reset mot de passe cross-tenant (support verrouillage — escalade L2)
  'control.platform.user.reset-password.global',
];

// ─── Permissions par rôle tenant ──────────────────────────────────────────────

export const TENANT_ROLES: Array<{
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
      'control.bulk.import.tenant',
      // Backup / Restore / RGPD
      'data.backup.read.tenant',
      'control.backup.create.tenant',
      'control.backup.restore.tenant',
      'control.backup.delete.tenant',
      'control.backup.schedule.tenant',
      'control.gdpr.export.tenant',
      'control.trip.delete.tenant',
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
      'data.trip.read.tenant',
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
      'data.manifest.read.agency',
      'data.cashier.open.own',
      'data.cashier.transaction.own',
      'data.cashier.close.agency',
      'data.pricing.read.agency',
      'data.sav.report.own',
      'data.sav.report.agency',
      'data.sav.deliver.agency',
      'data.sav.claim.tenant',
      'data.refund.read.tenant',
      'data.refund.approve.tenant',
      'data.refund.process.tenant',
      'data.staff.read.tenant',
      'data.staff.read.agency',
      'data.user.read.agency',
      'data.crm.read.tenant',
      'data.crm.read.agency',
      'data.crm.write.tenant',
      'data.crm.merge.tenant',
      'data.crm.delete.tenant',
      'data.crew.manage.tenant',
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.session.revoke.tenant',
      'control.stats.read.tenant',
      'control.integration.setup.tenant',
      'data.display.update.agency',
      'control.iam.manage.tenant',
      'control.iam.audit.tenant',
      // IAM — reset mot de passe et suppression en masse (ops destructives)
      'control.iam.user.reset-password.tenant',
      'control.iam.user.bulk-delete.tenant',
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
      // Tarification — grille tarifaire & promotions
      'control.tariff.manage.tenant',
      'data.tariff.read.agency',
      'control.promotion.manage.tenant',
      'data.promotion.read.agency',
      // Facturation
      'control.invoice.manage.tenant',
      'data.invoice.create.agency',
      'data.invoice.read.agency',
      'data.invoice.read.tenant',
      // Quais & Annonces gare
      'control.platform.manage.tenant',
      'data.platform.read.agency',
      'control.announcement.manage.tenant',
      'data.announcement.read.agency',
      // Support tenant → plateforme + plan auto-service
      'data.support.create.tenant',
      'data.support.read.tenant',
      'data.tenant.plan.read.tenant',
      'control.tenant.plan.change.tenant',
      // ── Scénarios no-show / rebook / incident / compensation (2026-04-19) ──
      'control.refund.waive_penalty.tenant',
      'data.ticket.rebook.tenant',
      'data.ticket.rebook.agency',
      'data.ticket.noshow_mark.agency',
      'control.ticket.noshow_waive.tenant',
      'control.trip.suspend.agency',
      'control.trip.cancel_in_transit.tenant',
      'control.trip.declare_major_delay.agency',
      'control.trip.override_policy.tenant',
      'data.parcel.hub_move.agency',
      'data.parcel.pickup.agency',
      'control.parcel.return_init.tenant',
      'data.compensation.issue.tenant',
      'data.compensation.issue.agency',
      'data.compensation.read.agency',
      'control.voucher.issue.tenant',
      'data.voucher.issue.agency',
      'data.voucher.redeem.agency',
      'control.voucher.cancel.tenant',
      'data.voucher.read.tenant',
      // Taxes & Fiscalité (CRUD TenantTax)
      'data.tax.read.tenant',
      'control.tax.manage.tenant',
      // Classes de voyage (CRUD TenantFareClass)
      'data.fareClass.read.tenant',
      'control.fareClass.manage.tenant',
      // Périodes peak (calendrier yield — tenant-admin pilote, effet sur toute la flotte)
      'data.peakPeriod.read.tenant',
      'control.peakPeriod.manage.tenant',
      // Rentabilité prévisionnelle pré-trajet (Sprint 11.A)
      'data.profitability.read.tenant',
      // Reset complet tenant — opération destructive, uniquement TENANT_ADMIN
      // avec re-auth password + confirmation slug côté endpoint.
      'control.tenant.reset.tenant',
    ],
  },
  {
    name:     'AGENCY_MANAGER',
    isSystem: true,
    permissions: [
      'control.trip.delay.agency',
      'data.trip.read.tenant',
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
      'data.manifest.read.agency',
      'data.cashier.open.own',
      'data.cashier.transaction.own',
      'data.cashier.close.agency',
      'data.pricing.read.agency',
      'data.sav.report.agency',
      'data.sav.deliver.agency',
      'data.sav.claim.tenant',
      'data.refund.read.tenant',
      'data.refund.read.agency',
      'data.refund.approve.agency',
      'data.staff.read.agency',
      'data.user.read.agency',
      'data.display.update.agency',
      'data.notification.read.own',
      'data.session.revoke.own',
      // CRM (scope agence — lecture et édition limitée)
      'data.crm.read.agency',
      'data.crm.write.agency',
      // Documents imprimables
      'data.ticket.print.agency',
      'data.manifest.print.agency',
      'data.parcel.print.agency',
      'data.invoice.print.agency',
      // Tarification (lecture + promotions)
      'data.tariff.read.agency',
      'data.promotion.read.agency',
      // Facturation
      'data.invoice.create.agency',
      'data.invoice.read.agency',
      // Quais & Annonces
      'data.platform.read.agency',
      'control.platform.manage.tenant',
      'data.announcement.read.agency',
      'control.announcement.manage.tenant',
      // Support — peut ouvrir un ticket et voir ceux du tenant
      'data.support.create.tenant',
      'data.support.read.tenant',
      // ── Scénarios no-show / rebook / incident / compensation (2026-04-19) ──
      'data.ticket.rebook.agency',
      'data.ticket.noshow_mark.agency',
      'control.trip.suspend.agency',
      'control.trip.declare_major_delay.agency',
      'data.parcel.hub_move.agency',
      'data.parcel.pickup.agency',
      'data.compensation.issue.agency',
      'data.compensation.read.agency',
      'data.voucher.issue.agency',
      'data.voucher.redeem.agency',
      // Taxes & Fiscalité (le gérant peut ajuster la grille fiscale tenant)
      'data.tax.read.tenant',
      'control.tax.manage.tenant',
      // Classes de voyage (lecture — classes tenant-wide, édition via TENANT_ADMIN)
      'data.fareClass.read.tenant',
      // Peak periods (lecture pour contexte yield)
      'data.peakPeriod.read.tenant',
      // Rentabilité prévisionnelle pré-trajet (Sprint 11.A) — le manager
      // d'agence programme des trajets et doit voir la viabilité.
      'data.profitability.read.tenant',
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
      // Tarification (lecture pour POS)
      'data.tariff.read.agency',
      'data.promotion.read.agency',
      // Facturation (création au guichet)
      'data.invoice.create.agency',
      'data.invoice.read.agency',
      // Support — peut ouvrir un ticket plateforme
      'data.support.create.tenant',
      // ── Rebook/voucher au guichet (2026-04-19) ──
      'data.ticket.rebook.agency',
      'data.voucher.redeem.agency',
      // Taxes (lecture seule — caissier doit voir la grille pour comprendre le ticket POS)
      'data.tax.read.tenant',
      // Classes de voyage (lecture — le caissier doit lister les classes à la vente)
      'data.fareClass.read.tenant',
    ],
  },
  {
    // ─── ACCOUNTANT ────────────────────────────────────────────────────────────
    // Comptable tenant : gère la fiscalité (taxes), consulte les factures et
    // remboursements, audite les clôtures de caisse. Pas d'accès opérationnel
    // (création billet/colis/trajet, embarquement, scan). Read-only sur tout
    // sauf la fiscalité où il a le droit d'écriture.
    //
    // Rôle système — les permissions peuvent être ajustées par tenant via la
    // matrice IAM (control.iam.manage.tenant requis).
    name:     'ACCOUNTANT',
    isSystem: true,
    permissions: [
      // Taxes (cœur du métier comptable — read + write)
      'data.tax.read.tenant',
      'control.tax.manage.tenant',
      // Classes de voyage (lecture pour facturation — gestion via TENANT_ADMIN)
      'data.fareClass.read.tenant',
      // Facturation (lecture tenant + création/réémission)
      'data.invoice.read.agency',
      'data.invoice.read.tenant',
      'data.invoice.create.agency',
      'data.invoice.print.agency',
      // Remboursements (lecture + approbation tenant — flux financier sortant)
      'data.refund.read.tenant',
      'data.refund.read.agency',
      'data.refund.approve.tenant',
      'data.refund.process.tenant',
      // Caisse (clôtures + écarts pour audit comptable)
      'data.cashier.close.agency',
      // Tarification (lecture pour cohérence comptable)
      'data.pricing.read.agency',
      'data.tariff.read.agency',
      // Stats (vue d'ensemble financière)
      'control.stats.read.tenant',
      // Rentabilité prévisionnelle (Sprint 11.A) — cœur métier du comptable
      'data.profitability.read.tenant',
      // Utilitaires
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.support.create.tenant',
      'data.support.read.tenant',
    ],
  },
  {
    name:     'DRIVER',
    isSystem: true,
    // Principe : le chauffeur a accès aux outils dont il a besoin pour opérer
    // son trajet (scanner billets, imprimer manifeste, vérifier voyageurs,
    // marquer départ/arrivée). Les endpoints backend concernés sont
    // scope-filtrés à runtime par FlightDeckService (le tripId doit appartenir
    // au chauffeur authentifié), donc une perm `.agency` reste opérationnelle
    // sans permettre un IDOR pratique — c'est la source de vérité de la
    // permission côté route, la défense fine est côté service.
    //
    // TROIS PERMS RETIRÉES par rapport au rôle historique — fuites IDOR
    // indiscutables (aucun usage légitime pour un chauffeur) :
    //   - data.driver.profile.agency   → voyait dossiers RH de TOUS les collègues
    //   - data.fleet.status.agency     → voyait toute la flotte
    //   - control.trip.delay.agency    → pouvait retarder N'IMPORTE QUEL trajet
    permissions: [
      'data.trip.read.own',
      'data.trip.update.agency',       // marquer départ / arrivée (endpoint scope-filtré)
      'data.trip.check.own',
      'data.trip.report.own',
      'control.trip.log_event.own',    // plan de perm aligné sur constants + state graph
      'data.ticket.scan.agency',       // scan billets à l'embarquement (filtré par tripId côté service)
      'data.traveler.verify.agency',   // vérification identité voyageur (idem)
      'data.manifest.read.own',
      'data.manifest.generate.agency', // génération draft du manifeste sur SON trajet (idempotent — si déjà généré par l'agent quai, réutilise l'existant)
      'data.manifest.sign.agency',     // attestation de départ — le chauffeur signe SON manifeste (endpoint scope-filtré par tripId + driver assignment)
      'data.manifest.print.agency',    // impression manifeste de SON trajet
      'data.ticket.read.agency',       // liste passagers de SON trajet (endpoint filtré)
      // ── Gestion fret opérationnelle pour le chauffeur (tenant sans agent quai).
      // Scope-filtré par tripId côté FlightDeckService / parcel service : un
      // chauffeur ne peut charger/scanner QUE les colis de SES trajets. Même
      // pattern que ticket.scan.agency / traveler.verify.agency au-dessus.
      'data.parcel.scan.agency',       // scan QR colis au chargement / déchargement
      'data.parcel.update.agency',     // transition LOADED → IN_TRANSIT → ARRIVED
      'data.parcel.report.agency',     // signaler casse / perte en route
      'data.parcel.print.agency',      // réimprimer une étiquette abîmée sur terrain
      'data.sav.report.own',
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.driver.rest.own',          // périodes de repos (start/end)
      'data.maintenance.update.own',   // signalement de panne depuis le terrain
      'data.feedback.submit.own',      // retours voyageur post-trajet
      'data.support.create.tenant',    // ouvrir ticket support vers la plateforme
      // ── Incident en route (2026-04-19) ──
      'control.trip.suspend.agency',         // chauffeur déclare panne → SUSPENDED
      'control.trip.declare_major_delay.agency', // déclenche compensation
      'data.compensation.issue.agency',      // distribuer snacks à bord
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
      'data.support.create.tenant',
      // ── Compensation à bord (2026-04-19) ──
      'data.compensation.issue.agency', // hôtesse distribue snacks en cabine
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
      'data.support.create.tenant',
    ],
  },
  {
    // ─── AGENT_QUAI ───────────────────────────────────────────────────────────
    // Agent de quai : opère au pied du bus, gère le chargement des colis dans
    // la soute et contrôle les billets des passagers à l'embarquement. À
    // distinguer de l'agent de gare (STATION_AGENT — guichet + check-in).
    // Portail dédié : /quai (resolvePortal branche via control.quai.manage.tenant).
    //
    // Jeu de perms symétrique avec le DRIVER côté fret (mêmes actions sur
    // data.parcel.*), plus la gestion shipment (regroupement pré-départ) et
    // la perm portail. Tous les endpoints concernés sont scope-filtrés par
    // agency — un agent de quai ne voit que les trajets de SA gare/agence.
    name:     'AGENT_QUAI',
    isSystem: true,
    permissions: [
      // Portail
      'control.quai.manage.tenant',
      // Gestion fret (chargement / déchargement / signalement / impression)
      'data.parcel.scan.agency',
      'data.parcel.update.agency',
      'data.parcel.report.agency',
      'data.parcel.print.agency',
      'data.shipment.group.agency',    // regroupement des colis par destination avant chargement
      // Embarquement passagers
      'data.ticket.scan.agency',
      'data.traveler.verify.agency',
      'data.luggage.weigh.agency',
      // Visibilité opérationnelle
      'data.trip.read.own',
      'data.trip.read.agency',         // liste des trajets de son agence — manifestes, scan, tableau de bord quai
      'data.trip.update.agency',       // marquer départ après chargement OK (endpoint scope-filtré par agence)
      'data.manifest.read.own',
      'data.manifest.read.agency',     // lecture de tous les manifestes de l'agence (scope-filtré par assertTripOwnership)
      'data.manifest.generate.agency', // l'agent quai prépare le manifeste avant signature chauffeur
      'data.manifest.sign.agency',     // signature au nom de l'agence quand le chauffeur n'est pas encore là
      'data.manifest.print.agency',
      'data.ticket.read.agency',
      // Support & notifications
      'data.notification.read.own',
      'data.session.revoke.own',
      'data.support.create.tenant',
      // ── Hub / no-show / compensation / voucher (2026-04-19) ──
      'data.ticket.noshow_mark.agency',  // marquer un passager no-show au moment du départ
      'data.parcel.hub_move.agency',     // ARRIVE_AT_HUB / STORE / LOAD_OUTBOUND / DEPART_FROM_HUB
      'data.parcel.pickup.agency',       // valider retrait destinataire
      'data.compensation.issue.agency',  // snacks / voucher handout
      'data.voucher.redeem.agency',      // appliquer un bon au guichet quai
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
      // Remboursement : demande d'annulation self-service (portail voyageur)
      'data.refund.request.own',
      // ── Self-service voyageur (2026-04-19) ──
      'data.ticket.rebook.own',     // rebook son propre ticket (next available / later)
      'data.parcel.dispute.own',    // contester un colis (destinataire ou expéditeur)
      'data.voucher.read.own',      // liste ses bons de réduction (Mes bons)
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
      // Quais & Annonces (dispatch opérationnel)
      'data.platform.read.agency',
      'control.platform.manage.tenant',
      'data.announcement.read.agency',
      'control.announcement.manage.tenant',
      'data.support.create.tenant',
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

    // SYNC strict pour les rôles système : on retire les permissions qui ne
    // sont plus dans la définition. Essentiel pour révoquer une permission
    // historique accordée trop largement (ex: DRIVER qui avait .agency sur
    // fleet.status ou driver.profile — fuite IDOR corrigée 2026-04-19).
    // Les rôles custom (isSystem=false) ne sont jamais touchés par ce sync.
    if (roleDef.isSystem) {
      const keep = new Set(roleDef.permissions);
      await prismaClient.rolePermission.deleteMany({
        where: { roleId: role.id, permission: { notIn: Array.from(keep) } },
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
 * Provisionne la caisse VIRTUELLE système d'une agence.
 * Idempotent — une seule CashRegister{kind='VIRTUAL'} par (tenantId, agencyId).
 * Invariant : toute agence a exactement 1 caisse virtuelle, toujours OPEN,
 * agentId='SYSTEM'. Sert aux side-effects comptables sans caissier humain
 * (voucher redeem self-service, refund.process, paiement en ligne).
 */
export async function ensureVirtualRegisterForAgency(
  client:   { cashRegister: { findFirst: Function; create: Function } },
  tenantId: string,
  agencyId: string,
): Promise<string> {
  const existing = await client.cashRegister.findFirst({
    where: { tenantId, agencyId, kind: 'VIRTUAL' },
  } as unknown as Record<string, unknown>);
  if (existing) return existing.id;

  const created = await client.cashRegister.create({
    data: {
      tenantId,
      agencyId,
      agentId:        'SYSTEM',
      kind:           'VIRTUAL',
      status:         'OPEN',
      initialBalance: 0,
    },
  } as unknown as Record<string, unknown>);
  return created.id;
}

/**
 * Backfill pour tenants existants : pour chaque agence sans caisse VIRTUAL,
 * en provisionne une. Idempotent — peut être rejoué sans effet.
 */
export async function backfillVirtualRegisters(
  prismaClient: PrismaClient,
): Promise<{ agenciesScanned: number; virtualsCreated: number }> {
  const agencies = await prismaClient.agency.findMany({
    select: { id: true, tenantId: true },
  });
  let virtualsCreated = 0;
  for (const agency of agencies) {
    const existing = await prismaClient.cashRegister.findFirst({
      where: { tenantId: agency.tenantId, agencyId: agency.id, kind: 'VIRTUAL' },
    });
    if (!existing) {
      await prismaClient.cashRegister.create({
        data: {
          tenantId:       agency.tenantId,
          agencyId:       agency.id,
          agentId:        'SYSTEM',
          kind:           'VIRTUAL',
          status:         'OPEN',
          initialBalance: 0,
        },
      });
      virtualsCreated++;
    }
  }
  return { agenciesScanned: agencies.length, virtualsCreated };
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
  // Ticket — PRD §III.7 (cycle complet : émission → embarquement → complétion + remboursement)
  { entityType: 'Ticket', fromState: 'CREATED',            action: 'RESERVE',   toState: 'PENDING_PAYMENT',  requiredPerm: 'data.ticket.create.agency' },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT',    action: 'PAY',       toState: 'CONFIRMED',        requiredPerm: 'data.ticket.create.agency' },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT',    action: 'EXPIRE',    toState: 'EXPIRED',          requiredPerm: 'data.ticket.create.agency' },
  { entityType: 'Ticket', fromState: 'CONFIRMED',          action: 'CHECK_IN',  toState: 'CHECKED_IN',       requiredPerm: 'data.ticket.scan.agency'   },
  { entityType: 'Ticket', fromState: 'CHECKED_IN',         action: 'BOARD',     toState: 'BOARDED',          requiredPerm: 'data.ticket.scan.agency'   },
  { entityType: 'Ticket', fromState: 'CONFIRMED',          action: 'BOARD',     toState: 'BOARDED',          requiredPerm: 'data.ticket.scan.agency'   },
  { entityType: 'Ticket', fromState: 'BOARDED',            action: 'FINALIZE',  toState: 'COMPLETED',        requiredPerm: 'data.trip.update.agency'   },
  { entityType: 'Ticket', fromState: 'CONFIRMED',          action: 'CANCEL',    toState: 'CANCELLED',        requiredPerm: 'data.ticket.cancel.agency' },
  { entityType: 'Ticket', fromState: 'PENDING_PAYMENT',    action: 'CANCEL',    toState: 'CANCELLED',        requiredPerm: 'data.ticket.cancel.agency' },
  { entityType: 'Ticket', fromState: 'CONFIRMED',          action: 'REFUND',    toState: 'REFUND_PENDING',   requiredPerm: 'data.ticket.cancel.agency' },
  { entityType: 'Ticket', fromState: 'REFUND_PENDING',     action: 'approve',   toState: 'REFUND_PROCESSING',requiredPerm: 'data.refund.approve.tenant' },
  { entityType: 'Ticket', fromState: 'REFUND_PROCESSING',  action: 'process',   toState: 'REFUNDED',         requiredPerm: 'data.refund.process.tenant' },
  { entityType: 'Ticket', fromState: 'REFUND_PROCESSING',  action: 'fail',      toState: 'REFUND_FAILED',    requiredPerm: 'data.refund.process.tenant' },
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

  // MaintenanceReport — cycle intervention mécanicien (aligné model `maintenance_reports`)
  // States model : SCHEDULED | IN_PROGRESS | COMPLETED | APPROVED
  { entityType: 'MaintenanceReport', fromState: 'SCHEDULED',   action: 'start_work', toState: 'IN_PROGRESS', requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'MaintenanceReport', fromState: 'IN_PROGRESS', action: 'complete',   toState: 'COMPLETED',   requiredPerm: 'data.maintenance.update.own'     },
  { entityType: 'MaintenanceReport', fromState: 'COMPLETED',   action: 'approve',    toState: 'APPROVED',    requiredPerm: 'data.maintenance.approve.tenant' },
  { entityType: 'MaintenanceReport', fromState: 'COMPLETED',   action: 'reopen',     toState: 'IN_PROGRESS', requiredPerm: 'data.maintenance.approve.tenant' },

  // Claim — SAV réclamation (aligné model `claims`)
  // States model : OPEN | ASSIGNED | UNDER_INVESTIGATION | RESOLVED | REJECTED | CLOSED
  { entityType: 'Claim', fromState: 'OPEN',                action: 'assign',      toState: 'ASSIGNED',            requiredPerm: 'data.sav.report.agency'  },
  { entityType: 'Claim', fromState: 'ASSIGNED',            action: 'investigate', toState: 'UNDER_INVESTIGATION', requiredPerm: 'data.sav.deliver.agency' },
  { entityType: 'Claim', fromState: 'UNDER_INVESTIGATION', action: 'resolve',     toState: 'RESOLVED',            requiredPerm: 'data.sav.claim.tenant'   },
  { entityType: 'Claim', fromState: 'UNDER_INVESTIGATION', action: 'reject',      toState: 'REJECTED',            requiredPerm: 'data.sav.claim.tenant'   },
  { entityType: 'Claim', fromState: 'OPEN',                action: 'resolve',     toState: 'RESOLVED',            requiredPerm: 'data.sav.claim.tenant'   }, // fast-track si diagnostic immédiat
  { entityType: 'Claim', fromState: 'OPEN',                action: 'reject',      toState: 'REJECTED',            requiredPerm: 'data.sav.claim.tenant'   }, // fast-track si rejet immédiat
  { entityType: 'Claim', fromState: 'ASSIGNED',            action: 'resolve',     toState: 'RESOLVED',            requiredPerm: 'data.sav.claim.tenant'   },
  { entityType: 'Claim', fromState: 'ASSIGNED',            action: 'reject',      toState: 'REJECTED',            requiredPerm: 'data.sav.claim.tenant'   },
  { entityType: 'Claim', fromState: 'RESOLVED',            action: 'close',       toState: 'CLOSED',              requiredPerm: 'data.sav.claim.tenant'   },

  // Refund — remboursement billet (blueprint refund-standard)
  // Approbation tenant-admin (sans seuil)
  { entityType: 'Refund', fromState: 'PENDING',  action: 'approve',      toState: 'APPROVED',  requiredPerm: 'data.refund.approve.tenant' },
  // Approbation agency-manager (seuil vérifié dans RefundService)
  { entityType: 'Refund', fromState: 'PENDING',  action: 'approve',      toState: 'APPROVED',  requiredPerm: 'data.refund.approve.agency' },
  // Auto-approbation système (politique tarifaire ou TRIP_CANCELLED)
  { entityType: 'Refund', fromState: 'PENDING',  action: 'auto_approve', toState: 'APPROVED',  requiredPerm: 'data.refund.approve.tenant' },
  { entityType: 'Refund', fromState: 'PENDING',  action: 'reject',       toState: 'REJECTED',  requiredPerm: 'data.refund.approve.tenant' },
  { entityType: 'Refund', fromState: 'APPROVED', action: 'process',      toState: 'PROCESSED', requiredPerm: 'data.refund.process.tenant' },
  { entityType: 'Refund', fromState: 'APPROVED', action: 'reject',       toState: 'REJECTED',  requiredPerm: 'data.refund.approve.tenant' },

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
  // Fast-track : validation en un clic depuis UI flight-deck (bypass chain TECH/SAFETY/DOCS)
  { entityType: 'Checklist', fromState: 'PENDING',      action: 'complete',      toState: 'APPROVED',     requiredPerm: 'data.maintenance.update.own'     },

  // CrewAssignment — affectation & briefing équipage (blueprint crew-assignment, aligné model)
  { entityType: 'CrewAssignment', fromState: 'STANDBY',    action: 'assign_briefing', toState: 'BRIEFING',   requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'CrewAssignment', fromState: 'BRIEFING',   action: 'start_duty',      toState: 'ON_DUTY',    requiredPerm: 'data.trip.update.agency'      },
  { entityType: 'CrewAssignment', fromState: 'BRIEFING',   action: 'cancel',          toState: 'STANDBY',    requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'CrewAssignment', fromState: 'ON_DUTY',    action: 'end_duty',        toState: 'DEBRIEFING', requiredPerm: 'control.trip.log_event.own'   },
  { entityType: 'CrewAssignment', fromState: 'ON_DUTY',    action: 'emergency_off',   toState: 'SUSPENDED',  requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'CrewAssignment', fromState: 'DEBRIEFING', action: 'start_rest',      toState: 'REST',       requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'CrewAssignment', fromState: 'REST',       action: 'rest_complete',   toState: 'STANDBY',    requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'CrewAssignment', fromState: 'SUSPENDED',  action: 'reinstate',       toState: 'STANDBY',    requiredPerm: 'control.driver.manage.tenant' },

  // Driver — disponibilité & repos (blueprint driver-availability)
  { entityType: 'Driver', fromState: 'AVAILABLE',     action: 'assign',        toState: 'ASSIGNED',      requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Driver', fromState: 'ASSIGNED',      action: 'start_duty',    toState: 'ON_DUTY',       requiredPerm: 'data.trip.update.agency'      },
  { entityType: 'Driver', fromState: 'ASSIGNED',      action: 'unassign',      toState: 'AVAILABLE',     requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Driver', fromState: 'ON_DUTY',       action: 'end_shift',     toState: 'REST_REQUIRED', requiredPerm: 'control.trip.log_event.own'   },
  { entityType: 'Driver', fromState: 'ON_DUTY',       action: 'emergency_off', toState: 'SUSPENDED',     requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'Driver', fromState: 'REST_REQUIRED', action: 'start_rest',    toState: 'RESTING',       requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'Driver', fromState: 'RESTING',       action: 'rest_complete', toState: 'AVAILABLE',     requiredPerm: 'data.driver.rest.own'         },
  { entityType: 'Driver', fromState: 'SUSPENDED',     action: 'reinstate',     toState: 'AVAILABLE',     requiredPerm: 'control.driver.manage.tenant' },

  // CashRegister — cycle caisse (ouverture / fermeture / écart)
  { entityType: 'CashRegister', fromState: 'CLOSED',      action: 'open',       toState: 'OPEN',        requiredPerm: 'data.cashier.open.own'       },
  { entityType: 'CashRegister', fromState: 'OPEN',         action: 'close',      toState: 'CLOSED',      requiredPerm: 'data.cashier.close.agency'   },
  { entityType: 'CashRegister', fromState: 'OPEN',         action: 'flag',       toState: 'DISCREPANCY', requiredPerm: 'data.cashier.close.agency'   },
  { entityType: 'CashRegister', fromState: 'DISCREPANCY',  action: 'resolve',    toState: 'CLOSED',      requiredPerm: 'data.cashier.close.agency'   },

  // Incident — cycle événement exceptionnel (PRD §IV.11)
  { entityType: 'Incident', fromState: 'OPEN',        action: 'assign',      toState: 'ASSIGNED',    requiredPerm: 'data.trip.update.agency'   },
  { entityType: 'Incident', fromState: 'ASSIGNED',    action: 'start_work',  toState: 'IN_PROGRESS', requiredPerm: 'data.trip.report.own'      },
  { entityType: 'Incident', fromState: 'IN_PROGRESS', action: 'resolve',     toState: 'RESOLVED',    requiredPerm: 'data.trip.report.own'      },
  { entityType: 'Incident', fromState: 'ASSIGNED',    action: 'resolve',     toState: 'RESOLVED',    requiredPerm: 'data.trip.report.own'      }, // fast-track résolution sans start_work explicite
  { entityType: 'Incident', fromState: 'OPEN',        action: 'resolve',     toState: 'RESOLVED',    requiredPerm: 'data.trip.report.own'      }, // fast-track incidents triviaux
  { entityType: 'Incident', fromState: 'RESOLVED',    action: 'close',       toState: 'CLOSED',      requiredPerm: 'data.trip.update.agency'   },
  { entityType: 'Incident', fromState: 'RESOLVED',    action: 'reopen',      toState: 'IN_PROGRESS', requiredPerm: 'data.trip.update.agency'   },

  // ─── Scénarios nouveaux — 2026-04-19 ─────────────────────────────────────
  // Trip — incidents en route (SUSPEND, CANCEL_IN_TRANSIT, DECLARE_MAJOR_DELAY)
  { entityType: 'Trip', fromState: 'IN_PROGRESS',          action: 'SUSPEND',             toState: 'SUSPENDED',            requiredPerm: 'control.trip.suspend.agency'             },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_DELAYED',  action: 'SUSPEND',             toState: 'SUSPENDED',            requiredPerm: 'control.trip.suspend.agency'             },
  { entityType: 'Trip', fromState: 'SUSPENDED',            action: 'RESUME_FROM_SUSPEND', toState: 'IN_PROGRESS',          requiredPerm: 'control.trip.suspend.agency'             },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',          action: 'CANCEL_IN_TRANSIT',   toState: 'CANCELLED_IN_TRANSIT', requiredPerm: 'control.trip.cancel_in_transit.tenant'   },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_DELAYED',  action: 'CANCEL_IN_TRANSIT',   toState: 'CANCELLED_IN_TRANSIT', requiredPerm: 'control.trip.cancel_in_transit.tenant'   },
  { entityType: 'Trip', fromState: 'SUSPENDED',            action: 'CANCEL_IN_TRANSIT',   toState: 'CANCELLED_IN_TRANSIT', requiredPerm: 'control.trip.cancel_in_transit.tenant'   },
  { entityType: 'Trip', fromState: 'IN_PROGRESS',          action: 'DECLARE_MAJOR_DELAY', toState: 'IN_PROGRESS_DELAYED',  requiredPerm: 'control.trip.declare_major_delay.agency' },
  { entityType: 'Trip', fromState: 'IN_PROGRESS_DELAYED',  action: 'DECLARE_MAJOR_DELAY', toState: 'IN_PROGRESS_DELAYED',  requiredPerm: 'control.trip.declare_major_delay.agency' }, // re-déclaration (palier supérieur)
  { entityType: 'Trip', fromState: 'SUSPENDED',            action: 'DECLARE_MAJOR_DELAY', toState: 'SUSPENDED',            requiredPerm: 'control.trip.declare_major_delay.agency' },

  // Ticket — no-show, rebook, compensation
  { entityType: 'Ticket', fromState: 'CONFIRMED',      action: 'MISS_BOARDING',         toState: 'NO_SHOW',        requiredPerm: 'data.ticket.noshow_mark.agency' },
  { entityType: 'Ticket', fromState: 'CHECKED_IN',     action: 'MISS_BOARDING',         toState: 'NO_SHOW',        requiredPerm: 'data.ticket.noshow_mark.agency' },
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'MARK_LATE_ARRIVED',     toState: 'LATE_ARRIVED',   requiredPerm: 'data.ticket.noshow_mark.agency' },
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'REBOOK_NEXT_AVAILABLE', toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.agency'      },
  { entityType: 'Ticket', fromState: 'LATE_ARRIVED',   action: 'REBOOK_NEXT_AVAILABLE', toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.agency'      },
  { entityType: 'Ticket', fromState: 'CONFIRMED',      action: 'REBOOK_NEXT_AVAILABLE', toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.agency'      }, // rebook anticipé
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'REBOOK_LATER',          toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.agency'      },
  { entityType: 'Ticket', fromState: 'LATE_ARRIVED',   action: 'REBOOK_LATER',          toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.agency'      },
  { entityType: 'Ticket', fromState: 'CONFIRMED',      action: 'REBOOK_LATER',          toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.agency'      },
  // Self-service voyageur : rebook depuis portail (perm .own, vérifiée côté guard)
  { entityType: 'Ticket', fromState: 'CONFIRMED',      action: 'REBOOK_NEXT_AVAILABLE', toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.own'         },
  { entityType: 'Ticket', fromState: 'CONFIRMED',      action: 'REBOOK_LATER',          toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.own'         },
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'REBOOK_NEXT_AVAILABLE', toState: 'REBOOKED',       requiredPerm: 'data.ticket.rebook.own'         },
  // Request refund depuis NO_SHOW / LATE_ARRIVED
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'REQUEST_REFUND',        toState: 'REFUND_PENDING', requiredPerm: 'data.refund.request.own'        },
  { entityType: 'Ticket', fromState: 'LATE_ARRIVED',   action: 'REQUEST_REFUND',        toState: 'REFUND_PENDING', requiredPerm: 'data.refund.request.own'        },
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'REQUEST_REFUND',        toState: 'REFUND_PENDING', requiredPerm: 'data.ticket.cancel.agency'      }, // via agent
  // FORFEIT auto (scheduler) après TTL — perm interne system
  { entityType: 'Ticket', fromState: 'NO_SHOW',        action: 'FORFEIT',               toState: 'FORFEITED',      requiredPerm: 'data.ticket.noshow_mark.agency' },
  { entityType: 'Ticket', fromState: 'LATE_ARRIVED',   action: 'FORFEIT',               toState: 'FORFEITED',      requiredPerm: 'data.ticket.noshow_mark.agency' },

  // Parcel — hubs / pickup / retour (2026-04-19)
  { entityType: 'Parcel', fromState: 'IN_TRANSIT',            action: 'ARRIVE_AT_HUB',    toState: 'AT_HUB_INBOUND',       requiredPerm: 'data.parcel.hub_move.agency' },
  { entityType: 'Parcel', fromState: 'AT_HUB_INBOUND',        action: 'STORE_AT_HUB',     toState: 'STORED_AT_HUB',        requiredPerm: 'data.parcel.hub_move.agency' },
  { entityType: 'Parcel', fromState: 'AT_HUB_INBOUND',        action: 'LOAD_OUTBOUND',    toState: 'AT_HUB_OUTBOUND',      requiredPerm: 'data.parcel.hub_move.agency' }, // transfer direct
  { entityType: 'Parcel', fromState: 'STORED_AT_HUB',         action: 'LOAD_OUTBOUND',    toState: 'AT_HUB_OUTBOUND',      requiredPerm: 'data.parcel.hub_move.agency' },
  { entityType: 'Parcel', fromState: 'AT_HUB_OUTBOUND',       action: 'DEPART_FROM_HUB',  toState: 'IN_TRANSIT',           requiredPerm: 'data.parcel.hub_move.agency' },
  // Retrait destinataire
  { entityType: 'Parcel', fromState: 'ARRIVED',               action: 'NOTIFY_FOR_PICKUP',toState: 'AVAILABLE_FOR_PICKUP', requiredPerm: 'data.parcel.update.agency'   },
  { entityType: 'Parcel', fromState: 'AVAILABLE_FOR_PICKUP',  action: 'PICKUP',           toState: 'DELIVERED',            requiredPerm: 'data.parcel.pickup.agency'   },
  // Contestation destinataire ou expéditeur
  { entityType: 'Parcel', fromState: 'DELIVERED',             action: 'DISPUTE',          toState: 'DISPUTED',             requiredPerm: 'data.parcel.dispute.own'     },
  { entityType: 'Parcel', fromState: 'AVAILABLE_FOR_PICKUP',  action: 'DISPUTE',          toState: 'DISPUTED',             requiredPerm: 'data.parcel.dispute.own'     },
  // Retour automatique (TTL retrait dépassé)
  { entityType: 'Parcel', fromState: 'AVAILABLE_FOR_PICKUP',  action: 'INITIATE_RETURN',  toState: 'RETURN_TO_SENDER',     requiredPerm: 'control.parcel.return_init.tenant' },
  { entityType: 'Parcel', fromState: 'STORED_AT_HUB',         action: 'INITIATE_RETURN',  toState: 'RETURN_TO_SENDER',     requiredPerm: 'control.parcel.return_init.tenant' }, // colis bloqué hub
  { entityType: 'Parcel', fromState: 'RETURN_TO_SENDER',      action: 'COMPLETE_RETURN',  toState: 'RETURNED',             requiredPerm: 'data.parcel.update.agency'   },

  // Voucher — bon de réduction
  // ISSUE crée l'entité (pas de fromState cible — émission = création).
  // On modélise les transitions après émission.
  { entityType: 'Voucher', fromState: 'ISSUED',   action: 'REDEEM', toState: 'REDEEMED',  requiredPerm: 'data.voucher.redeem.agency' },
  { entityType: 'Voucher', fromState: 'ISSUED',   action: 'EXPIRE', toState: 'EXPIRED',   requiredPerm: 'data.voucher.redeem.agency' }, // scheduler (via perm technique)
  { entityType: 'Voucher', fromState: 'ISSUED',   action: 'CANCEL', toState: 'CANCELLED', requiredPerm: 'control.voucher.cancel.tenant' },

  // CompensationItem — snacks/repas
  { entityType: 'CompensationItem', fromState: 'OFFERED',   action: 'DELIVER', toState: 'DELIVERED', requiredPerm: 'data.compensation.issue.agency' },
  { entityType: 'CompensationItem', fromState: 'OFFERED',   action: 'DECLINE', toState: 'DECLINED',  requiredPerm: 'data.compensation.issue.agency' },

  // Refund — nouvelles raisons couvertes (pas de nouvelle transition, mais les reasons
  // NO_SHOW / INCIDENT_IN_TRANSIT / MAJOR_DELAY / PARCEL_UNDELIVERED passent par les
  // transitions existantes `approve` / `auto_approve` / `process` / `reject`).

  // ─── Invoice — cycle de vie (migration hardcoded → engine, 2026-04-19) ──
  { entityType: 'Invoice', fromState: 'DRAFT',  action: 'issue',     toState: 'ISSUED',    requiredPerm: 'data.invoice.create.agency' },
  { entityType: 'Invoice', fromState: 'ISSUED', action: 'mark_paid', toState: 'PAID',      requiredPerm: 'data.invoice.create.agency' },
  { entityType: 'Invoice', fromState: 'DRAFT',  action: 'mark_paid', toState: 'PAID',      requiredPerm: 'data.invoice.create.agency' }, // fast-track cash
  { entityType: 'Invoice', fromState: 'DRAFT',  action: 'cancel',    toState: 'CANCELLED', requiredPerm: 'control.invoice.manage.tenant' },
  { entityType: 'Invoice', fromState: 'ISSUED', action: 'cancel',    toState: 'CANCELLED', requiredPerm: 'control.invoice.manage.tenant' },

  // ─── Staff — suspension/réactivation/archivage (migration hardcoded → engine) ──
  { entityType: 'Staff', fromState: 'ACTIVE',    action: 'suspend',    toState: 'SUSPENDED', requiredPerm: 'control.staff.manage.tenant' },
  { entityType: 'Staff', fromState: 'SUSPENDED', action: 'reactivate', toState: 'ACTIVE',    requiredPerm: 'control.staff.manage.tenant' },
  { entityType: 'Staff', fromState: 'ACTIVE',    action: 'archive',    toState: 'ARCHIVED',  requiredPerm: 'control.staff.manage.tenant' },
  { entityType: 'Staff', fromState: 'SUSPENDED', action: 'archive',    toState: 'ARCHIVED',  requiredPerm: 'control.staff.manage.tenant' },

  // ─── StaffAssignment — cycle (aligné cascade staff) ──────────────────────
  { entityType: 'StaffAssignment', fromState: 'ACTIVE',    action: 'suspend',    toState: 'SUSPENDED', requiredPerm: 'control.staff.manage.tenant' },
  { entityType: 'StaffAssignment', fromState: 'SUSPENDED', action: 'reactivate', toState: 'ACTIVE',    requiredPerm: 'control.staff.manage.tenant' },
  { entityType: 'StaffAssignment', fromState: 'ACTIVE',    action: 'close',      toState: 'CLOSED',    requiredPerm: 'control.staff.manage.tenant' },
  { entityType: 'StaffAssignment', fromState: 'SUSPENDED', action: 'close',      toState: 'CLOSED',    requiredPerm: 'control.staff.manage.tenant' },

  // ─── SupportTicket — cycle (migration hardcoded → engine) ────────────────
  { entityType: 'SupportTicket', fromState: 'OPEN',              action: 'start',      toState: 'IN_PROGRESS',      requiredPerm: 'control.platform.support.write.global' },
  { entityType: 'SupportTicket', fromState: 'IN_PROGRESS',       action: 'await',      toState: 'WAITING_CUSTOMER', requiredPerm: 'control.platform.support.write.global' },
  { entityType: 'SupportTicket', fromState: 'WAITING_CUSTOMER',  action: 'resume',     toState: 'IN_PROGRESS',      requiredPerm: 'control.platform.support.write.global' },
  { entityType: 'SupportTicket', fromState: 'IN_PROGRESS',       action: 'resolve',    toState: 'RESOLVED',         requiredPerm: 'control.platform.support.write.global' },
  { entityType: 'SupportTicket', fromState: 'WAITING_CUSTOMER',  action: 'resolve',    toState: 'RESOLVED',         requiredPerm: 'control.platform.support.write.global' },
  { entityType: 'SupportTicket', fromState: 'OPEN',              action: 'resolve',    toState: 'RESOLVED',         requiredPerm: 'control.platform.support.write.global' }, // fast-track
  { entityType: 'SupportTicket', fromState: 'RESOLVED',          action: 'close',      toState: 'CLOSED',           requiredPerm: 'control.platform.support.write.global' },
  { entityType: 'SupportTicket', fromState: 'RESOLVED',          action: 'reopen',     toState: 'IN_PROGRESS',      requiredPerm: 'control.platform.support.write.global' },

  // ─── DriverTraining — cycle formation ────────────────────────────────────
  { entityType: 'DriverTraining', fromState: 'PLANNED',     action: 'start',    toState: 'IN_PROGRESS', requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'DriverTraining', fromState: 'IN_PROGRESS', action: 'complete', toState: 'COMPLETED',   requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'DriverTraining', fromState: 'PLANNED',     action: 'complete', toState: 'COMPLETED',   requiredPerm: 'control.driver.manage.tenant' }, // fast-track quand déjà faite
  { entityType: 'DriverTraining', fromState: 'PLANNED',     action: 'miss',     toState: 'MISSED',      requiredPerm: 'control.driver.manage.tenant' },
  { entityType: 'DriverTraining', fromState: 'PLANNED',     action: 'cancel',   toState: 'CANCELLED',   requiredPerm: 'control.driver.manage.tenant' },

  // ─── QhseProcedureExecution — cycle exécution procédure ──────────────────
  { entityType: 'QhseExecution', fromState: 'IN_PROGRESS', action: 'complete', toState: 'COMPLETED', requiredPerm: 'control.qhse.manage.tenant' },
  { entityType: 'QhseExecution', fromState: 'IN_PROGRESS', action: 'abort',    toState: 'ABORTED',   requiredPerm: 'control.qhse.manage.tenant' },
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

/**
 * Re-synchronise les permissions des rôles SYSTEM (TENANT_ROLES) de TOUS les
 * tenants existants depuis la source de vérité TS (`TENANT_ROLES`).
 *
 * Comportement SYNC STRICT pour rôles isSystem=true :
 *   - Ajoute les permissions manquantes (présentes dans le seed, absentes en DB)
 *   - Retire les permissions en trop (présentes en DB, absentes du seed)
 *   - Les rôles custom (isSystem=false) ne sont JAMAIS touchés
 *
 * Conçu pour être rejoué à chaque démarrage de l'application (via
 * `IamBootstrapService.onApplicationBootstrap()`) afin qu'un ajout de perm
 * dans `TENANT_ROLES` (commit TS) se propage automatiquement dans TOUS les
 * tenants existants, sans intervention manuelle. SaaS-grade.
 *
 * Idempotent : 2ᵉ run = 0 changement. Safe à rejouer.
 *
 * Retourne { tenants, rolesTouched, permsAdded, permsRemoved }.
 */
export async function reconcileSystemRolePermissions(
  prismaClient: PrismaClient,
): Promise<{ tenants: number; rolesTouched: number; permsAdded: number; permsRemoved: number }> {
  const tenants = await prismaClient.tenant.findMany({ select: { id: true, slug: true } });
  let rolesTouched = 0;
  let permsAdded   = 0;
  let permsRemoved = 0;

  for (const tenant of tenants) {
    if (tenant.id === PLATFORM_TENANT_ID) continue; // rôles plateforme gérés par bootstrapPlatform()

    for (const roleDef of TENANT_ROLES) {
      if (!roleDef.isSystem) continue; // on ne touche jamais aux rôles custom

      // Le rôle système DOIT exister — sinon rien à reconcilier (seedTenantRoles
      // aurait dû l'avoir créé à l'onboarding).
      const role = await prismaClient.role.findUnique({
        where: { tenantId_name: { tenantId: tenant.id, name: roleDef.name } },
      });
      if (!role) continue;

      // 1. Permissions manquantes → à ajouter
      const existing   = await prismaClient.rolePermission.findMany({
        where:  { roleId: role.id },
        select: { permission: true },
      });
      const existingSet = new Set(existing.map(r => r.permission));
      const desiredSet  = new Set(roleDef.permissions);

      const toAdd = roleDef.permissions.filter(p => !existingSet.has(p));
      if (toAdd.length > 0) {
        await prismaClient.rolePermission.createMany({
          data: toAdd.map(permission => ({ roleId: role.id, permission })),
          skipDuplicates: true,
        });
        permsAdded += toAdd.length;
      }

      // 2. Permissions en trop → à retirer (STRICT sync)
      const toRemove = existing
        .map(r => r.permission)
        .filter(p => !desiredSet.has(p));
      if (toRemove.length > 0) {
        const res = await prismaClient.rolePermission.deleteMany({
          where: { roleId: role.id, permission: { in: toRemove } },
        });
        permsRemoved += res.count;
      }

      if (toAdd.length > 0 || toRemove.length > 0) {
        rolesTouched++;
      }
    }
  }

  return { tenants: tenants.length, rolesTouched, permsAdded, permsRemoved };
}

/**
 * Backfill Staff pour chaque User(userType=STAFF) sans Staff record.
 *
 * Contexte : la table `staff` a une relation 1:1 avec `users` pour les membres
 * du personnel (vs CUSTOMER/ANONYMOUS). Sans Staff row, flight-deck, crew et
 * staff_assignments ne trouvent pas le lien userId→staffId → driver voit 0 trip,
 * admin voit 0 membre dans l'équipe.
 *
 * Cause racine possible : import Users via seed sans création Staff, ou
 * `prisma db push --accept-data-loss` qui a recréé la table lors d'un changement
 * de colonne (ex. ajout de `version` pour lock optimiste WorkflowEngine).
 *
 * Protection SaaS-grade : cette fonction est rejouée au boot via
 * IamBootstrapService pour garantir l'intégrité référentielle en permanence.
 *
 * Idempotent : utilise la unique constraint `userId` + skipDuplicates.
 */
export async function backfillStaffFromUsers(
  prismaClient: PrismaClient,
): Promise<{ usersScanned: number; staffCreated: number }> {
  const users = await prismaClient.user.findMany({
    where:  { userType: 'STAFF' },
    select: { id: true, tenantId: true, agencyId: true, createdAt: true },
  });
  if (users.length === 0) return { usersScanned: 0, staffCreated: 0 };

  const existing = await prismaClient.staff.findMany({
    where:  { userId: { in: users.map(u => u.id) } },
    select: { userId: true },
  });
  const existingSet = new Set(existing.map(s => s.userId));
  const missing = users.filter(u => !existingSet.has(u.id));

  if (missing.length === 0) return { usersScanned: users.length, staffCreated: 0 };

  const res = await prismaClient.staff.createMany({
    data: missing.map(u => ({
      tenantId: u.tenantId,
      userId:   u.id,
      agencyId: u.agencyId ?? null,
      status:   'ACTIVE',
      hireDate: u.createdAt,
      version:  1,
    })),
    skipDuplicates: true,
  });
  return { usersScanned: users.length, staffCreated: res.count };
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
): Promise<{ scanned: number; rowsCreated: number; rowsRevoked: number }> {
  const tenants = await prismaClient.tenant.findMany({
    where:  { id: { not: PLATFORM_TENANT_ID } },
    select: { id: true, slug: true },
  });

  let rowsCreated = 0;
  let rowsRevoked = 0;
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
      rowsCreated += delta;
      console.log(`[IAM Seed] Backfill tenant=${tenant.slug} — ${delta} permission(s) ajoutée(s)`);
    } else if (delta < 0) {
      rowsRevoked += -delta;
      console.log(`[IAM Seed] Backfill tenant=${tenant.slug} — ${-delta} permission(s) révoquée(s) (sync système)`);
    }
  }

  return { scanned: tenants.length, rowsCreated, rowsRevoked };
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
  // ET révoque celles retirées des rôles système (sync strict). Voir
  // seedTenantRoles() pour la logique.
  const permReport = await backfillTenantRolePermissions(prisma);
  console.log(
    `[IAM Seed] Backfill permissions rôles — ${permReport.scanned} tenants scannés, ` +
    `${permReport.rowsCreated} ligne(s) créée(s), ${permReport.rowsRevoked} révoquée(s)`,
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

// Standalone CLI uniquement — éviter le side-effect quand le module est
// importé par un test unitaire ou un autre script (ex. spec qui lit
// TENANT_ROLES pour vérifier le mapping rôle/permission).
if (require.main === module) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
