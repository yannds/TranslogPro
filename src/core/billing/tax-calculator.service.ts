/**
 * TaxCalculatorService — calcul centralisé des taxes tenant.
 *
 * C'est la SEULE place du code où des formules fiscales sont appliquées.
 * Toutes les valeurs (taux, base, cascade) viennent de la table `TenantTax`.
 * Aucune constante littérale ici — la règle "no magic numbers" s'applique
 * même aux tests (qui passent leurs propres fixtures).
 *
 * Pure function : pas de dépendance Prisma, entièrement testable unitairement.
 * La lecture en DB est faite en amont par le service appelant (orchestrator,
 * invoice builder, etc.) qui passe la liste `taxes` déjà filtrée/triée.
 *
 * Sémantique des bases :
 *   - SUBTOTAL                : taxe appliquée au HT (classique).
 *   - TOTAL_AFTER_PREVIOUS    : taxe appliquée à (HT + somme des taxes avec
 *                               sortOrder strictement inférieur). Permet la
 *                               cascade « taxe sur taxe ».
 *
 * Les taxes sont triées par `sortOrder` ASC avant calcul.
 */

export interface TenantTaxInput {
  code:      string;
  label:     string;
  labelKey?: string | null;
  rate:      number;
  kind:      'PERCENT' | 'FIXED';
  base:      'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS';
  appliesTo: string[];  // ['TICKET', 'PARCEL', 'SUBSCRIPTION', 'ALL']
  sortOrder: number;
  enabled:   boolean;
  validFrom?: Date | null;
  validTo?:   Date | null;
}

export interface TaxLine {
  code:   string;
  label:  string;
  labelKey?: string | null;
  base:   'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS';
  kind:   'PERCENT' | 'FIXED';
  rate:   number;
  /** Montant calculé, arrondi à 2 décimales. */
  amount: number;
  /** Base sur laquelle la taxe a été appliquée (audit trail). */
  appliedOn: number;
}

export interface TaxComputation {
  subtotal:    number;
  taxes:       TaxLine[];
  taxTotal:    number;
  total:       number;
  currency:    string;
}

export interface ComputeTaxesInput {
  subtotal:   number;
  currency:   string;
  entityType: string;           // 'TICKET' | 'PARCEL' | 'SUBSCRIPTION' | 'INVOICE' | 'CUSTOM'
  taxes:      TenantTaxInput[]; // liste complète du tenant, le filtrage se fait ici
  at?:        Date;             // date effective du calcul (défaut = now)
}

/**
 * Filtre les taxes applicables à l'entité à la date donnée :
 *   - enabled = true
 *   - appliesTo contient entityType ou 'ALL'
 *   - validFrom ≤ at (ou null)
 *   - validTo   > at (ou null)
 */
export function filterApplicableTaxes(
  taxes:      TenantTaxInput[],
  entityType: string,
  at:         Date,
): TenantTaxInput[] {
  return taxes.filter(t => {
    if (!t.enabled) return false;
    if (!t.appliesTo.includes(entityType) && !t.appliesTo.includes('ALL')) return false;
    if (t.validFrom && at < t.validFrom) return false;
    if (t.validTo   && at >= t.validTo)   return false;
    return true;
  });
}

/**
 * Calcule un montant de taxe selon son kind/base/rate.
 * Helper interne exporté pour tests ciblés.
 */
export function computeTaxAmount(
  tax:               TenantTaxInput,
  subtotal:          number,
  cumulPreviousTaxes: number,
): { amount: number; appliedOn: number } {
  const base = tax.base === 'TOTAL_AFTER_PREVIOUS'
    ? subtotal + cumulPreviousTaxes
    : subtotal;

  const amount = tax.kind === 'FIXED'
    ? tax.rate
    : base * tax.rate;

  return { amount: round2(amount), appliedOn: round2(base) };
}

/**
 * Arrondi commercial à 2 décimales (toutes les devises supportées — XAF/XOF
 * tolèrent les décimales en comptabilité avant arrondi final par le provider).
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcule la décomposition fiscale complète pour un achat.
 * Retourne subtotal, liste détaillée des taxes appliquées, total taxes, TTC.
 */
export function computeTaxes(input: ComputeTaxesInput): TaxComputation {
  const at = input.at ?? new Date();
  const applicable = filterApplicableTaxes(input.taxes, input.entityType, at)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const subtotal = round2(input.subtotal);
  const lines: TaxLine[] = [];
  let cumul = 0;

  for (const t of applicable) {
    const { amount, appliedOn } = computeTaxAmount(t, subtotal, cumul);
    lines.push({
      code:      t.code,
      label:     t.label,
      labelKey:  t.labelKey ?? null,
      base:      t.base,
      kind:      t.kind,
      rate:      t.rate,
      amount,
      appliedOn,
    });
    cumul += amount;
  }

  const taxTotal = round2(cumul);
  return {
    subtotal,
    taxes:    lines,
    taxTotal,
    total:    round2(subtotal + taxTotal),
    currency: input.currency,
  };
}
