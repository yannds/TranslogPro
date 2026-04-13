/**
 * ProfitabilityService — Moteur de calcul de rentabilité par trajet.
 *
 * Formules appliquées
 * ───────────────────
 * Coûts variables (directs) :
 *   fuel_cost        = fuelConsumptionPer100Km / 100 * distanceKm * fuelPricePerLiter
 *   toll_fees        = tollFeesPerTrip (forfait, configurable par bus)
 *   driver_allowance = driverAllowancePerTrip
 *
 * Coûts fixes proratisés par trajet :
 *   driver_daily     = driverMonthlySalary / avgTripsPerMonth
 *   insurance_daily  = annualInsuranceCost / 365
 *   agency_daily     = monthlyAgencyFees / avgTripsPerMonth
 *   depreciation     = (purchasePrice - residualValue) / depreciationYears / 365
 *   maintenance      = monthlyMaintenanceAvg / avgTripsPerMonth
 *
 * Indicateurs :
 *   totalCost        = Σ variables + Σ fixes
 *   breakEvenSeats   = ceil(totalCost / avgTicketPrice)
 *   netMargin        = totalRevenue - totalCost
 *   marginRate       = netMargin / max(totalCost, 1)
 *   fillRate         = bookedSeats / totalSeats
 *
 * Tag de rentabilité :
 *   PROFITABLE   → netMargin > totalCost * 0.05   (marge > 5 %)
 *   BREAK_EVEN   → abs(netMargin) <= totalCost * 0.05
 *   DEFICIT      → netMargin < -totalCost * 0.05
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService }           from '../../infrastructure/database/prisma.service';
import { UpsertBusCostProfileDto } from './dto/bus-cost-profile.dto';

// ─── Types internes ─────────────────────────────────────────────────────────

interface CostBreakdown {
  // Coûts variables
  fuelCost:           number;
  tollFees:           number;
  driverAllowance:    number;
  // Coûts fixes
  driverDailyCost:    number;
  insuranceDailyCost: number;
  agencyDailyCost:    number;
  depreciationDaily:  number;
  maintenanceDailyCost: number;
  // Totaux
  totalVariableCost:  number;
  totalFixedCost:     number;
  totalCost:          number;
}

interface TripRevenueContext {
  ticketRevenue: number;
  parcelRevenue: number;
  totalRevenue:  number;
  bookedSeats:   number;
  totalSeats:    number;
}

// ─── Tags ────────────────────────────────────────────────────────────────────

const BREAK_EVEN_THRESHOLD = 0.05; // ±5 % du totalCost

function getProfitabilityTag(netMargin: number, totalCost: number): string {
  if (totalCost <= 0) return 'PROFITABLE';
  const ratio = netMargin / totalCost;
  if (ratio > BREAK_EVEN_THRESHOLD)  return 'PROFITABLE';
  if (ratio < -BREAK_EVEN_THRESHOLD) return 'DEFICIT';
  return 'BREAK_EVEN';
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ProfitabilityService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Gestion des profils de coût ─────────────────────────────────────────────

  async upsertCostProfile(
    tenantId: string,
    busId:    string,
    dto:      UpsertBusCostProfileDto,
  ) {
    // Vérifier que le bus appartient au tenant
    const bus = await this.prisma.bus.findFirst({ where: { id: busId, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${busId} introuvable`);

    const data = {
      tenantId,
      busId,
      fuelConsumptionPer100Km: dto.fuelConsumptionPer100Km,
      fuelPricePerLiter:       dto.fuelPricePerLiter,
      driverAllowancePerTrip:  dto.driverAllowancePerTrip  ?? 0,
      tollFeesPerTrip:         dto.tollFeesPerTrip          ?? 0,
      driverMonthlySalary:     dto.driverMonthlySalary,
      annualInsuranceCost:     dto.annualInsuranceCost,
      monthlyAgencyFees:       dto.monthlyAgencyFees,
      monthlyMaintenanceAvg:   dto.monthlyMaintenanceAvg   ?? 0,
      purchasePrice:           dto.purchasePrice,
      depreciationYears:       dto.depreciationYears        ?? 10,
      residualValue:           dto.residualValue            ?? 0,
      avgTripsPerMonth:        dto.avgTripsPerMonth         ?? 30,
    };

    return this.prisma.busCostProfile.upsert({
      where:  { busId },
      create: data,
      update: { ...data, tenantId: undefined }, // tenantId immuable après création
    });
  }

  async getCostProfile(tenantId: string, busId: string) {
    const profile = await this.prisma.busCostProfile.findFirst({
      where: { busId, tenantId },
    });
    if (!profile) throw new NotFoundException(`Aucun profil de coût pour le bus ${busId}`);
    return profile;
  }

  // ── Calcul de rentabilité ──────────────────────────────────────────────────

  /**
   * Calcule la rentabilité d'un trajet et persiste le snapshot.
   * Appelé automatiquement par le side-effect Trip.COMPLETED.
   * Idempotent : si le snapshot existe déjà, le retourne sans recalculer.
   */
  async computeAndSnapshot(tenantId: string, tripId: string) {
    // Idempotence
    const existing = await this.prisma.tripCostSnapshot.findUnique({ where: { tripId } });
    if (existing) return existing;

    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: { bus: { include: { costProfile: true } }, route: true },
    });
    if (!trip)                throw new NotFoundException(`Trajet ${tripId} introuvable`);
    if (!trip.bus.costProfile) throw new BadRequestException(
      `Aucun profil de coût configuré pour le bus ${trip.busId} — renseignez BusCostProfile d'abord`,
    );

    const costs   = this.computeCosts(trip.route.distanceKm, trip.bus.costProfile as any);
    const revenue = await this.computeRevenue(tenantId, tripId, trip.bus.capacity);

    const avgTicketPrice = revenue.bookedSeats > 0
      ? revenue.ticketRevenue / revenue.bookedSeats
      : trip.route.basePrice;

    const breakEvenSeats = costs.totalCost > 0 && avgTicketPrice > 0
      ? Math.ceil(costs.totalCost / avgTicketPrice)
      : 0;

    const netMargin  = revenue.totalRevenue - costs.totalCost;
    const marginRate = costs.totalCost > 0 ? netMargin / costs.totalCost : 1;
    const fillRate   = revenue.totalSeats > 0 ? revenue.bookedSeats / revenue.totalSeats : 0;

    return this.prisma.tripCostSnapshot.create({
      data: {
        tenantId,
        tripId,
        // Coûts variables
        fuelCost:           costs.fuelCost,
        tollFees:           costs.tollFees,
        driverAllowance:    costs.driverAllowance,
        // Coûts fixes
        driverDailyCost:    costs.driverDailyCost,
        insuranceDailyCost: costs.insuranceDailyCost,
        agencyDailyCost:    costs.agencyDailyCost,
        depreciationDaily:  costs.depreciationDaily,
        maintenanceDailyCost: costs.maintenanceDailyCost,
        // Totaux
        totalVariableCost: costs.totalVariableCost,
        totalFixedCost:    costs.totalFixedCost,
        totalCost:         costs.totalCost,
        // Revenus
        ticketRevenue:     revenue.ticketRevenue,
        parcelRevenue:     revenue.parcelRevenue,
        totalRevenue:      revenue.totalRevenue,
        // KPIs
        bookedSeats:       revenue.bookedSeats,
        totalSeats:        revenue.totalSeats,
        fillRate,
        breakEvenSeats,
        netMargin,
        marginRate,
        profitabilityTag: getProfitabilityTag(netMargin, costs.totalCost),
      },
    });
  }

  /**
   * Vue agrégée pour le dashboard décideur.
   * Retourne la marge nette réelle par ligne et par période.
   */
  async getProfitabilitySummary(
    tenantId: string,
    fromDate: Date,
    toDate:   Date,
  ) {
    const snapshots = await this.prisma.tripCostSnapshot.findMany({
      where: {
        tenantId,
        computedAt: { gte: fromDate, lte: toDate },
      },
    });

    // Agréger par tag
    const byTag = snapshots.reduce((acc, s) => {
      acc[s.profitabilityTag] = (acc[s.profitabilityTag] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalRevenue   = snapshots.reduce((s, r) => s + r.totalRevenue,   0);
    const totalCost      = snapshots.reduce((s, r) => s + r.totalCost,      0);
    const totalNetMargin = snapshots.reduce((s, r) => s + r.netMargin,       0);
    const avgFillRate    = snapshots.length > 0
      ? snapshots.reduce((s, r) => s + r.fillRate, 0) / snapshots.length
      : 0;

    return {
      period:     { from: fromDate, to: toDate },
      tripCount:  snapshots.length,
      totalRevenue,
      totalCost,
      totalNetMargin,
      globalMarginRate: totalCost > 0 ? totalNetMargin / totalCost : 0,
      avgFillRate,
      byTag,
    };
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  private computeCosts(
    distanceKm:  number,
    profile: {
      fuelConsumptionPer100Km: number;
      fuelPricePerLiter:       number;
      tollFeesPerTrip:         number;
      driverAllowancePerTrip:  number;
      driverMonthlySalary:     number;
      annualInsuranceCost:     number;
      monthlyAgencyFees:       number;
      monthlyMaintenanceAvg:   number;
      purchasePrice:           number;
      depreciationYears:       number;
      residualValue:           number;
      avgTripsPerMonth:        number;
    },
  ): CostBreakdown {
    // Coûts variables
    const fuelCost        = (profile.fuelConsumptionPer100Km / 100) * distanceKm * profile.fuelPricePerLiter;
    const tollFees        = profile.tollFeesPerTrip;
    const driverAllowance = profile.driverAllowancePerTrip;

    // Coûts fixes proratisés
    const tripsPerMonth       = Math.max(profile.avgTripsPerMonth, 1);
    const driverDailyCost     = profile.driverMonthlySalary / tripsPerMonth;
    const insuranceDailyCost  = profile.annualInsuranceCost / 365;
    const agencyDailyCost     = profile.monthlyAgencyFees / tripsPerMonth;
    const depreciationDaily   = (profile.purchasePrice - profile.residualValue)
                                / Math.max(profile.depreciationYears, 1)
                                / 365;
    const maintenanceDailyCost = profile.monthlyMaintenanceAvg / tripsPerMonth;

    const totalVariableCost = fuelCost + tollFees + driverAllowance;
    const totalFixedCost    = driverDailyCost + insuranceDailyCost + agencyDailyCost
                            + depreciationDaily + maintenanceDailyCost;

    return {
      fuelCost, tollFees, driverAllowance,
      driverDailyCost, insuranceDailyCost, agencyDailyCost, depreciationDaily, maintenanceDailyCost,
      totalVariableCost,
      totalFixedCost,
      totalCost: totalVariableCost + totalFixedCost,
    };
  }

  private async computeRevenue(
    tenantId: string,
    tripId:   string,
    busCapacity: number,
  ): Promise<TripRevenueContext> {
    const [ticketAgg, parcelAgg, bookedSeats] = await Promise.all([
      // Revenus billets (tickets CONFIRMED, CHECKED_IN, BOARDED, COMPLETED)
      this.prisma.ticket.aggregate({
        where: {
          tenantId, tripId,
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED', 'COMPLETED'] },
        },
        _sum:   { pricePaid: true },
        _count: { id: true },
      }),
      // Revenus colis (shipments liés au trip)
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
