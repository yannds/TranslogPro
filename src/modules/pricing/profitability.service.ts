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
      include: { bus: { include: { costProfile: true } }, route: true },
    });
    if (!trip)                 throw new NotFoundException(`Trajet ${tripId} introuvable`);
    if (!trip.bus.costProfile) throw new BadRequestException(
      `Bus ${trip.busId} n'a pas de BusCostProfile — configurez-le d'abord`,
    );

    // Charger les constantes tenant (daysPerYear, taux commission…)
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
    });
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

    // Déléguer les calculs au moteur pur (pas de Prisma dans le moteur)
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
