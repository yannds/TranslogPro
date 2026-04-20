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
  /** Réellement appliquée au prix facturé. Si false, ignorée en context PRICE. */
  appliedToPrice?:          boolean;
  /** Prise en compte par le simulateur de prix. Si false, ignorée en RECOMMENDATION. */
  appliedToRecommendation?: boolean;
  validFrom?: Date | null;
  validTo?:   Date | null;
}

/**
 * Contexte d'application.
 *   - PRICE          : prix facturé au client. Filtre sur `appliedToPrice`.
 *   - RECOMMENDATION : simulateur de prix, break-even. Filtre sur `appliedToRecommendation`.
 *
 * Une même taxe peut être dans un contexte mais pas l'autre — ex: TVA saisie
 * mais non appliquée au prix (pédagogique) mais toujours prise en compte par
 * le simulateur qui anticipe "si tu l'actives demain".
 */
export type TaxContext = 'PRICE' | 'RECOMMENDATION';

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
  /**
   * True = intégrée au `taxTotal` / `total`.
   * False = calculée à titre pédagogique (affichage grisé "serait X XOF")
   *         mais pas additionnée au total. Utilisé quand `includeNonApplied`
   *         est vrai dans `computeTaxes`.
   */
  applied: boolean;
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
  /** Défaut = 'PRICE'. Détermine le filtre `appliedToPrice`/`appliedToRecommendation`. */
  context?:   TaxContext;
  /**
   * Si true, les taxes enabled mais non-appliquées dans le context courant
   * sont incluses dans `taxes[]` avec `applied=false` et un montant calculé
   * (pédagogique). Elles ne sont PAS additionnées au `taxTotal` / `total`.
   * Utilisé par l'UI caissier pour afficher "serait X XOF en grisé".
   */
  includeNonApplied?: boolean;
}

/**
 * Filtre les taxes applicables à l'entité à la date donnée :
 *   - enabled = true
 *   - appliesTo contient entityType ou 'ALL'
 *   - validFrom ≤ at (ou null)
 *   - validTo   > at (ou null)
 *   - selon le context : appliedToPrice ou appliedToRecommendation
 *     (absent = true par défaut — rétro-compat avec les taxes historiques).
 */
export function filterApplicableTaxes(
  taxes:      TenantTaxInput[],
  entityType: string,
  at:         Date,
  context:    TaxContext = 'PRICE',
): TenantTaxInput[] {
  return taxes.filter(t => {
    if (!t.enabled) return false;
    if (!t.appliesTo.includes(entityType) && !t.appliesTo.includes('ALL')) return false;
    if (t.validFrom && at < t.validFrom) return false;
    if (t.validTo   && at >= t.validTo)   return false;
    if (context === 'PRICE'          && t.appliedToPrice          === false) return false;
    if (context === 'RECOMMENDATION' && t.appliedToRecommendation === false) return false;
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
  const at      = input.at ?? new Date();
  const context = input.context ?? 'PRICE';
  const applied = filterApplicableTaxes(input.taxes, input.entityType, at, context)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const subtotal = round2(input.subtotal);
  const lines: TaxLine[] = [];
  let cumul = 0;

  for (const t of applied) {
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
      applied:   true,
    });
    cumul += amount;
  }

  // Mode pédagogique : inclure les taxes enabled du bon entityType mais
  // exclues par le filtrage context (ex: appliedToPrice=false en PRICE).
  // Montant calculé sur `subtotal` seul (pas en cascade — cascade réservée
  // aux taxes vraiment appliquées). Pas incluses dans taxTotal/total.
  if (input.includeNonApplied) {
    const appliedCodes = new Set(applied.map(t => t.code));
    const candidates   = input.taxes.filter(t => {
      if (!t.enabled) return false;
      if (!t.appliesTo.includes(input.entityType) && !t.appliesTo.includes('ALL')) return false;
      if (t.validFrom && at < t.validFrom) return false;
      if (t.validTo   && at >= t.validTo)   return false;
      return !appliedCodes.has(t.code);
    });
    for (const t of candidates) {
      const amount = t.kind === 'FIXED' ? t.rate : subtotal * t.rate;
      lines.push({
        code:      t.code,
        label:     t.label,
        labelKey:  t.labelKey ?? null,
        base:      t.base,
        kind:      t.kind,
        rate:      t.rate,
        amount:    round2(amount),
        appliedOn: subtotal,
        applied:   false,
      });
    }
    // Tri stable par sortOrder pour que le breakdown pédagogique reste lisible
    lines.sort((a, b) => {
      const ai = input.taxes.find(t => t.code === a.code)?.sortOrder ?? 0;
      const bi = input.taxes.find(t => t.code === b.code)?.sortOrder ?? 0;
      return ai - bi;
    });
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
