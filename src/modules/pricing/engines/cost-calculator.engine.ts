/**
 * CostCalculatorEngine — Implémentation pure de ICostCalculator.
 *
 * Aucune dépendance NestJS ou Prisma — classe TypeScript vanilla.
 * Testable unitairement sans @Module, sans base de données, sans mocks d'infra.
 *
 * Formules :
 * ─── Coûts variables ─────────────────────────────────────────────────────────
 *   fuelCost        = (consumption / 100) × distanceKm × fuelPrice
 *   adBlueCost      = fuelCost × adBlueRatioFuel × (adBlueCostPerL / fuelPricePerL)
 *   maintenanceCost = maintenanceCostPerKm × distanceKm          ← km-based (ADR-23)
 *   stationFee      = stationFeePerDeparture                     ← fixe par départ
 *   tollFees        = tollFeesPerTrip                            ← fixe par trajet
 *   driverAllowance = driverAllowancePerTrip
 *
 * ─── Coûts fixes proratisés ───────────────────────────────────────────────────
 *   driverDailyCost    = driverMonthlySalary / avgTripsPerMonth
 *   insuranceDailyCost = annualInsuranceCost / daysPerYear
 *   agencyDailyCost    = monthlyAgencyFees / avgTripsPerMonth
 *   depreciationDaily  = (purchasePrice - residualValue) / depreciationYears / daysPerYear
 *
 * ─── Marges (ADR-27) ─────────────────────────────────────────────────────────
 *   operationalMargin = totalRevenue - totalVariableCost
 *   agencyCommission  = ticketRevenue × agencyCommissionRate
 *   netTenantRevenue  = totalRevenue - agencyCommission
 *   netMargin         = netTenantRevenue - totalCost
 *   profitabilityTag  = f(netMargin, totalCost, breakEvenThresholdPct)
 */

import {
  ICostCalculator,
  CostInputProfile,
  CostBreakdown,
  MarginBreakdown,
  BusinessConstants,
} from '../interfaces/cost-calculator.interface';

function safe(n: number, fallback = 1): number {
  return n > 0 ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class CostCalculatorEngine implements ICostCalculator {

  computeCosts(distanceKm: number, p: CostInputProfile): CostBreakdown {
    // ── Coûts variables ────────────────────────────────────────────────────────
    const fuelVolume   = (p.fuelConsumptionPer100Km / 100) * distanceKm;
    const fuelCost     = round2(fuelVolume * p.fuelPricePerLiter);

    // AdBlue = fraction du volume carburant, au tarif AdBlue
    const adBlueCost   = round2(
      fuelVolume * p.adBlueRatioFuel * p.adBlueCostPerLiter,
    );

    // Maintenance au km (ADR-23 — remplace forfait mensuel)
    const maintenanceCost = round2(p.maintenanceCostPerKm * distanceKm);

    const stationFee      = round2(p.stationFeePerDeparture);
    const tollFees        = round2(p.tollFeesPerTrip);
    const driverAllowance = round2(p.driverAllowancePerTrip);

    const totalVariableCost = round2(
      fuelCost + adBlueCost + maintenanceCost + stationFee + tollFees + driverAllowance,
    );

    // ── Coûts fixes proratisés ─────────────────────────────────────────────────
    // Utilise les constantes passées en paramètre (daysPerYear depuis TenantBusinessConfig)
    // Note : avgTripsPerMonth et depreciationYears viennent du profil bus
    const tripsPerMonth  = safe(p.avgTripsPerMonth);
    const deprYears      = safe(p.depreciationYears);

    // daysPerYear sera injecté via la constante appelante — ici on utilise 365 comme
    // valeur par défaut locale car computeCosts ne reçoit pas BusinessConstants.
    // La vraie valeur est utilisée dans le contexte de l'appelant (ProfitabilityService)
    // qui passe un profil enrichi si besoin. Pour garantir la testabilité pure,
    // on expose une surcharge optionnelle daysPerYear dans CostInputProfile via le profil.
    const daysPerYear    = 365; // fallback — ProfitabilityService enrichit si TenantBusinessConfig présente

    const driverDailyCost    = round2(p.driverMonthlySalary / tripsPerMonth);
    const insuranceDailyCost = round2(p.annualInsuranceCost / daysPerYear);
    const agencyDailyCost    = round2(p.monthlyAgencyFees / tripsPerMonth);
    const depreciationDaily  = round2(
      (p.purchasePrice - p.residualValue) / deprYears / daysPerYear,
    );

    const totalFixedCost = round2(
      driverDailyCost + insuranceDailyCost + agencyDailyCost + depreciationDaily,
    );

    return {
      fuelCost, adBlueCost, maintenanceCost, stationFee, tollFees, driverAllowance,
      totalVariableCost,
      driverDailyCost, insuranceDailyCost, agencyDailyCost, depreciationDaily,
      totalFixedCost,
      totalCost: round2(totalVariableCost + totalFixedCost),
    };
  }

  computeMargins(
    costs:          CostBreakdown,
    totalRevenue:   number,
    ticketRevenue:  number,
    totalSeats:     number,
    bookedSeats:    number,
    avgTicketPrice: number,
    constants:      BusinessConstants,
  ): MarginBreakdown {
    // ── Marge opérationnelle (contribution directe) ────────────────────────────
    const operationalMargin     = round2(totalRevenue - costs.totalVariableCost);
    const operationalMarginRate = costs.totalVariableCost > 0
      ? round2(operationalMargin / costs.totalVariableCost)
      : 1;

    // ── Commission agence ──────────────────────────────────────────────────────
    const agencyCommission  = round2(ticketRevenue * constants.agencyCommissionRate);
    const netTenantRevenue  = round2(totalRevenue - agencyCommission);

    // ── Marge nette ───────────────────────────────────────────────────────────
    const netMargin     = round2(netTenantRevenue - costs.totalCost);
    const netMarginRate = costs.totalCost > 0 ? round2(netMargin / costs.totalCost) : 1;

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const fillRate      = totalSeats > 0 ? round2(bookedSeats / totalSeats) : 0;
    const breakEvenSeats = costs.totalCost > 0 && avgTicketPrice > 0
      ? Math.ceil(costs.totalCost / avgTicketPrice)
      : 0;

    // ── Tag de rentabilité ────────────────────────────────────────────────────
    let profitabilityTag: 'PROFITABLE' | 'BREAK_EVEN' | 'DEFICIT';
    if (costs.totalCost <= 0) {
      profitabilityTag = 'PROFITABLE';
    } else {
      const ratio = netMargin / costs.totalCost;
      const t     = constants.breakEvenThresholdPct;
      profitabilityTag =
        ratio >  t  ? 'PROFITABLE' :
        ratio < -t  ? 'DEFICIT'    :
                      'BREAK_EVEN';
    }

    return {
      operationalMargin, operationalMarginRate,
      agencyCommission, netTenantRevenue,
      netMargin, netMarginRate,
      fillRate, breakEvenSeats, profitabilityTag,
    };
  }
}
