/**
 * ICostCalculator — Interface pure pour le calcul de rentabilité par trajet.
 *
 * ADR-26 : Séparation entre la logique de calcul (CostCalculatorEngine, pure TypeScript)
 * et la couche d'orchestration Prisma (ProfitabilityService).
 *
 * CostCalculatorEngine n'importe aucun module NestJS ni Prisma — testable
 * en isolation totale, sans base de données.
 */

// ─── Profil de coût en entrée ─────────────────────────────────────────────────

export interface CostInputProfile {
  // Carburant
  fuelConsumptionPer100Km: number; // L/100km
  fuelPricePerLiter:       number; // €/L ou devise tenant
  // AdBlue (Euro 6) — optionnel, 0 si absent
  adBlueCostPerLiter:      number; // €/L
  adBlueRatioFuel:         number; // fraction du volume carburant (défaut 0.05)
  // Maintenance au km (ADR-23)
  maintenanceCostPerKm:    number; // €/km
  // Frais de départ
  stationFeePerDeparture:  number; // redevance gare routière par départ
  driverAllowancePerTrip:  number; // indemnités chauffeur par trajet
  tollFeesPerTrip:         number; // péages par trajet
  // Fixes mensuels
  driverMonthlySalary:     number; // salaire mensuel chauffeur
  annualInsuranceCost:     number; // assurance annuelle bus
  monthlyAgencyFees:       number; // frais agence mensuels fixes
  // Amortissement
  purchasePrice:           number; // prix d'achat
  depreciationYears:       number; // durée d'amortissement (ans)
  residualValue:           number; // valeur résiduelle
  // Proratisation
  avgTripsPerMonth:        number; // trajets/mois (pour coûts fixes)
}

// ─── Constantes métier globales (issues de TenantBusinessConfig) ──────────────

export interface BusinessConstants {
  daysPerYear:           number; // 365 par défaut
  breakEvenThresholdPct: number; // 0.05 = ±5 %
  agencyCommissionRate:  number; // 0.03 = 3 % sur revenus billets
}

export const DEFAULT_BUSINESS_CONSTANTS: BusinessConstants = {
  daysPerYear:           365,
  breakEvenThresholdPct: 0.05,
  agencyCommissionRate:  0.03,
};

// ─── Décomposition des coûts ──────────────────────────────────────────────────

export interface CostBreakdown {
  // Coûts variables directs
  fuelCost:             number;
  adBlueCost:           number;
  maintenanceCost:      number; // km-based
  stationFee:           number;
  tollFees:             number;
  driverAllowance:      number;
  totalVariableCost:    number;
  // Coûts fixes proratisés au trajet
  driverDailyCost:      number;
  insuranceDailyCost:   number;
  agencyDailyCost:      number;
  depreciationDaily:    number;
  totalFixedCost:       number;
  // Total
  totalCost:            number;
}

// ─── Hiérarchie de marges (ADR-27) ───────────────────────────────────────────

export interface MarginBreakdown {
  // Marge opérationnelle = revenu − coûts variables
  operationalMargin:     number;
  operationalMarginRate: number;
  // Commission agence (déduite du revenu billet post-snapshot)
  agencyCommission:      number;
  netTenantRevenue:      number; // totalRevenue - agencyCommission
  // Marge nette = revenu − coût total
  netMargin:             number;
  netMarginRate:         number;
  // KPIs
  fillRate:              number;
  breakEvenSeats:        number;
  profitabilityTag:      'PROFITABLE' | 'BREAK_EVEN' | 'DEFICIT';
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ICostCalculator {
  /**
   * Calcule la décomposition des coûts pour un trajet.
   * Aucune dépendance externe — déterministe et testable unitairement.
   */
  computeCosts(distanceKm: number, profile: CostInputProfile): CostBreakdown;

  /**
   * Calcule les marges opérationnelle et nette.
   */
  computeMargins(
    costs:          CostBreakdown,
    totalRevenue:   number,
    ticketRevenue:  number,
    totalSeats:     number,
    bookedSeats:    number,
    avgTicketPrice: number,
    constants:      BusinessConstants,
  ): MarginBreakdown;
}
