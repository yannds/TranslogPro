/**
 * ProfitabilityService — Orchestration Prisma + CostCalculatorEngine.
 *
 * Rôle de ce service :
 *   - Charger BusCostProfile depuis la DB (Prisma)
 *   - Charger TenantBusinessConfig pour les constantes (daysPerYear, taux…)
 *   - Déléguer les calculs purs à CostCalculatorEngine (ADR-26)
 *   - Persister le TripCostSnapshot (immuable, idempotent)
 *
 * Ce service NE contient aucun magic number. Toutes les constantes
 * proviennent de TenantBusinessConfig (DB) ou de DEFAULT_BUSINESS_CONSTANTS.
 *
 * Dual margin (ADR-27) :
 *   - Marge Opérationnelle = revenu − coûts variables
 *   - Marge Nette          = revenu tenant net − coût total
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { UpsertBusCostProfileDto } from './dto/bus-cost-profile.dto';
import { CostCalculatorEngine } from './engines/cost-calculator.engine';
import {
  CostInputProfile,
  BusinessConstants,
  DEFAULT_BUSINESS_CONSTANTS,
} from './interfaces/cost-calculator.interface';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcule le total des péages pour un trajet en combinant toutes les sources,
 * en respectant la même hiérarchie que PricingEngine :
 *
 *   routeToll      = pricingOverrides.tolls.override ?? pricingRules.tollsXof ?? 0
 *   waypointTolls  = Σ(waypoint.tollCostXaf + waypoint.checkpointCosts[].costXaf)
 *   busToll        = BusCostProfile.tollFeesPerTrip  (vignette/charges véhicule)
 *   totalToll      = routeToll + waypointTolls + busToll
 */
