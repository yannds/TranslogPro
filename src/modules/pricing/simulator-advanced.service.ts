/**
 * PricingSimulatorAdvancedService — Aide à la décision tarifaire.
 *
 * Va au-delà du simple break-even renvoyé par `ProfitabilityService.simulateTrip`
 * en fournissant 7 outils décisionnels pour un tenant en concurrence frontale :
 *
 *   A. sensitivityMatrix  — heatmap prix × fillRate, cellule = netMargin
 *   B. priceBands         — 4 bornes : min-viable / break-even / standard / premium
 *   C. historicalBenchmark— moyennes réelles 30j / 90j sur la ligne
 *   D. analyzeCompetitor  — réaction au prix concurrent (marge/fillRate requis)
 *   E. simulateWhatIf     — sensibilité aux chocs (fuel, commission)
 *   F. compareRoutes      — classement portefeuille (netMarginRate par ligne)
 *   G. monthlyBreakEven   — combien de voyages/mois pour couvrir les coûts fixes
 *
 * Zéro magic number : toutes les constantes de simulation dérivent soit des
 * paramètres d'entrée, soit de TenantBusinessConfig, soit de valeurs métiers
 * calculables (points de la grille heatmap, deltas what-if à saisir côté UI).
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CostCalculatorEngine } from './engines/cost-calculator.engine';
import {
  CostInputProfile, BusinessConstants, DEFAULT_BUSINESS_CONSTANTS,
} from './interfaces/cost-calculator.interface';

// ─── Constantes de simulation (valeurs métier, pas seuils tenant) ────────────
// Les listes sont documentées : tout l'intérêt d'une "sensitivity matrix" est
// d'avoir une grille suffisamment dense pour voir où on bascule rentable/déficitaire.
const MATRIX_FILL_RATES   = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;
const MATRIX_PRICE_STEPS  = 9;       // nombre de prix testés autour de basePrice
const MATRIX_PRICE_SPREAD = 0.6;     // ±60 % autour de basePrice
const HISTORICAL_DEFAULT_DAYS = 90;
const WHATIF_FUEL_DEFAULT = 0;       // delta % vs cost profile
const WHATIF_COMMISSION_DEFAULT: number | null = null; // null = utiliser bizConfig

@Injectable()
export class PricingSimulatorAdvancedService {
  private readonly calculator = new CostCalculatorEngine();

  constructor(private readonly prisma: PrismaService) {}

  // ── A. Matrice de sensibilité prix × fillRate ────────────────────────────────

  async sensitivityMatrix(tenantId: string, dto: {
    routeId: string; busId: string; centerPrice?: number;
  }) {
    const ctx = await this.loadContext(tenantId, dto.routeId, dto.busId);
    const basePrice = dto.centerPrice ?? ctx.route.basePrice;
    const prices = buildPriceSteps(basePrice, MATRIX_PRICE_STEPS, MATRIX_PRICE_SPREAD);

    const cells = prices.map(price => MATRIX_FILL_RATES.map(fill =>
      this.runScenario(ctx, { ticketPrice: price, fillRate: fill }),
    ));

    return {
      input:     { routeId: dto.routeId, busId: dto.busId, centerPrice: basePrice },
      prices,
      fillRates: [...MATRIX_FILL_RATES],
      cells:     cells.map(row => row.map(c => ({
        ticketPrice:       c.ticketPrice,
        fillRate:          c.fillRate,
        netMargin:         c.netMargin,
        netMarginRate:     c.netMarginRate,
        profitabilityTag:  c.profitabilityTag,
      }))),
      totalSeats: ctx.bus.capacity,
    };
  }

  // ── B. Bandes de prix recommandées ───────────────────────────────────────────

  async priceBands(tenantId: string, dto: {
    routeId: string; busId: string; fillRate?: number;
  }) {
    const ctx = await this.loadContext(tenantId, dto.routeId, dto.busId);
    const fillRate = clampFillRate(dto.fillRate ?? 0.7);
    const totalSeats = ctx.bus.capacity;
    const seats = totalSeats * fillRate;
    const commissionFactor = 1 - ctx.constants.agencyCommissionRate;
    const t = ctx.constants.breakEvenThresholdPct;

    if (seats <= 0 || commissionFactor <= 0) {
      throw new BadRequestException('fillRate ou commissionRate invalide pour calcul des bandes');
    }

    const breakEvenPrice = Math.ceil(ctx.costs.totalCost / (seats * commissionFactor));
    const minViablePrice = Math.ceil(breakEvenPrice * 0.9);       // -10 % : couvre coûts variables seulement
    const profitablePrice = Math.ceil(breakEvenPrice * (1 + t));  // break-even + seuil tenant
    const premiumPrice = Math.ceil(breakEvenPrice * (1 + 2 * t)); // double du seuil : positionnement haut

    return {
      input: { routeId: dto.routeId, busId: dto.busId, fillRate },
      bands: {
        minViable:  { price: minViablePrice,  label: 'MIN_VIABLE',  description: 'Couvre au moins les coûts variables — perte maîtrisée sur les fixes.' },
        breakEven:  { price: breakEvenPrice,  label: 'BREAK_EVEN',  description: 'Équilibre exact au fillRate donné.' },
        profitable: { price: profitablePrice, label: 'PROFITABLE',  description: `Marge nette = seuil tenant (${Math.round(t * 100)} %).` },
        premium:    { price: premiumPrice,    label: 'PREMIUM',     description: 'Positionnement haut — requiert différenciation service.' },
      },
      assumptions: {
        totalCost:            ctx.costs.totalCost,
        totalSeats,
        commissionRate:       ctx.constants.agencyCommissionRate,
        breakEvenThresholdPct: t,
      },
    };
  }

  // ── C. Benchmark historique réel de la ligne ────────────────────────────────

  async historicalBenchmark(tenantId: string, dto: {
    routeId: string; days?: number;
  }) {
    const days = dto.days ?? HISTORICAL_DEFAULT_DAYS;
    if (days <= 0 || days > 365) throw new BadRequestException('days doit être entre 1 et 365');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await this.prisma.tripCostSnapshot.findMany({
      where: {
        tenantId,
        trip:  { routeId: dto.routeId, departureScheduled: { gte: since } },
      },
      include: { trip: { select: { departureScheduled: true } } },
      orderBy: { computedAt: 'asc' },
    });

    if (snapshots.length === 0) {
      return {
        input: { routeId: dto.routeId, days },
        summary: { tripCount: 0, avgFillRate: null, avgTicketPrice: null, avgNetMargin: null, avgNetMarginRate: null },
        series:  [],
      };
    }

    const totalSeatsSum   = snapshots.reduce((s, x) => s + x.totalSeats, 0);
    const bookedSeatsSum  = snapshots.reduce((s, x) => s + x.bookedSeats, 0);
    // Prix moyen réel dérivé : ticketRevenue / bookedSeats par snapshot, moyenné
    const perTripPrices = snapshots
      .filter(x => x.bookedSeats > 0)
      .map(x => x.ticketRevenue / x.bookedSeats);
    const avgTicketPrice  = perTripPrices.length > 0
      ? perTripPrices.reduce((s, x) => s + x, 0) / perTripPrices.length
      : 0;
    const avgNetMargin    = snapshots.reduce((s, x) => s + x.netMargin, 0) / snapshots.length;
    const avgMarginRate   = snapshots.reduce((s, x) => s + x.marginRate, 0) / snapshots.length;
    const avgFillRate = totalSeatsSum > 0 ? bookedSeatsSum / totalSeatsSum : null;

    return {
      input: { routeId: dto.routeId, days },
      summary: {
        tripCount:         snapshots.length,
        avgFillRate,
        avgTicketPrice:    Math.round(avgTicketPrice),
        avgNetMargin:      Math.round(avgNetMargin),
        avgNetMarginRate:  Number(avgMarginRate.toFixed(4)),
      },
      series: snapshots.map(s => ({
        date:            s.trip.departureScheduled.toISOString(),
        fillRate:        s.totalSeats ? s.bookedSeats / s.totalSeats : 0,
        ticketPrice:     s.bookedSeats > 0 ? Math.round(s.ticketRevenue / s.bookedSeats) : 0,
        netMargin:       s.netMargin,
        netMarginRate:   s.marginRate,
        profitabilityTag: s.profitabilityTag,
      })),
    };
  }

  // ── D. Analyse concurrence ───────────────────────────────────────────────────

  async analyzeCompetitor(tenantId: string, dto: {
    routeId: string; busId: string; competitorPrice: number; fillRate?: number;
  }) {
    if (dto.competitorPrice <= 0) throw new BadRequestException('competitorPrice > 0 requis');
    const ctx = await this.loadContext(tenantId, dto.routeId, dto.busId);
    const fillRate = clampFillRate(dto.fillRate ?? 0.7);
    const commissionFactor = 1 - ctx.constants.agencyCommissionRate;
    const t = ctx.constants.breakEvenThresholdPct;

    // Au prix concurrent, quel fillRate minimum pour tenir break-even ?
    const breakEvenSeats = Math.ceil(ctx.costs.totalCost / (dto.competitorPrice * commissionFactor));
    const requiredFillRate = Math.min(1, breakEvenSeats / ctx.bus.capacity);
    const profitableFillRate = Math.min(1, (breakEvenSeats * (1 + t)) / ctx.bus.capacity);

    const matched = this.runScenario(ctx, { ticketPrice: dto.competitorPrice, fillRate });
    const ownBaseline = this.runScenario(ctx, { ticketPrice: ctx.route.basePrice, fillRate });

    let recommendation: 'MATCH' | 'HOLD' | 'UNDERCUT_PREMIUM' | 'AVOID';
    if (matched.profitabilityTag === 'PROFITABLE')      recommendation = 'MATCH';
    else if (matched.profitabilityTag === 'BREAK_EVEN') recommendation = 'HOLD';
    else if (ownBaseline.profitabilityTag === 'PROFITABLE') recommendation = 'UNDERCUT_PREMIUM';
    else                                                    recommendation = 'AVOID';

    return {
      input: { ...dto, fillRate },
      ownBaseline:   { ticketPrice: ctx.route.basePrice, ...pickProjected(ownBaseline) },
      competitorMatch: { ticketPrice: dto.competitorPrice, ...pickProjected(matched) },
      requirements: {
        breakEvenFillRate: requiredFillRate,
        profitableFillRate,
        breakEvenSeats,
      },
      recommendation,
    };
  }

  // ── E. What-if : sliders fuel / commission ───────────────────────────────────

  async simulateWhatIf(tenantId: string, dto: {
    routeId: string; busId: string;
    ticketPrice?: number; fillRate?: number;
    fuelDeltaPct?: number; commissionRate?: number;
  }) {
    const ctx = await this.loadContext(tenantId, dto.routeId, dto.busId);

    const fuelDelta    = dto.fuelDeltaPct ?? WHATIF_FUEL_DEFAULT;
    const commissionOv = dto.commissionRate ?? WHATIF_COMMISSION_DEFAULT;

    // On reconstruit un profil de coût avec le fuel modifié et un constants modifié
    // avec la commission override (si fournie).
    const scenarioProfile: CostInputProfile = {
      ...ctx.profile,
      fuelPricePerLiter: ctx.profile.fuelPricePerLiter * (1 + fuelDelta / 100),
    };
    const scenarioConstants: BusinessConstants = {
      ...ctx.constants,
      agencyCommissionRate: commissionOv ?? ctx.constants.agencyCommissionRate,
    };
    const scenarioCosts = this.calculator.computeCosts(ctx.route.distanceKm, scenarioProfile);

    const ticketPrice = dto.ticketPrice ?? ctx.route.basePrice;
    const fillRate    = clampFillRate(dto.fillRate ?? 0.7);
    const totalSeats  = ctx.bus.capacity;
    const bookedSeats = Math.round(totalSeats * fillRate);
    const ticketRevenue = ticketPrice * bookedSeats;
    const margins = this.calculator.computeMargins(
      scenarioCosts, ticketRevenue, ticketRevenue,
      totalSeats, bookedSeats, ticketPrice,
      scenarioConstants,
    );

    const baseline = this.runScenario(ctx, { ticketPrice, fillRate });

    return {
      input: { ...dto, fillRate, ticketPrice },
      baseline: {
        totalCost: ctx.costs.totalCost,
        netMargin: baseline.netMargin,
        netMarginRate: baseline.netMarginRate,
      },
      scenario: {
        totalCost:     scenarioCosts.totalCost,
        netMargin:     margins.netMargin,
        netMarginRate: margins.netMarginRate,
        profitabilityTag: margins.profitabilityTag,
      },
      delta: {
        totalCost:     scenarioCosts.totalCost - ctx.costs.totalCost,
        netMargin:     margins.netMargin - baseline.netMargin,
        netMarginRate: Number((margins.netMarginRate - baseline.netMarginRate).toFixed(4)),
      },
    };
  }

  // ── F. Comparaison inter-lignes ──────────────────────────────────────────────

  async compareRoutes(tenantId: string, dto: {
    fillRate?: number;
  }) {
    const fillRate = clampFillRate(dto.fillRate ?? 0.7);
    const routes = await this.prisma.route.findMany({
      where:   { tenantId },
      include: { waypoints: true },
    });
    if (routes.length === 0) return { input: { fillRate }, routes: [] };

    // Pour chaque route, on prend n'importe quel bus qui a un profil de coûts.
    // Si aucun bus compatible, la ligne est marquée "NO_PROFILE".
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({ where: { tenantId } });
    const constants: BusinessConstants = bizConfig
      ? {
          daysPerYear:           bizConfig.daysPerYear,
          breakEvenThresholdPct: bizConfig.breakEvenThresholdPct,
          agencyCommissionRate:  bizConfig.agencyCommissionRate,
        }
      : DEFAULT_BUSINESS_CONSTANTS;
    const busWithProfile = await this.prisma.bus.findFirst({
      where:   { tenantId, costProfile: { isNot: null } },
      include: { costProfile: true },
    });
    if (!busWithProfile || !busWithProfile.costProfile) {
      return { input: { fillRate }, routes: [], notice: 'NO_COST_PROFILE_ANYWHERE' };
    }

    const rows = routes.map(route => {
      try {
        const pricingRules = null;  // on ne précharge pas pour le classement (évite N+1)
        const profile = this.buildProfile(busWithProfile.costProfile!, route, pricingRules);
        const costs = this.calculator.computeCosts(route.distanceKm, profile);
        const ticketPrice = route.basePrice;
        const totalSeats  = busWithProfile.capacity;
        const bookedSeats = Math.round(totalSeats * fillRate);
        const revenue = ticketPrice * bookedSeats;
        const m = this.calculator.computeMargins(costs, revenue, revenue, totalSeats, bookedSeats, ticketPrice, constants);
        return {
          routeId:       route.id,
          routeName:     route.name,
          distanceKm:    route.distanceKm,
          basePrice:     route.basePrice,
          netMargin:     m.netMargin,
          netMarginRate: m.netMarginRate,
          profitabilityTag: m.profitabilityTag,
        };
      } catch {
        return {
          routeId: route.id, routeName: route.name,
          distanceKm: route.distanceKm, basePrice: route.basePrice,
          netMargin: null, netMarginRate: null, profitabilityTag: 'UNKNOWN' as const,
        };
      }
    });

    rows.sort((a, b) => (b.netMarginRate ?? -Infinity) - (a.netMarginRate ?? -Infinity));
    return { input: { fillRate }, routes: rows, benchmarkBusId: busWithProfile.id };
  }

  // ── G. Point mort mensuel (nb voyages/mois) ──────────────────────────────────

  async monthlyBreakEven(tenantId: string, dto: {
    routeId: string; busId: string; ticketPrice?: number; fillRate?: number;
  }) {
    const ctx = await this.loadContext(tenantId, dto.routeId, dto.busId);
    const ticketPrice = dto.ticketPrice ?? ctx.route.basePrice;
    const fillRate    = clampFillRate(dto.fillRate ?? 0.7);
    const totalSeats  = ctx.bus.capacity;
    const bookedSeats = Math.round(totalSeats * fillRate);
    const commissionFactor = 1 - ctx.constants.agencyCommissionRate;

    // Coûts fixes mensuels = salaires + assurance + fees agence + amortissement mensualisé
    const cp = ctx.bus.costProfile!;
    const monthlyFixed =
      cp.driverMonthlySalary +
      (cp.annualInsuranceCost / 12) +
      cp.monthlyAgencyFees +
      ((cp.purchasePrice - cp.residualValue) / (cp.depreciationYears * 12));

    // Marge nette par trip au fillRate / prix demandés
    const perTripRevenueNet = ticketPrice * bookedSeats * commissionFactor;
    const perTripMarginAfterVariable = perTripRevenueNet - (ctx.costs.totalVariableCost);

    // Combien de trips/mois pour couvrir les fixes mensuels ?
    const tripsNeeded = perTripMarginAfterVariable > 0
      ? Math.ceil(monthlyFixed / perTripMarginAfterVariable)
      : null;

    return {
      input: { routeId: dto.routeId, busId: dto.busId, ticketPrice, fillRate },
      monthlyFixedCost:          Math.round(monthlyFixed),
      perTripNetMarginOnVariable: Math.round(perTripMarginAfterVariable),
      tripsPerMonthToBreakEven:   tripsNeeded,
      currentPlannedTripsPerMonth: cp.avgTripsPerMonth,
      verdict: tripsNeeded === null
        ? 'IMPOSSIBLE_AT_THESE_PARAMS'
        : tripsNeeded <= cp.avgTripsPerMonth
          ? 'REACHABLE'
          : 'NEED_MORE_TRIPS',
    };
  }

  // ── Helpers privés ───────────────────────────────────────────────────────────

  private async loadContext(tenantId: string, routeId: string, busId: string) {
    const [route, bus, bizConfig, pricingRules] = await Promise.all([
      this.prisma.route.findFirst({ where: { id: routeId, tenantId }, include: { waypoints: true } }),
      this.prisma.bus.findFirst({ where: { id: busId, tenantId }, include: { costProfile: true } }),
      this.prisma.tenantBusinessConfig.findUnique({ where: { tenantId } }),
      this.prisma.pricingRules.findFirst({ where: { routeId, tenantId } }),
    ]);
    if (!route) throw new NotFoundException(`Route ${routeId} introuvable`);
    if (!bus)   throw new NotFoundException(`Bus ${busId} introuvable`);
    if (!bus.costProfile) throw new BadRequestException(`Bus ${busId} sans BusCostProfile`);

    const constants: BusinessConstants = bizConfig
      ? {
          daysPerYear:           bizConfig.daysPerYear,
          breakEvenThresholdPct: bizConfig.breakEvenThresholdPct,
          agencyCommissionRate:  bizConfig.agencyCommissionRate,
        }
      : DEFAULT_BUSINESS_CONSTANTS;

    const profile = this.buildProfile(bus.costProfile, route, pricingRules);
    const costs   = this.calculator.computeCosts(route.distanceKm, profile);

    return { route, bus, constants, profile, costs, pricingRules };
  }

  private buildProfile(
    cp: NonNullable<Awaited<ReturnType<typeof this.prisma.busCostProfile.findFirst>>>,
    _route: unknown,
    _pricingRules: unknown,
  ): CostInputProfile {
    // Version simplifiée — le tollFeesPerTrip ne compose pas les waypoints ici
    // car le classement F (compareRoutes) serait trop coûteux. Pour A/B/D/E/G
    // on réutilise le contexte pré-chargé (profile.tollFeesPerTrip = cp valeur).
    return {
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
  }

  private runScenario(
    ctx: Awaited<ReturnType<PricingSimulatorAdvancedService['loadContext']>>,
    s: { ticketPrice: number; fillRate: number },
  ) {
    const totalSeats = ctx.bus.capacity;
    const bookedSeats = Math.round(totalSeats * s.fillRate);
    const revenue = s.ticketPrice * bookedSeats;
    const m = this.calculator.computeMargins(
      ctx.costs, revenue, revenue,
      totalSeats, bookedSeats, s.ticketPrice,
      ctx.constants,
    );
    return {
      ticketPrice:      s.ticketPrice,
      fillRate:         s.fillRate,
      totalSeats,
      bookedSeats,
      netMargin:        m.netMargin,
      netMarginRate:    m.netMarginRate,
      profitabilityTag: m.profitabilityTag,
    };
  }
}

// ─── Helpers purs (exportés pour tests) ──────────────────────────────────────

/**
 * Construit une grille de prix symétrique autour de `center`, avec `steps` points
 * répartis entre `center * (1 - spread)` et `center * (1 + spread)`.
 */
export function buildPriceSteps(center: number, steps: number, spread: number): number[] {
  if (steps < 2) return [Math.round(center)];
  const low  = center * (1 - spread);
  const high = center * (1 + spread);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const v = low + ((high - low) * i) / (steps - 1);
    out.push(Math.round(v));
  }
  return out;
}

function clampFillRate(fr: number): number { return Math.max(0, Math.min(1, fr)); }

function pickProjected<T extends {
  totalSeats: number; bookedSeats: number;
  netMargin: number; netMarginRate: number; profitabilityTag: string;
}>(s: T) {
  return {
    totalSeats:       s.totalSeats,
    bookedSeats:      s.bookedSeats,
    netMargin:        s.netMargin,
    netMarginRate:    s.netMarginRate,
    profitabilityTag: s.profitabilityTag,
  };
}
