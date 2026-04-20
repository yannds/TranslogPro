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
 * Ajouter un nouveau module : étendre ce dict + i18n platformDash.modules.*.
 */
export const MODULE_ACTION_PREFIXES: Record<string, readonly string[]> = {
  ticketing:   ['data.ticket.', 'data.traveler.'],
  trips:       ['data.trip.', 'data.route.'],
  parcels:     ['data.parcel.', 'data.shipment.'],
  garage:      ['data.maintenance.', 'data.bus.', 'data.fuel.'],
  qhse:        ['data.incident.', 'data.qhse.', 'data.checklist.'],
  pricing:     ['data.pricing.', 'data.tariff.', 'data.promotion.'],
  reporting:   ['data.report.', 'data.analytics.'],
  crm:         ['data.customer.', 'data.crm.'],
};
export type KnownModule = keyof typeof MODULE_ACTION_PREFIXES;
