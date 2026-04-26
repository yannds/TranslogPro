/**
 * Registre des clés PlatformConfig connues.
 *
 * Chaque clé déclare :
 *   - type            : "number" | "string" | "boolean" | "number[]"
 *   - default         : fallback si la clé n'est pas en DB
 *   - validate?       : prédicat métier (ex: 0 ≤ riskThreshold ≤ 100)
 *   - label / help    : pour l'UI Settings plateforme
 *
 * Le registre est la **source de vérité** des clés auto-éditables depuis l'UI.
 * Les services consomment via `PlatformConfigService.getNumber('health.riskThreshold')`
 * qui retombe sur `default` si la clé est absente ou invalide.
 *
 * Ajouter une nouvelle clé :
 *   1. l'ajouter ici avec default + validate
 *   2. consommer via getNumber/getBool/getString dans le service concerné
 *   3. pas de migration DB requise (le modèle est générique)
 */

export interface PlatformConfigDef<T> {
  key:      string;
  type:     'number' | 'boolean' | 'string' | 'json';
  default:  T;
  label:    string; // i18n key — UI resolve via t(label)
  help:     string; // i18n key
  /** Bornes / validation métier. Retourne null si OK, sinon message i18n key. */
  validate?: (value: unknown) => string | null;
  /** Groupe d'affichage dans l'UI. */
  group:    string; // i18n key
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numberInRange(min: number, max: number) {
  return (v: unknown) => {
    if (!isNumber(v)) return 'platformConfig.errNotNumber';
    if (v < min || v > max) return 'platformConfig.errOutOfRange';
    return null;
  };
}

export const PLATFORM_CONFIG_REGISTRY: PlatformConfigDef<unknown>[] = [
  // ── Health score ────────────────────────────────────────────────────────
  {
    key:      'health.riskThreshold',
    type:     'number',
    default:  60,
    label:    'platformConfig.healthRiskThreshold',
    help:     'platformConfig.healthRiskThresholdHelp',
    group:    'platformConfig.groupHealth',
    validate: numberInRange(0, 100),
  },
  {
    key:      'health.thresholds.incidents',
    type:     'number',
    default:  10,
    label:    'platformConfig.healthThresholdIncidents',
    help:     'platformConfig.healthThresholdIncidentsHelp',
    group:    'platformConfig.groupHealth',
    validate: numberInRange(1, 1000),
  },
  {
    key:      'health.thresholds.tickets',
    type:     'number',
    default:  5,
    label:    'platformConfig.healthThresholdTickets',
    help:     'platformConfig.healthThresholdTicketsHelp',
    group:    'platformConfig.groupHealth',
    validate: numberInRange(1, 1000),
  },
  {
    key:      'health.thresholds.dlqEvents',
    type:     'number',
    default:  5,
    label:    'platformConfig.healthThresholdDlq',
    help:     'platformConfig.healthThresholdDlqHelp',
    group:    'platformConfig.groupHealth',
    validate: numberInRange(1, 1000),
  },

  // ── Billing ─────────────────────────────────────────────────────────────
  {
    key:      'billing.defaultInvoiceDueDays',
    type:     'number',
    default:  7,
    label:    'platformConfig.billingDueDays',
    help:     'platformConfig.billingDueDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(0, 365),
  },
  {
    key:      'billing.defaultCustomCycleDays',
    type:     'number',
    default:  30,
    label:    'platformConfig.billingCustomCycleDays',
    help:     'platformConfig.billingCustomCycleDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 3650),
  },

  // ── Activation drip post-signup ─────────────────────────────────────────
  // Âge du tenant (en heures) à partir duquel chaque email du drip part.
  // L'envoi effectif dépend aussi des conditions métier (onboarding incomplet,
  // pas d'équipe, pas de vente) — ces seuils pilotent juste la fenêtre de tir.
  {
    key:      'activation.day1.ageHours',
    type:     'number',
    default:  24,
    label:    'platformConfig.activationDay1',
    help:     'platformConfig.activationDay1Help',
    group:    'platformConfig.groupActivation',
    validate: numberInRange(1, 720),
  },
  {
    key:      'activation.day3.ageHours',
    type:     'number',
    default:  72,
    label:    'platformConfig.activationDay3',
    help:     'platformConfig.activationDay3Help',
    group:    'platformConfig.groupActivation',
    validate: numberInRange(1, 720),
  },
  {
    key:      'activation.day7.ageHours',
    type:     'number',
    default:  168,
    label:    'platformConfig.activationDay7',
    help:     'platformConfig.activationDay7Help',
    group:    'platformConfig.groupActivation',
    validate: numberInRange(1, 720),
  },
  {
    key:      'activation.maxAgeDays',
    type:     'number',
    default:  60,
    label:    'platformConfig.activationMaxAgeDays',
    help:     'platformConfig.activationMaxAgeDaysHelp',
    group:    'platformConfig.groupActivation',
    validate: numberInRange(1, 365),
  },

  // ── Renewal & dunning ───────────────────────────────────────────────────
  {
    key:      'renewal.leadDays',
    type:     'number',
    default:  3,
    label:    'platformConfig.renewalLeadDays',
    help:     'platformConfig.renewalLeadDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(0, 30),
  },
  {
    key:      'dunning.day1.hours',
    type:     'number',
    default:  24,
    label:    'platformConfig.dunningDay1',
    help:     'platformConfig.dunningDay1Help',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 720),
  },
  {
    key:      'dunning.day3.hours',
    type:     'number',
    default:  72,
    label:    'platformConfig.dunningDay3',
    help:     'platformConfig.dunningDay3Help',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 720),
  },
  {
    key:      'dunning.day7.hours',
    type:     'number',
    default:  168,
    label:    'platformConfig.dunningDay7',
    help:     'platformConfig.dunningDay7Help',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 720),
  },
  {
    key:      'dunning.suspendAfterDays',
    type:     'number',
    default:  10,
    label:    'platformConfig.dunningSuspendAfterDays',
    help:     'platformConfig.dunningSuspendAfterDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 365),
  },

  // ── Trial UX ────────────────────────────────────────────────────────────
  {
    key:      'trial.banner.maxDaysLeft',
    type:     'number',
    default:  14,
    label:    'platformConfig.trialBannerMaxDays',
    help:     'platformConfig.trialBannerMaxDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 90),
  },

  // ── Subscription lifecycle ─────────────────────────────────────────────
  // Nombre de jours après expiration du trial avant passage en SUSPENDED.
  {
    key:      'subscription.gracePeriodDays',
    type:     'number',
    default:  7,
    label:    'platformConfig.subscriptionGracePeriodDays',
    help:     'platformConfig.subscriptionGracePeriodDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(0, 90),
  },
  // Jours d'alerte avant fin de trial (banner UX).
  {
    key:      'subscription.graceWarningDays',
    type:     'number',
    default:  3,
    label:    'platformConfig.subscriptionGraceWarningDays',
    help:     'platformConfig.subscriptionGraceWarningDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(0, 30),
  },
  // Jours de rétention des données après CANCELLED avant passage en CHURNED.
  {
    key:      'subscription.cancelDataTtlDays',
    type:     'number',
    default:  30,
    label:    'platformConfig.subscriptionCancelDataTtlDays',
    help:     'platformConfig.subscriptionCancelDataTtlDaysHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 365),
  },

  // ── Backup / Restore ───────────────────────────────────────────────────
  // Nombre max d'exports (backup + RGPD) par tenant par mois selon le plan.
  // En dessous de cette limite, les exports sont autorisés.
  {
    key:      'backup.maxExportsPerMonth',
    type:     'number',
    default:  10,
    label:    'platformConfig.backupMaxExportsPerMonth',
    help:     'platformConfig.backupMaxExportsPerMonthHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 1000),
  },
  // Rétention automatique des backups planifiés (nb de backups à conserver).
  {
    key:      'backup.defaultRetainCount',
    type:     'number',
    default:  7,
    label:    'platformConfig.backupDefaultRetainCount',
    help:     'platformConfig.backupDefaultRetainCountHelp',
    group:    'platformConfig.groupBilling',
    validate: numberInRange(1, 365),
  },

  // ── Subscription defaults ───────────────────────────────────────────────
  // Plan attribué par défaut aux tenants sans souscription (backfill +
  // onboarding). Doit matcher un Plan.slug existant et actif. Le backfill
  // retombe sur 'starter' si la clé n'est pas setée et que le plan existe.
  {
    key:      'subscription.defaultPlanSlug',
    type:     'string',
    default:  'starter',
    label:    'platformConfig.subscriptionDefaultPlanSlug',
    help:     'platformConfig.subscriptionDefaultPlanSlugHelp',
    group:    'platformConfig.groupBilling',
    validate: (v) => (typeof v === 'string' && v.trim().length > 0)
      ? null
      : 'platformConfig.errNotString',
  },

  // ── Waitlist anti-spam ──────────────────────────────────────────────────
  {
    key:      'waitlist.maxAttemptsPerEmail',
    type:     'number',
    default:  10,
    label:    'platformConfig.waitlistMaxAttempts',
    help:     'platformConfig.waitlistMaxAttemptsHelp',
    group:    'platformConfig.groupSecurity',
    validate: numberInRange(1, 1000),
  },

  // ── KPI plateforme (PlatformKpiService) ─────────────────────────────────
  // Occupation cible utilisée par le mode "Heuristique" du North Star :
  // si un tenant n'a pas déclaré `estimatedOperationsMonthly`, on compare
  // l'activité SaaS réelle à (capacité flotte × targetOccupancyRate).
  {
    key:      'kpi.targetOccupancyRate',
    type:     'number',
    default:  0.65, // 65% occupation théorique moyenne sectorielle
    label:    'platformConfig.kpiTargetOccupancyRate',
    help:     'platformConfig.kpiTargetOccupancyRateHelp',
    group:    'platformConfig.groupKpi',
    validate: numberInRange(0, 1),
  },
  // Période par défaut (en jours) pour calcul trends / MoM / retention.
  {
    key:      'kpi.defaultPeriodDays',
    type:     'number',
    default:  30,
    label:    'platformConfig.kpiDefaultPeriodDays',
    help:     'platformConfig.kpiDefaultPeriodDaysHelp',
    group:    'platformConfig.groupKpi',
    validate: numberInRange(1, 365),
  },
  // Seuils adoption : à partir de quel % de tenants qui utilisent un module
  // on le considère "adopté" (pour le rapport adoption produit).
  {
    key:      'kpi.moduleAdoptionThreshold',
    type:     'number',
    default:  0.3, // 30%
    label:    'platformConfig.kpiModuleAdoptionThreshold',
    help:     'platformConfig.kpiModuleAdoptionThresholdHelp',
    group:    'platformConfig.groupKpi',
    validate: numberInRange(0, 1),
  },
  // TTL cache KPI (secondes) — protège la DB d'une fréquence de refresh trop élevée.
  {
    key:      'kpi.cacheTtlSeconds',
    type:     'number',
    default:  60,
    label:    'platformConfig.kpiCacheTtlSeconds',
    help:     'platformConfig.kpiCacheTtlSecondsHelp',
    group:    'platformConfig.groupKpi',
    validate: numberInRange(10, 3600),
  },
  // Minimum trajets / tickets pour considérer un tenant "activé" (funnel).
  {
    key:      'kpi.activation.minTickets',
    type:     'number',
    default:  1,
    label:    'platformConfig.kpiActivationMinTickets',
    help:     'platformConfig.kpiActivationMinTicketsHelp',
    group:    'platformConfig.groupKpi',
    validate: numberInRange(1, 1000),
  },
  {
    key:      'kpi.activation.minTrips',
    type:     'number',
    default:  1,
    label:    'platformConfig.kpiActivationMinTrips',
    help:     'platformConfig.kpiActivationMinTripsHelp',
    group:    'platformConfig.groupKpi',
    validate: numberInRange(1, 1000),
  },

  // ── Pricing defaults (seed onboarding tenant) ───────────────────────────
  // Valeurs injectées au provisioning d'un nouveau tenant et utilisées comme
  // fallback par RouteService.create / backfill quand aucune PricingRules
  // n'existe pour une route. Un tenant admin peut ensuite tout surcharger via
  // PageTenantBusinessRules / PageTenantTaxes / PageTenantFareClasses.
  {
    key:      'pricing.defaults.luggageFreeKg',
    type:     'number',
    default:  20,
    label:    'platformConfig.pricingLuggageFreeKg',
    help:     'platformConfig.pricingLuggageFreeKgHelp',
    group:    'platformConfig.groupPricing',
    validate: numberInRange(0, 1000),
  },
  {
    key:      'pricing.defaults.luggagePerExtraKg',
    type:     'number',
    default:  100,
    label:    'platformConfig.pricingLuggagePerExtraKg',
    help:     'platformConfig.pricingLuggagePerExtraKgHelp',
    group:    'platformConfig.groupPricing',
    validate: numberInRange(0, 1_000_000),
  },
  {
    key:      'pricing.defaults.tollsXof',
    type:     'number',
    default:  0,
    label:    'platformConfig.pricingTollsXof',
    help:     'platformConfig.pricingTollsXofHelp',
    group:    'platformConfig.groupPricing',
    validate: numberInRange(0, 10_000_000),
  },
  {
    key:      'pricing.defaults.costPerKm',
    type:     'number',
    default:  0,
    label:    'platformConfig.pricingCostPerKm',
    help:     'platformConfig.pricingCostPerKmHelp',
    group:    'platformConfig.groupPricing',
    validate: numberInRange(0, 10_000),
  },
  // Liste des classes de voyage créées par défaut à l'onboarding.
  // Format : Array<{ code, labelKey, multiplier, sortOrder, color }>.
  // L'admin tenant peut ensuite ajouter/modifier/retirer via PageTenantFareClasses.
  {
    key:      'pricing.defaults.fareClasses',
    type:     'json',
    default:  [
      { code: 'STANDARD', labelKey: 'fareClass.standard', multiplier: 1.0, sortOrder: 0, color: '#6b7280' },
      { code: 'CONFORT',  labelKey: 'fareClass.confort',  multiplier: 1.4, sortOrder: 1, color: '#3b82f6' },
      { code: 'VIP',      labelKey: 'fareClass.vip',      multiplier: 2.0, sortOrder: 2, color: '#f59e0b' },
      { code: 'STANDING', labelKey: 'fareClass.standing', multiplier: 0.8, sortOrder: 3, color: '#94a3b8' },
    ],
    label:    'platformConfig.pricingFareClasses',
    help:     'platformConfig.pricingFareClassesHelp',
    group:    'platformConfig.groupPricing',
    validate: (v) => Array.isArray(v) && v.every(isFareClassDefault)
      ? null
      : 'platformConfig.errInvalidFareClasses',
  },

  // ── Tax defaults (seed onboarding) ─────────────────────────────────────
  // Une ligne TenantTax est créée automatiquement à l'onboarding avec ces
  // valeurs. enabled=tvaEnabled, rate=tvaRate. L'admin tenant peut désactiver
  // ou modifier ; il ne peut pas supprimer la ligne (isSystemDefault=true).
  {
    key:      'tax.defaults.tvaCode',
    type:     'string',
    default:  'TVA',
    label:    'platformConfig.taxTvaCode',
    help:     'platformConfig.taxTvaCodeHelp',
    group:    'platformConfig.groupTax',
    validate: (v) => (typeof v === 'string' && v.trim().length > 0)
      ? null
      : 'platformConfig.errNotString',
  },
  {
    key:      'tax.defaults.tvaLabelKey',
    type:     'string',
    default:  'tax.tva',
    label:    'platformConfig.taxTvaLabelKey',
    help:     'platformConfig.taxTvaLabelKeyHelp',
    group:    'platformConfig.groupTax',
    validate: (v) => (typeof v === 'string' && v.trim().length > 0)
      ? null
      : 'platformConfig.errNotString',
  },
  {
    key:      'tax.defaults.tvaRate',
    type:     'number',
    default:  0.189,
    label:    'platformConfig.taxTvaRate',
    help:     'platformConfig.taxTvaRateHelp',
    group:    'platformConfig.groupTax',
    validate: numberInRange(0, 1),
  },
  {
    key:      'tax.defaults.tvaEnabled',
    type:     'boolean',
    default:  false,
    label:    'platformConfig.taxTvaEnabled',
    help:     'platformConfig.taxTvaEnabledHelp',
    group:    'platformConfig.groupTax',
  },
  {
    key:      'tax.defaults.tvaAppliedToPrice',
    type:     'boolean',
    default:  false,
    label:    'platformConfig.taxTvaAppliedToPrice',
    help:     'platformConfig.taxTvaAppliedToPriceHelp',
    group:    'platformConfig.groupTax',
  },
  {
    key:      'tax.defaults.tvaAppliedToRecommendation',
    type:     'boolean',
    default:  true,
    label:    'platformConfig.taxTvaAppliedToRecommendation',
    help:     'platformConfig.taxTvaAppliedToRecommendationHelp',
    group:    'platformConfig.groupTax',
  },

  // ── Yield defaults (YieldService — remplace DEFAULT_YIELD_CONFIG) ───────
  // Les tenants qui activent le module YIELD_ENGINE peuvent surcharger ces
  // valeurs via InstalledModule.config. Par défaut le module reste désactivé.
  {
    key:      'yield.defaults.goldenDayMultiplier',
    type:     'number',
    default:  0.15,
    label:    'platformConfig.yieldGoldenDayMultiplier',
    help:     'platformConfig.yieldGoldenDayMultiplierHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 2),
  },
  {
    key:      'yield.defaults.lowFillThreshold',
    type:     'number',
    default:  0.40,
    label:    'platformConfig.yieldLowFillThreshold',
    help:     'platformConfig.yieldLowFillThresholdHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 1),
  },
  {
    key:      'yield.defaults.lowFillDiscount',
    type:     'number',
    default:  0.10,
    label:    'platformConfig.yieldLowFillDiscount',
    help:     'platformConfig.yieldLowFillDiscountHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 1),
  },
  {
    key:      'yield.defaults.highFillThreshold',
    type:     'number',
    default:  0.80,
    label:    'platformConfig.yieldHighFillThreshold',
    help:     'platformConfig.yieldHighFillThresholdHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 1),
  },
  {
    key:      'yield.defaults.highFillPremium',
    type:     'number',
    default:  0.10,
    label:    'platformConfig.yieldHighFillPremium',
    help:     'platformConfig.yieldHighFillPremiumHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 1),
  },
  {
    key:      'yield.defaults.priceFloorRate',
    type:     'number',
    default:  0.70,
    label:    'platformConfig.yieldPriceFloorRate',
    help:     'platformConfig.yieldPriceFloorRateHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0.1, 1),
  },
  {
    key:      'yield.defaults.priceCeilingRate',
    type:     'number',
    default:  2.00,
    label:    'platformConfig.yieldPriceCeilingRate',
    help:     'platformConfig.yieldPriceCeilingRateHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(1, 5),
  },
  {
    key:      'yield.defaults.goldenDayFillThreshold',
    type:     'number',
    default:  0.85,
    label:    'platformConfig.yieldGoldenDayFillThreshold',
    help:     'platformConfig.yieldGoldenDayFillThresholdHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 1),
  },
  {
    key:      'yield.defaults.blackRouteDeficitRatio',
    type:     'number',
    default:  0.50,
    label:    'platformConfig.yieldBlackRouteDeficitRatio',
    help:     'platformConfig.yieldBlackRouteDeficitRatioHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(0, 1),
  },
  {
    key:      'yield.defaults.analyticsWindowDays',
    type:     'number',
    default:  90,
    label:    'platformConfig.yieldAnalyticsWindowDays',
    help:     'platformConfig.yieldAnalyticsWindowDaysHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(7, 365),
  },
  // Fenêtre en heures avant le départ à partir de laquelle la règle "faible
  // remplissage" (discount) se déclenche. Défaut = J-2 (48h).
  {
    key:      'yield.defaults.lowFillTriggerHoursBeforeDeparture',
    type:     'number',
    default:  48,
    label:    'platformConfig.yieldLowFillTriggerHours',
    help:     'platformConfig.yieldLowFillTriggerHoursHelp',
    group:    'platformConfig.groupYield',
    validate: numberInRange(1, 720),
  },

  // ── Briefing pré-voyage QHSE (2026-04-24, refonte multi-chapitres) ─────
  // Défauts injectés au provisioning tenant dans TenantBusinessConfig. Un
  // admin tenant peut ensuite les surcharger via PageTenantBusinessRules
  // (section Briefing). Les valeurs ci-dessous servent aussi de fallback si
  // un ancien tenant pré-refonte n'a pas encore les colonnes seedées.
  {
    key:      'briefing.defaults.preTripPolicy',
    type:     'string',
    default:  'RECOMMENDED',
    label:    'platformConfig.briefingPreTripPolicy',
    help:     'platformConfig.briefingPreTripPolicyHelp',
    group:    'platformConfig.groupBriefing',
    validate: (v) => {
      if (typeof v !== 'string') return 'platformConfig.errNotString';
      return ['OFF', 'RECOMMENDED', 'RECOMMENDED_WITH_ALERT'].includes(v)
        ? null
        : 'platformConfig.briefingPreTripPolicyInvalid';
    },
  },
  {
    key:      'briefing.defaults.mandatoryFailurePolicy',
    type:     'string',
    default:  'WARN_ONLY',
    label:    'platformConfig.briefingMandatoryFailurePolicy',
    help:     'platformConfig.briefingMandatoryFailurePolicyHelp',
    group:    'platformConfig.groupBriefing',
    validate: (v) => {
      if (typeof v !== 'string') return 'platformConfig.errNotString';
      return ['WARN_ONLY', 'ALERT_MANAGER', 'BLOCK_DEPARTURE'].includes(v)
        ? null
        : 'platformConfig.briefingMandatoryFailurePolicyInvalid';
    },
  },
  {
    key:      'briefing.defaults.restShortfallPolicy',
    type:     'string',
    default:  'WARN',
    label:    'platformConfig.briefingRestShortfallPolicy',
    help:     'platformConfig.briefingRestShortfallPolicyHelp',
    group:    'platformConfig.groupBriefing',
    validate: (v) => {
      if (typeof v !== 'string') return 'platformConfig.errNotString';
      return ['WARN', 'ALERT', 'BLOCK'].includes(v)
        ? null
        : 'platformConfig.briefingRestShortfallPolicyInvalid';
    },
  },
  {
    key:      'briefing.defaults.minDriverRestHours',
    type:     'number',
    default:  11, // réglementation UE transport routier
    label:    'platformConfig.briefingMinDriverRestHours',
    help:     'platformConfig.briefingMinDriverRestHoursHelp',
    group:    'platformConfig.groupBriefing',
    validate: numberInRange(0, 72),
  },

  // ── Notifications cycle de vie voyageur (TripReminderScheduler) ────────
  // Active l'envoi multi-canal (SMS/WA/Email/IN_APP) sur les 5 évènements :
  // achat billet, ouverture trajet, ouverture embarquement, rappel pré-voyage,
  // arrivée. Désactivable globalement (ex: incident provider Twilio).
  {
    key:      'notifications.lifecycle.enabled',
    type:     'boolean',
    default:  true,
    label:    'platformConfig.notifLifecycleEnabled',
    help:     'platformConfig.notifLifecycleEnabledHelp',
    group:    'platformConfig.groupNotifications',
  },
  // Seuils (heures avant départ) auxquels TripReminderScheduler émet un
  // TRIP_REMINDER_DUE par trip + ticket. Ordre quelconque, dédupliqué.
  // Défaut [24, 6, 1] = J-1, H-6, H-1.
  {
    key:      'notifications.reminders.hoursBeforeDeparture',
    type:     'json',
    default:  [24, 6, 1],
    label:    'platformConfig.notifReminderThresholds',
    help:     'platformConfig.notifReminderThresholdsHelp',
    group:    'platformConfig.groupNotifications',
    validate: (v) => {
      if (!Array.isArray(v)) return 'platformConfig.errInvalidArray';
      if (v.length === 0)    return 'platformConfig.errInvalidArray';
      const allValid = v.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 720);
      return allValid ? null : 'platformConfig.errInvalidArray';
    },
  },
  // Fenêtre (en minutes) du scan cron : un seuil de 24h sera "tiré" pour
  // tout trip dont le départ est dans [24h - window/2, 24h + window/2].
  // Défaut 15 min — doit être ≥ fréquence du @Cron (15 min).
  {
    key:      'notifications.reminders.scanWindowMinutes',
    type:     'number',
    default:  15,
    label:    'platformConfig.notifReminderScanWindow',
    help:     'platformConfig.notifReminderScanWindowHelp',
    group:    'platformConfig.groupNotifications',
    validate: numberInRange(5, 120),
  },
  // Limite de fan-out par tir (sécurité anti-spam si erreur de filtre).
  // Si un cron-tick veut envoyer + de N notifs sur un seul trip → log + skip.
  {
    key:      'notifications.reminders.maxRecipientsPerTrip',
    type:     'number',
    default:  500,
    label:    'platformConfig.notifReminderMaxRecipients',
    help:     'platformConfig.notifReminderMaxRecipientsHelp',
    group:    'platformConfig.groupNotifications',
    validate: numberInRange(1, 10_000),
  },

  // ── Routage routier ─────────────────────────────────────────────────────
  // Active le calcul de distance via API externe (Google Maps ou Mapbox).
  // Désactivé par défaut — aucun appel externe en dev/staging sans clé Vault.
  // Voir docs/ROUTING_SETUP.md pour le guide d'activation.
  {
    key:      'routing.enabled',
    type:     'boolean',
    default:  false,
    label:    'platformConfig.routingEnabled',
    help:     'platformConfig.routingEnabledHelp',
    group:    'platformConfig.groupRouting',
  },
  {
    key:      'routing.provider',
    type:     'string',
    default:  'haversine',
    label:    'platformConfig.routingProvider',
    help:     'platformConfig.routingProviderHelp',
    group:    'platformConfig.groupRouting',
    validate: (v) => {
      if (typeof v !== 'string') return 'platformConfig.errNotString';
      if (!['haversine', 'google', 'mapbox'].includes(v)) return 'platformConfig.routingProviderInvalid';
      return null;
    },
  },
  // Provider de geocoding (adresse → lat/lng + reverse). Valeurs possibles :
  //  - 'auto'      : essaie Google → Mapbox → Nominatim selon disponibilite Vault
  //  - 'google'    : force Google (fallback Nominatim si echec/non configure)
  //  - 'mapbox'    : force Mapbox (fallback Nominatim si echec/non configure)
  //  - 'nominatim' : force Nominatim seul (gratuit, qualite degradee Afrique)
  {
    key:      'geo.provider',
    type:     'string',
    default:  'auto',
    label:    'platformConfig.geoProvider',
    help:     'platformConfig.geoProviderHelp',
    group:    'platformConfig.groupRouting',
    validate: (v) => {
      if (typeof v !== 'string') return 'platformConfig.errNotString';
      if (!['auto', 'google', 'mapbox', 'nominatim'].includes(v)) return 'platformConfig.geoProviderInvalid';
      return null;
    },
  },
];

// ─── Validators JSON ─────────────────────────────────────────────────────────

interface FareClassDefault {
  code:       string;
  labelKey:   string;
  multiplier: number;
  sortOrder:  number;
  color?:     string;
}

function isFareClassDefault(v: unknown): v is FareClassDefault {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.code       === 'string' && o.code.trim().length > 0
      && typeof o.labelKey   === 'string' && o.labelKey.trim().length > 0
      && typeof o.multiplier === 'number' && Number.isFinite(o.multiplier) && o.multiplier > 0
      && typeof o.sortOrder  === 'number' && Number.isInteger(o.sortOrder);
}

export function findDef(key: string): PlatformConfigDef<unknown> | undefined {
  return PLATFORM_CONFIG_REGISTRY.find(d => d.key === key);
}
