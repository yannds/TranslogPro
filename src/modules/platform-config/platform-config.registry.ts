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
];

export function findDef(key: string): PlatformConfigDef<unknown> | undefined {
  return PLATFORM_CONFIG_REGISTRY.find(d => d.key === key);
}
