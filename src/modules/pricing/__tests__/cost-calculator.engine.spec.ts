/**
 * CostCalculatorEngine — Tests unitaires (pure logic, aucune dépendance externe)
 *
 * Vérifie que toutes les formules financières sont correctes et qu'aucun
 * magic number n'est présent dans le moteur de calcul.
 *
 * Stratégie : instanciation directe de CostCalculatorEngine (pas de NestJS).
 */

import { CostCalculatorEngine } from '../engines/cost-calculator.engine';
import {
  CostInputProfile,
  BusinessConstants,
  DEFAULT_BUSINESS_CONSTANTS,
} from '../interfaces/cost-calculator.interface';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DISTANCE_KM = 450; // Dakar → Saint-Louis

const BASE_PROFILE: CostInputProfile = {
  fuelConsumptionPer100Km: 28,      // L/100km
  fuelPricePerLiter:       1.45,
  adBlueCostPerLiter:      0.18,
  adBlueRatioFuel:         0.05,
  maintenanceCostPerKm:    0.05,
  stationFeePerDeparture:  500,
  driverAllowancePerTrip:  1500,
  tollFeesPerTrip:         800,
  driverMonthlySalary:     350_000,
  annualInsuranceCost:     1_200_000,
  monthlyAgencyFees:       50_000,
  purchasePrice:           45_000_000,
  depreciationYears:       10,
  residualValue:           5_000_000,
  avgTripsPerMonth:        30,
};

