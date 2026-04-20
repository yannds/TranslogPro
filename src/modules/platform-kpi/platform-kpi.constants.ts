/**
 * Constants PlatformKpiService — choix d'ingénierie (pas métier).
 *
 * Tous les seuils configurables vivent dans `PlatformConfigService` via le
 * registry (namespace `kpi.*`). Ce fichier ne contient que les invariants
 * structurels : catégorisation de modules, étapes funnel, fenêtres analytiques.
 */

/**
 * Fenêtres analytiques par défaut (en jours). Utilisées si le caller ne passe
 * pas de période explicite. Remplaçable par `kpi.defaultPeriodDays` en config.
 */
export const KPI_PERIODS = {
  short:  7,
  medium: 30,
  long:   90,
} as const;

/**
 * Étapes du funnel d'activation. Un tenant est "activé" quand il a fait au
 * moins min(config) tickets + min(config) trips + ≥1 driver + ≥2 modules installés.
 * L'ordre est utilisé par l'UI pour afficher le funnel (chaque étape nécessite
 * la précédente).
 */
export const ACTIVATION_STEPS = [
  'TRIP_CREATED',
  'TICKET_SOLD',
  'DRIVER_ADDED',
  'TWO_MODULES_USED',
] as const;
export type ActivationStep = typeof ACTIVATION_STEPS[number];

/**
 * Catégories de type d'utilisateur pour ventilation DAU/MAU.
 * Source : `User.userType` (STAFF / CUSTOMER / ANONYMOUS).
 * On ajoute "DRIVER" par convention : un driver est un STAFF avec `Role.isDriver = true`
 * mais pour les KPI adoption, on veut pouvoir les ventiler séparément.
 */
export const USER_TYPE_BUCKETS = ['STAFF', 'DRIVER', 'CUSTOMER'] as const;
export type UserTypeBucket = typeof USER_TYPE_BUCKETS[number];

/**
 * Types de changement SubscriptionChange utilisés par `getMrrBreakdown`.
 * Doit correspondre aux valeurs insérées côté PlatformBillingService.
 */
export const SUBSCRIPTION_CHANGE_TYPES = [
  'NEW',
  'EXPANSION',
  'CONTRACTION',
  'CHURN',
  'REACTIVATION',
] as const;
export type SubscriptionChangeType = typeof SUBSCRIPTION_CHANGE_TYPES[number];

/**
 * Modes d'évaluation du North Star.
 */
export const NORTH_STAR_MODES = ['declarative', 'heuristic', 'compared'] as const;
export type NorthStarMode = typeof NORTH_STAR_MODES[number];

/**
 * Mapping module → préfixe d'action AuditLog utilisé pour détecter l'usage.
 * Un module est "utilisé" par un tenant si au moins une entrée AuditLog
 * correspond à l'un de ses préfixes dans la période analysée.
 *
 * Convention des clés : **UPPER_SNAKE_CASE**, aligné sur plans.seed.ts,
 * onboarding.service.ts, nav.config.ts, et la validation dans
 * PlatformPlansService.attachModule. Toute nouvelle clé doit être ajoutée ici
 * ET dans ces sources (sinon le module est invisible soit dans les plans,
 * soit dans l'adoption plateforme).
 *
 * Un module avec `prefixes: []` apparaît dans le rapport d'adoption mais
 * restera à 0 action tant qu'aucun préfixe AuditLog n'est déclaré — cas des
 * modules "configuration/vue seule" qui ne génèrent pas d'audit data.*
 * directement. À enrichir quand les writes du module sont instrumentés.
 */
export const MODULE_ACTION_PREFIXES: Record<string, readonly string[]> = {
  // ── Core (plan Starter) ─────────────────────────────────────────────────
  TICKETING:        ['data.ticket.', 'data.traveler.'],
  PARCEL:           ['data.parcel.', 'data.shipment.'],
  FLEET:            ['data.trip.', 'data.route.'],
  CASHIER:          ['data.cashier.', 'data.transaction.'],
  TRACKING:         ['data.gps.', 'data.trip_event.'],
  NOTIFICATIONS:    ['data.notification.', 'data.announcement.', 'data.campaign.'],

  // ── Growth (ajoutés au plan Growth) ─────────────────────────────────────
  CRM:              ['data.customer.', 'data.crm.'],
  ANALYTICS:        ['data.report.', 'data.analytics.'],
  SAV_MODULE:       ['data.claim.', 'data.refund.', 'data.dispute.'],

  // ── Enterprise (ajoutés au plan Enterprise) ─────────────────────────────
  YIELD_ENGINE:     ['data.pricing.', 'data.tariff.', 'data.promotion.'],
  WORKFLOW_STUDIO:  ['data.workflow.', 'data.blueprint.'],
  WHITE_LABEL:      ['data.brand.', 'data.portal_config.', 'data.tenant_page.', 'data.tenant_post.'],
  QHSE:             ['data.incident.', 'data.qhse.', 'data.checklist.'],
  DRIVER_PROFILE:   ['data.driver_license.', 'data.driver_score.', 'data.driver_training.'],
  CREW_BRIEFING:    ['data.briefing.', 'data.crew_assignment.'],
  GARAGE_PRO:       ['data.maintenance.', 'data.bus.', 'data.fuel.'],
  FLEET_DOCS:       ['data.vehicle_document.'],

  // ── Add-ons plateforme (hors plans standards) ───────────────────────────
  PROFITABILITY:    ['data.trip_cost_snapshot.', 'data.profitability.'],
  SCHEDULING_GUARD: ['data.driver_rest.'],
};
export type KnownModule = keyof typeof MODULE_ACTION_PREFIXES;