function computeTotalToll(
  busTollFeesPerTrip: number,
  pricingOverrides:   unknown,
  pricingRules:       { rules: unknown } | null,
  waypoints:          Array<{ tollCostXaf?: number | null; checkpointCosts?: unknown }>,
): number {
  // 1. Péage niveau ligne (override > PricingRules > 0)
  const po = (typeof pricingOverrides === 'object' && pricingOverrides !== null)
    ? pricingOverrides as Record<string, unknown>
    : {};
  const poTolls = po['tolls'] as Record<string, unknown> | undefined;
  const overrideValue = (poTolls && typeof poTolls['override'] === 'number')
    ? poTolls['override']
    : undefined;

  let routeToll = overrideValue ?? 0;
  if (overrideValue === undefined && pricingRules) {
    const rules = (typeof pricingRules.rules === 'object' && pricingRules.rules !== null)
      ? pricingRules.rules as Record<string, unknown>
      : {};
    if (typeof rules['tollsXof'] === 'number') routeToll = rules['tollsXof'];
  }

  // 2. Péages par poste de contrôle / barrière (cumulatifs)
  let waypointTolls = 0;
  for (const wp of waypoints) {
    waypointTolls += wp.tollCostXaf ?? 0;
    const cc = Array.isArray(wp.checkpointCosts) ? wp.checkpointCosts : [];
    for (const c of cc) {
      const cx = (c as { costXaf?: number })?.costXaf;
      if (typeof cx === 'number') waypointTolls += cx;
    }
  }

  // 3. Péage fixe lié au véhicule (vignette, taxe axe, etc.)
  return routeToll + waypointTolls + busTollFeesPerTrip;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ProfitabilityService {
  private readonly calculator = new CostCalculatorEngine();

  constructor(private readonly prisma: PrismaService) {}

  // ── Gestion des profils de coût ─────────────────────────────────────────────

  async upsertCostProfile(tenantId: string, busId: string, dto: UpsertBusCostProfileDto) {
    const bus = await this.prisma.bus.findFirst({ where: { id: busId, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${busId} introuvable`);

    const data = {
      tenantId,
      busId,
      fuelConsumptionPer100Km: dto.fuelConsumptionPer100Km,
      fuelPricePerLiter:       dto.fuelPricePerLiter,
      adBlueCostPerLiter:      dto.adBlueCostPerLiter      ?? 0.18,
      adBlueRatioFuel:         dto.adBlueRatioFuel          ?? 0.05,
      maintenanceCostPerKm:    dto.maintenanceCostPerKm     ?? 0.05,
      stationFeePerDeparture:  dto.stationFeePerDeparture   ?? 0,
      driverAllowancePerTrip:  dto.driverAllowancePerTrip   ?? 0,
      tollFeesPerTrip:         dto.tollFeesPerTrip           ?? 0,
      driverMonthlySalary:     dto.driverMonthlySalary,
      annualInsuranceCost:     dto.annualInsuranceCost,
      monthlyAgencyFees:       dto.monthlyAgencyFees,
      purchasePrice:           dto.purchasePrice,
      depreciationYears:       dto.depreciationYears         ?? 10,
      residualValue:           dto.residualValue             ?? 0,
      avgTripsPerMonth:        dto.avgTripsPerMonth          ?? 30,
    };

    return this.prisma.busCostProfile.upsert({
      where:  { busId },
      create: data,
      update: { ...data, tenantId: undefined },
    });
  }

  async getCostProfile(tenantId: string, busId: string) {
    return this.prisma.busCostProfile.findFirst({ where: { busId, tenantId } });
  }

  // ── Calcul de rentabilité ──────────────────────────────────────────────────

  /**
   * Calcule la rentabilité d'un trajet et persiste le snapshot.
   * Idempotent : si le snapshot existe déjà, le retourne sans recalculer.
   * Appelé automatiquement à la transition Trip → COMPLETED (side effect).
   */
  async computeAndSnapshot(tenantId: string, tripId: string) {
    // Idempotence
    const existing = await this.prisma.tripCostSnapshot.findUnique({ where: { tripId } });
    if (existing) return existing;

    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: {
        bus:   { include: { costProfile: true } },
        route: { include: { waypoints: true } },
      },
    });
    if (!trip)                 throw new NotFoundException(`Trajet ${tripId} introuvable`);
    if (!trip.bus.costProfile) throw new BadRequestException(
      `Bus ${trip.busId} n'a pas de BusCostProfile — configurez-le d'abord`,
    );

    // Charger les constantes tenant + PricingRules de la ligne (pour tollsXof)
    const [bizConfig, pricingRules] = await Promise.all([
      this.prisma.tenantBusinessConfig.findUnique({ where: { tenantId } }),
      this.prisma.pricingRules.findFirst({ where: { routeId: trip.routeId, tenantId } }),
    ]);
    const constants: BusinessConstants = bizConfig
      ? {
          daysPerYear:           bizConfig.daysPerYear,
          breakEvenThresholdPct: bizConfig.breakEvenThresholdPct,
          agencyCommissionRate:  bizConfig.agencyCommissionRate,
        }
      : DEFAULT_BUSINESS_CONSTANTS;

    // Construire le profil d'entrée pour le moteur pur
    const cp = trip.bus.costProfile;
    const profile: CostInputProfile = {
      fuelConsumptionPer100Km: cp.fuelConsumptionPer100Km,
      fuelPricePerLiter:       cp.fuelPricePerLiter,
      adBlueCostPerLiter:      cp.adBlueCostPerLiter,
      adBlueRatioFuel:         cp.adBlueRatioFuel,
      maintenanceCostPerKm:    cp.maintenanceCostPerKm,
      stationFeePerDeparture:  cp.stationFeePerDeparture,
      driverAllowancePerTrip:  cp.driverAllowancePerTrip,
      tollFeesPerTrip:         cp.tollFeesPerTrip,
      driverMonthlySalary:     cp.driverMonthlySalary,
      annualInsuranceCost:     cp.annualInsuranceCost,
      monthlyAgencyFees:       cp.monthlyAgencyFees,
      purchasePrice:           cp.purchasePrice,
      depreciationYears:       cp.depreciationYears,
      residualValue:           cp.residualValue,
      avgTripsPerMonth:        cp.avgTripsPerMonth,
    };

    // Fusionner toutes les sources de péages avant de déléguer au moteur pur
    profile.tollFeesPerTrip = computeTotalToll(
      cp.tollFeesPerTrip,
      trip.route.pricingOverrides,
      pricingRules,
      trip.route.waypoints,
    );
    const costs   = this.calculator.computeCosts(trip.route.distanceKm, profile);
    const revenue = await this.computeRevenue(tenantId, tripId, trip.bus.capacity);

    const avgTicketPrice = revenue.bookedSeats > 0
      ? revenue.ticketRevenue / revenue.bookedSeats
      : trip.route.basePrice;

    const margins = this.calculator.computeMargins(
      costs,
      revenue.totalRevenue,
      revenue.ticketRevenue,
      revenue.totalSeats,
      revenue.bookedSeats,
      avgTicketPrice,
      constants,
    );

    return this.prisma.tripCostSnapshot.create({
      data: {
        tenantId,
        tripId,
        // Coûts variables
        fuelCost:             costs.fuelCost,
        adBlueCost:           costs.adBlueCost,
        maintenanceCost:      costs.maintenanceCost,
        stationFee:           costs.stationFee,
        tollFees:             costs.tollFees,
        driverAllowance:      costs.driverAllowance,
        totalVariableCost:    costs.totalVariableCost,
        // Coûts fixes
        driverDailyCost:      costs.driverDailyCost,
        insuranceDailyCost:   costs.insuranceDailyCost,
        agencyDailyCost:      costs.agencyDailyCost,
        depreciationDaily:    costs.depreciationDaily,
        totalFixedCost:       costs.totalFixedCost,
        totalCost:            costs.totalCost,
        // Revenus
        ticketRevenue:        revenue.ticketRevenue,
        parcelRevenue:        revenue.parcelRevenue,
        totalRevenue:         revenue.totalRevenue,
        // Marges
        operationalMargin:    margins.operationalMargin,
        operationalMarginRate: margins.operationalMarginRate,
        agencyCommission:     margins.agencyCommission,
        netTenantRevenue:     margins.netTenantRevenue,
        netMargin:            margins.netMargin,
        marginRate:           margins.netMarginRate,
        // KPIs
        bookedSeats:          revenue.bookedSeats,
        totalSeats:           revenue.totalSeats,
        fillRate:             margins.fillRate,
        breakEvenSeats:       margins.breakEvenSeats,
        profitabilityTag:     margins.profitabilityTag,
      },
    });
  }

  /**
   * Vue agrégée pour le dashboard décideur.
   * Retourne marge opérationnelle et nette par période.
   */
  async getProfitabilitySummary(tenantId: string, fromDate: Date, toDate: Date) {
    const snapshots = await this.prisma.tripCostSnapshot.findMany({
      where: { tenantId, computedAt: { gte: fromDate, lte: toDate } },
    });

    const byTag = snapshots.reduce((acc, s) => {
      acc[s.profitabilityTag] = (acc[s.profitabilityTag] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalRevenue          = snapshots.reduce((s, r) => s + r.totalRevenue,         0);
    const totalCost             = snapshots.reduce((s, r) => s + r.totalCost,             0);
    const totalNetMargin        = snapshots.reduce((s, r) => s + r.netMargin,             0);
    const totalOperationalMargin = snapshots.reduce((s, r) => s + r.operationalMargin,    0);
    const avgFillRate           = snapshots.length > 0
      ? snapshots.reduce((s, r) => s + r.fillRate, 0) / snapshots.length
      : 0;

    return {
      period:                 { from: fromDate, to: toDate },
      tripCount:              snapshots.length,
      totalRevenue,
      totalCost,
      totalNetMargin,
      totalOperationalMargin,
      globalNetMarginRate:    totalCost > 0 ? totalNetMargin / totalCost : 0,
      avgFillRate,
      byTag,
    };
  }

  // ── Simulation pré-trajet (Sprint 11.A) ─────────────────────────────────
  //
  // Permet au gestionnaire qui programme un trajet de voir IMMÉDIATEMENT la
  // rentabilité estimée + les seuils de break-even, AVANT d'avoir vendu un
  // seul billet. Non-bloquant : le résultat est indicatif, l'admin reste
  // souverain sur sa décision de programmation.
  //
  // Deux axes d'aide à la décision renvoyés :
  //   · À fillRate donné → quel prix billet minimum / idéal ?
  //   · À prix billet donné → quel fillRate minimum / idéal ?

  async simulateTrip(tenantId: string, dto: {
    routeId:      string;
    busId:        string;
    ticketPrice?: number;
    fillRate?:    number;
  }) {
    const [route, bus, bizConfig] = await Promise.all([
      this.prisma.route.findFirst({
        where:   { id: dto.routeId, tenantId },
        include: { waypoints: true },
      }),
      this.prisma.bus.findFirst({
        where:   { id: dto.busId, tenantId },
        include: { costProfile: true },
      }),
      this.prisma.tenantBusinessConfig.findUnique({ where: { tenantId } }),
    ]);
    if (!route) throw new NotFoundException(`Route ${dto.routeId} introuvable`);
    if (!bus)   throw new NotFoundException(`Bus ${dto.busId} introuvable`);
    if (!bus.costProfile) {
      throw new BadRequestException(
        `Bus ${dto.busId} n'a pas de profil de coûts — configurez-le avant la simulation (PUT /buses/:id/cost-profile)`,
      );
    }

    const pricingRules = await this.prisma.pricingRules.findFirst({
      where: { routeId: dto.routeId, tenantId },
    });

    const constants: BusinessConstants = bizConfig
      ? {
          daysPerYear:           bizConfig.daysPerYear,
          breakEvenThresholdPct: bizConfig.breakEvenThresholdPct,
          agencyCommissionRate:  bizConfig.agencyCommissionRate,
        }
      : DEFAULT_BUSINESS_CONSTANTS;

    const cp = bus.costProfile;
    const profile: CostInputProfile = {
      fuelConsumptionPer100Km: cp.fuelConsumptionPer100Km,
      fuelPricePerLiter:       cp.fuelPricePerLiter,
      adBlueCostPerLiter:      cp.adBlueCostPerLiter,
      adBlueRatioFuel:         cp.adBlueRatioFuel,
      maintenanceCostPerKm:    cp.maintenanceCostPerKm,
      stationFeePerDeparture:  cp.stationFeePerDeparture,
      driverAllowancePerTrip:  cp.driverAllowancePerTrip,
      tollFeesPerTrip:         cp.tollFeesPerTrip,
      driverMonthlySalary:     cp.driverMonthlySalary,
      annualInsuranceCost:     cp.annualInsuranceCost,
      monthlyAgencyFees:       cp.monthlyAgencyFees,
      purchasePrice:           cp.purchasePrice,
      depreciationYears:       cp.depreciationYears,
      residualValue:           cp.residualValue,
      avgTripsPerMonth:        cp.avgTripsPerMonth,
    };

    profile.tollFeesPerTrip = computeTotalToll(
      cp.tollFeesPerTrip,
      route.pricingOverrides,
      pricingRules,
      route.waypoints,
    );
    const costs = this.calculator.computeCosts(route.distanceKm, profile);

    const ticketPrice = dto.ticketPrice ?? route.basePrice;
    const fillRate   = Math.max(0, Math.min(1, dto.fillRate ?? 0.7));
    const totalSeats = bus.capacity;
    const bookedSeats = Math.round(totalSeats * fillRate);
    const ticketRevenue = ticketPrice * bookedSeats;
    const totalRevenue  = ticketRevenue; // Parcel ignoré en simulation

    const margins = this.calculator.computeMargins(
      costs, totalRevenue, ticketRevenue,
      totalSeats, bookedSeats, ticketPrice,
      constants,
    );

    // ─── Recommandations break-even & profitable ──────────────────────────
    //
    // Modèle simplifié (pas de parcel) :
    //   netTenantRevenue = ticketPrice × fillRate × totalSeats × (1 − commissionRate)
    //   netMargin        = netTenantRevenue − totalCost
    //
    // breakEven (netMargin = 0) :
    //   breakEvenPrice(fillRate)     = totalCost / (fillRate × totalSeats × (1 − commissionRate))
    //   breakEvenFillRate(price)     = totalCost / (price × totalSeats × (1 − commissionRate))
    //
    // Profitable (netMargin / totalCost > threshold) :
    //   profitablePrice(fillRate)    = (1 + t) × breakEvenPrice
    //   profitableFillRate(price)    = (1 + t) × breakEvenFillRate
    const commissionFactor = 1 - constants.agencyCommissionRate;
    const t = constants.breakEvenThresholdPct;

    const seatsAtFillRate = totalSeats * fillRate;
    const breakEvenPriceAtFillRate = (seatsAtFillRate > 0 && commissionFactor > 0)
      ? Math.ceil(costs.totalCost / (seatsAtFillRate * commissionFactor))
      : null;
    const profitablePriceAtFillRate = breakEvenPriceAtFillRate != null
      ? Math.ceil(breakEvenPriceAtFillRate * (1 + t))
      : null;

    // fillRate basé sur le nombre ENTIER de sièges (Math.ceil) : un fillRate
    // fractionnaire produit bookedSeats = Math.round(…) et potentiellement
    // un netMargin < 0 si on arrondit à l'inférieur. On garantit donc que le
    // fillRate suggéré couvre effectivement le break-even.
    const breakEvenSeatsAtPrice = (ticketPrice > 0 && commissionFactor > 0)
      ? Math.ceil(costs.totalCost / (ticketPrice * commissionFactor))
      : null;
    const breakEvenFillRateAtPrice = (breakEvenSeatsAtPrice != null && totalSeats > 0)
      ? Math.min(1, breakEvenSeatsAtPrice / totalSeats)
      : null;
    const profitableSeatsAtPrice = (breakEvenSeatsAtPrice != null)
      ? Math.min(totalSeats, Math.ceil(breakEvenSeatsAtPrice * (1 + t)))
      : null;
    const profitableFillRateAtPrice = (profitableSeatsAtPrice != null && totalSeats > 0)
      ? Math.min(1, profitableSeatsAtPrice / totalSeats)
      : null;

    // Message de synthèse pour le gestionnaire — lisible, factuel, pas de jugement
    let primaryMessage: string;
    if (margins.profitabilityTag === 'PROFITABLE') {
      primaryMessage = `À ${Math.round(fillRate * 100)}% de remplissage et ${ticketPrice} au billet, la ligne est RENTABLE (marge nette ${Math.round(margins.netMarginRate * 100)}%).`;
    } else if (margins.profitabilityTag === 'BREAK_EVEN') {
      primaryMessage = `À ces hypothèses, vous êtes à l'équilibre (±${Math.round(t * 100)}%).`;
    } else {
      primaryMessage = breakEvenFillRateAtPrice != null
        ? `DÉFICIT estimé. Pour break-even à ${ticketPrice}/billet, il faut ${Math.round((breakEvenFillRateAtPrice ?? 0) * 100)}% de remplissage minimum, ou remonter le prix à ${breakEvenPriceAtFillRate}.`
        : `DÉFICIT estimé — vérifiez le profil de coûts du bus.`;
    }

    return {
      input: { routeId: dto.routeId, busId: dto.busId, ticketPrice, fillRate },
      costs: {
        totalVariableCost: costs.totalVariableCost,
        totalFixedCost:    costs.totalFixedCost,
        totalCost:         costs.totalCost,
      },
      projected: {
        totalSeats, bookedSeats, ticketPrice, fillRate,
        ticketRevenue, parcelRevenue: 0, totalRevenue,
        operationalMargin:     margins.operationalMargin,
        operationalMarginRate: margins.operationalMarginRate,
        agencyCommission:      margins.agencyCommission,
        netTenantRevenue:      margins.netTenantRevenue,
        netMargin:             margins.netMargin,
        netMarginRate:         margins.netMarginRate,
        breakEvenSeats:        margins.breakEvenSeats,
        profitabilityTag:      margins.profitabilityTag,
      },
      recommendations: {
        breakEvenPriceAtFillRate,
        profitablePriceAtFillRate,
        breakEvenFillRateAtPrice,
        profitableFillRateAtPrice,
        breakEvenSeatsAtPrice,
        profitabilityThresholdPct: t,
        primaryMessage,
      },
      thresholds: {
        breakEvenThresholdPct: t,
        agencyCommissionRate:  constants.agencyCommissionRate,
      },
    };
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  private async computeRevenue(tenantId: string, tripId: string, busCapacity: number) {
    const [ticketAgg, parcelAgg, bookedSeats] = await Promise.all([
      this.prisma.ticket.aggregate({
        where: {
          tenantId, tripId,
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED', 'COMPLETED'] },
        },
        _sum:   { pricePaid: true },
        _count: { id: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          tenantId,
          type:     'PARCEL',
          metadata: { path: ['tripId'], equals: tripId },
        },
        _sum: { amount: true },
      }),
      this.prisma.ticket.count({
        where: {
          tenantId, tripId,
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED', 'COMPLETED'] },
        },
      }),
    ]);

    const ticketRevenue = ticketAgg._sum.pricePaid ?? 0;
    const parcelRevenue = parcelAgg._sum.amount    ?? 0;

    return {
      ticketRevenue,
      parcelRevenue,
      totalRevenue: ticketRevenue + parcelRevenue,
      bookedSeats,
      totalSeats:   busCapacity,
    };
  }
}