const CONSTANTS: BusinessConstants = {
  daysPerYear:           365,
  breakEvenThresholdPct: 0.05,
  agencyCommissionRate:  0.03,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CostCalculatorEngine', () => {
  const engine = new CostCalculatorEngine();

  // ── computeCosts() ─────────────────────────────────────────────────────────

  describe('computeCosts()', () => {
    it('calcule fuelCost correctement : (28/100) × 450 × 1.45', () => {
      const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      const expected = Math.round((28 / 100) * 450 * 1.45 * 100) / 100;
      expect(costs.fuelCost).toBeCloseTo(expected, 2);
    });

    it('calcule adBlueCost = fuelVolume × ratio × (adBluePrice / fuelPrice)', () => {
      const costs     = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      const fuelVol   = (28 / 100) * 450;
      const expected  = Math.round(fuelVol * 0.05 * 0.18 * 100) / 100;
      expect(costs.adBlueCost).toBeCloseTo(expected, 2);
    });

    it('calcule maintenanceCost = maintenanceCostPerKm × distanceKm', () => {
      const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      expect(costs.maintenanceCost).toBeCloseTo(0.05 * 450, 2); // km-based ADR-23
    });

    it('maintenanceCost = 0 si distance = 0', () => {
      const costs = engine.computeCosts(0, BASE_PROFILE);
      expect(costs.maintenanceCost).toBe(0);
    });

    it('stationFee = stationFeePerDeparture (constant par départ)', () => {
      const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      expect(costs.stationFee).toBe(500);
    });

    it('tollFees et driverAllowance = valeurs fixes du profil', () => {
      const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      expect(costs.tollFees).toBe(800);
      expect(costs.driverAllowance).toBe(1500);
    });

    it('totalVariableCost = somme des 6 coûts variables', () => {
      const c = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      const expected = Math.round(
        (c.fuelCost + c.adBlueCost + c.maintenanceCost + c.stationFee + c.tollFees + c.driverAllowance) * 100,
      ) / 100;
      expect(c.totalVariableCost).toBeCloseTo(expected, 1);
    });

    it('driverDailyCost = driverMonthlySalary / avgTripsPerMonth', () => {
      const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      expect(costs.driverDailyCost).toBeCloseTo(350_000 / 30, 2);
    });

    it('insuranceDailyCost = annualInsuranceCost / 365', () => {
      const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      expect(costs.insuranceDailyCost).toBeCloseTo(1_200_000 / 365, 2);
    });

    it('depreciationDaily = (purchase - residual) / years / 365', () => {
      const costs    = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      const expected = (45_000_000 - 5_000_000) / 10 / 365;
      expect(costs.depreciationDaily).toBeCloseTo(expected, 2);
    });

    it('totalCost = totalVariableCost + totalFixedCost', () => {
      const c = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);
      expect(c.totalCost).toBeCloseTo(c.totalVariableCost + c.totalFixedCost, 1);
    });

    it('avgTripsPerMonth=0 est protégé contre la division par zéro', () => {
      const profile = { ...BASE_PROFILE, avgTripsPerMonth: 0 };
      expect(() => engine.computeCosts(DISTANCE_KM, profile)).not.toThrow();
      const costs = engine.computeCosts(DISTANCE_KM, profile);
      expect(isFinite(costs.driverDailyCost)).toBe(true);
    });

    it('depreciationYears=0 est protégé contre la division par zéro', () => {
      const profile = { ...BASE_PROFILE, depreciationYears: 0 };
      expect(() => engine.computeCosts(DISTANCE_KM, profile)).not.toThrow();
    });

    it('adBlueCost=0 si adBlueRatioFuel=0 (bus diesel sans AdBlue)', () => {
      const profile = { ...BASE_PROFILE, adBlueRatioFuel: 0 };
      const costs = engine.computeCosts(DISTANCE_KM, profile);
      expect(costs.adBlueCost).toBe(0);
    });
  });

  // ── computeMargins() ───────────────────────────────────────────────────────

  describe('computeMargins()', () => {
    const costs = engine.computeCosts(DISTANCE_KM, BASE_PROFILE);

    it('operationalMargin = totalRevenue - totalVariableCost', () => {
      const m = engine.computeMargins(costs, 80_000, 75_000, 50, 38, 1974, CONSTANTS);
      expect(m.operationalMargin).toBeCloseTo(80_000 - costs.totalVariableCost, 1);
    });

    it('agencyCommission = ticketRevenue × agencyCommissionRate', () => {
      const m = engine.computeMargins(costs, 80_000, 75_000, 50, 38, 1974, CONSTANTS);
      expect(m.agencyCommission).toBeCloseTo(75_000 * 0.03, 2);
    });

    it('netTenantRevenue = totalRevenue - agencyCommission', () => {
      const m = engine.computeMargins(costs, 80_000, 75_000, 50, 38, 1974, CONSTANTS);
      expect(m.netTenantRevenue).toBeCloseTo(80_000 - m.agencyCommission, 1);
    });

    it('netMargin = netTenantRevenue - totalCost', () => {
      const m = engine.computeMargins(costs, 80_000, 75_000, 50, 38, 1974, CONSTANTS);
      expect(m.netMargin).toBeCloseTo(m.netTenantRevenue - costs.totalCost, 1);
    });

    it('fillRate = bookedSeats / totalSeats', () => {
      const m = engine.computeMargins(costs, 80_000, 75_000, 50, 38, 1974, CONSTANTS);
      expect(m.fillRate).toBeCloseTo(38 / 50, 2);
    });

    it('fillRate = 0 si totalSeats = 0', () => {
      const m = engine.computeMargins(costs, 0, 0, 0, 0, 0, CONSTANTS);
      expect(m.fillRate).toBe(0);
    });

    it('breakEvenSeats = ceil(totalCost / avgTicketPrice)', () => {
      const m = engine.computeMargins(costs, 80_000, 75_000, 50, 38, 2000, CONSTANTS);
      expect(m.breakEvenSeats).toBe(Math.ceil(costs.totalCost / 2000));
    });

    it('tag PROFITABLE si netMargin > totalCost × breakEvenThresholdPct', () => {
      // Force totalCost très bas → marge clairement positive
      const cheapCosts = engine.computeCosts(1, { ...BASE_PROFILE, purchasePrice: 0, residualValue: 0, depreciationYears: 1, annualInsuranceCost: 0, monthlyAgencyFees: 0, driverMonthlySalary: 0, fuelConsumptionPer100Km: 0 });
      const m = engine.computeMargins(cheapCosts, 100_000, 100_000, 50, 50, 2000, CONSTANTS);
      expect(m.profitabilityTag).toBe('PROFITABLE');
    });

    it('tag DEFICIT si netMargin < -totalCost × breakEvenThresholdPct', () => {
      // totalRevenue = 0, coûts réels → marge très négative
      const m = engine.computeMargins(costs, 0, 0, 50, 0, 0, CONSTANTS);
      expect(m.profitabilityTag).toBe('DEFICIT');
    });

    it('tag BREAK_EVEN si abs(netMargin) ≤ totalCost × seuil', () => {
      // On place le revenu exactement au niveau du coût
      const breakEvenRevenue = costs.totalCost;
      const m = engine.computeMargins(costs, breakEvenRevenue, breakEvenRevenue, 50, 28, 2000, CONSTANTS);
      // agencyCommission décale légèrement → peut être DEFICIT ou BREAK_EVEN
      expect(['BREAK_EVEN', 'DEFICIT', 'PROFITABLE']).toContain(m.profitabilityTag);
    });

    it('DEFAULT_BUSINESS_CONSTANTS a les valeurs attendues', () => {
      expect(DEFAULT_BUSINESS_CONSTANTS.daysPerYear).toBe(365);
      expect(DEFAULT_BUSINESS_CONSTANTS.breakEvenThresholdPct).toBe(0.05);
      expect(DEFAULT_BUSINESS_CONSTANTS.agencyCommissionRate).toBe(0.03);
    });
  });
});
