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
  type:     'number' | 'boolean' | 'string';
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
];

export function findDef(key: string): PlatformConfigDef<unknown> | undefined {
  return PLATFORM_CONFIG_REGISTRY.find(d => d.key === key);
}
