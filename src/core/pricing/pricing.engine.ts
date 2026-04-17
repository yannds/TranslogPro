import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Structure JSONB de PricingRules.rules — PRD §IV.7
 *
 * Zéro hardcoding : tout est en DB par tenant + route.
 */
interface PricingRulesConfig {
  basePriceXof:        number;
  taxRate:             number;   // ex: 0.18 = 18%
  tollsXof:            number;
  costPerKm:           number;
  luggageFreeKg:       number;   // seuil franchise bagage
  luggagePerExtraKg:   number;   // XOF par kg supplémentaire
  fareMultipliers:     Record<string, number>; // STANDARD=1.0, CONFORT=1.4, VIP=2.0
  yieldSteps?:         YieldStep[];
}

interface YieldStep {
  occupancyThreshold: number;  // % remplissage (ex: 0.7 = 70%)
  priceMultiplier:    number;  // ex: 1.15 = +15%
}

export interface PricingInput {
  tenantId:           string;
  tripId:             string;
  fareClass:          string;
  boardingStationId:  string;   // gare de montée
  alightingStationId: string;   // gare de descente
  luggageKg?:         number;
  discountCode?:      string;
  wantsSeatSelection?: boolean; // true = le passager paie l'option choix de siège
}

export interface PricingResult {
  basePrice:        number;
  taxes:            number;
  tolls:            number;
  luggageFee:       number;
  yieldSurplus:     number;
  seatSelectionFee: number;     // supplément choix de siège (0 si non demandé ou gratuit)
  discount:         number;
  total:            number;
  currency:         string;
  fareClass:        string;
  segmentLabel:     string;     // "Brazzaville → Dolisie"
  isAutoCalculated: boolean;    // true si le prix segment n'était pas configuré manuellement
  segmentCharges:   number;     // total des charges intermédiaires (péages, douane…) du tronçon
  warnings:         string[];   // avertissements pour le caissier si prix auto-calculé
  breakdown:        Record<string, number>;
}

@Injectable()
export class PricingEngine {
  private readonly logger = new Logger(PricingEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: PricingInput): Promise<PricingResult> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where:   { id: input.tripId },
      include: {
        route:     { include: { origin: true, destination: true, waypoints: { orderBy: { order: 'asc' } } } },
        travelers: { where: { status: { in: ['CHECKED_IN', 'BOARDED'] } } },
        bus:       true,
      },
    });

    const route = trip.route;

    // ── 1. Résoudre le prix du segment (boarding → alighting) ────────────
    const segmentResult = await this.resolveSegmentPrice(
      input.tenantId, route.id, input.boardingStationId, input.alightingStationId, route,
    );
    const segmentBase = segmentResult.price;

    // ── 2. Charger les règles tarifaires (taxes, bagages, yield) ─────────
    const pricingRule = await this.prisma.pricingRules.findFirst({
      where: { tenantId: input.tenantId, routeId: route.id },
    });

    if (!pricingRule) {
      throw new BadRequestException(
        `Aucune règle tarifaire active pour la route ${route.id} (tenant ${input.tenantId})`,
      );
    }

    const rules = pricingRule.rules as unknown as PricingRulesConfig;

    // ── 3. Prix de base = prix segment × multiplicateur classe ───────────
    const multiplier = rules.fareMultipliers[input.fareClass] ?? 1.0;
    const basePrice  = segmentBase * multiplier;

    // ── 4. Taxes État ──────────────────────────────────────────────────────
    const taxes = basePrice * rules.taxRate;

    // ── 5. Péages ──────────────────────────────────────────────────────────
    const tolls = rules.tollsXof;

    // ── 6. Surplus bagages ────────────────────────────────────────────────
    const luggageKg  = input.luggageKg ?? 0;
    const extraKg    = Math.max(0, luggageKg - rules.luggageFreeKg);
    const luggageFee = extraKg * rules.luggagePerExtraKg;

    // ── 7. Yield management ──────────────────────────────────────────────
    let yieldSurplus = 0;
    const yieldEnabled = await this.isYieldEnabled(input.tenantId);

    if (yieldEnabled && rules.yieldSteps && trip.bus) {
      const capacity  = trip.bus.capacity;
      const boarded   = trip.travelers.length;
      const occupancy = capacity > 0 ? boarded / capacity : 0;

      for (const step of rules.yieldSteps.sort((a, b) => b.occupancyThreshold - a.occupancyThreshold)) {
        if (occupancy >= step.occupancyThreshold) {
          yieldSurplus = basePrice * (step.priceMultiplier - 1);
          break;
        }
      }
    }

    // ── 8. Supplément choix de siège ────────────────────────────────────────
    let seatSelectionFee = 0;
    if (input.wantsSeatSelection && trip.seatingMode === 'NUMBERED') {
      const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId: input.tenantId },
        select: { seatSelectionFee: true },
      });
      seatSelectionFee = bizConfig?.seatSelectionFee ?? 0;
    }

    // ── 9. Remise ──────────────────────────────────────────────────────────
    const discount = await this.resolveDiscount(input.discountCode, basePrice, input.tenantId);

    // ── 10. Labels des stations ────────────────────────────────────────────
    const [fromStation, toStation] = await Promise.all([
      this.prisma.station.findUnique({ where: { id: input.boardingStationId }, select: { name: true } }),
      this.prisma.station.findUnique({ where: { id: input.alightingStationId }, select: { name: true } }),
    ]);

    // ── 11. Devise du tenant (jamais hardcodée) ───────────────────────────
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: input.tenantId },
      select: { currency: true },
    });

    // ── 12. Total ──────────────────────────────────────────────────────────
    const total = Math.max(0, basePrice + taxes + tolls + luggageFee + yieldSurplus + seatSelectionFee - discount);

    return {
      basePrice,
      taxes,
      tolls,
      luggageFee,
      yieldSurplus,
      seatSelectionFee,
      discount,
      total,
      currency:         tenant.currency,
      fareClass:        input.fareClass,
      segmentLabel:     `${fromStation?.name ?? '?'} → ${toStation?.name ?? '?'}`,
      isAutoCalculated: segmentResult.isAutoCalculated,
      segmentCharges:   segmentResult.segmentCharges,
      warnings:         segmentResult.warnings,
      breakdown: {
        segmentBase,
        segmentCharges: segmentResult.segmentCharges,
        classMultiplier: multiplier,
        base:    basePrice,
        taxes,
        tolls,
        luggage:       luggageFee,
        yield:         yieldSurplus,
        seatSelection: seatSelectionFee,
        discount:      -discount,
      },
    };
  }

  // ── Résolution prix segment ────────────────────────────────────────────────

  private async resolveSegmentPrice(
    tenantId: string,
    routeId:  string,
    fromId:   string,
    toId:     string,
    route:    { basePrice: number; distanceKm: number; allowProportionalFallback: boolean;
                waypoints: { stationId: string; distanceFromOriginKm: number;
                             tollCostXaf?: number; checkpointCosts?: unknown; order?: number }[];
                originId: string; destinationId: string },
  ): Promise<{ price: number; isAutoCalculated: boolean; segmentCharges: number; warnings: string[] }> {
    const warnings: string[] = [];

    // 1. Chercher le prix configuré manuellement
    const segment = await this.prisma.routeSegmentPrice.findUnique({
      where: { routeId_fromStationId_toStationId: { routeId, fromStationId: fromId, toStationId: toId } },
    });

    if (segment && segment.basePriceXaf > 0) {
      const charges = this.sumSegmentCharges(fromId, toId, route);
      return { price: segment.basePriceXaf, isAutoCalculated: false, segmentCharges: charges, warnings };
    }

    // 2. Trajet complet (origin → destination) → utiliser basePrice de la route
    if (fromId === route.originId && toId === route.destinationId) {
      const charges = this.sumSegmentCharges(fromId, toId, route);
      return { price: route.basePrice, isAutoCalculated: false, segmentCharges: charges, warnings };
    }

    // 3. Fallback : calcul proportionnel + charges du tronçon
    const distFrom = this.stationDistance(fromId, route);
    const distTo   = this.stationDistance(toId, route);

    if (distTo <= distFrom || route.distanceKm <= 0) {
      throw new BadRequestException(
        `Segment invalide : la gare de descente doit être après la gare de montée sur l'itinéraire.`,
      );
    }

    const proportionalBase = route.basePrice * ((distTo - distFrom) / route.distanceKm);
    const segmentCharges   = this.sumSegmentCharges(fromId, toId, route);
    const price            = proportionalBase + segmentCharges;

    warnings.push('Ce tarif est calculé automatiquement (proportionnel à la distance + charges du tronçon).');
    warnings.push('Il ne tient pas compte des conditions commerciales locales.');

    // Vérifier si le profil de coûts du bus est renseigné
    const hasCostProfile = await this.prisma.busCostProfile.count({ where: { tenantId } });
    if (hasCostProfile === 0) {
      warnings.push('Aucun profil de coûts véhicule configuré — le prix ne reflète pas les coûts réels d\'exploitation.');
    }

    return { price, isAutoCalculated: true, segmentCharges, warnings };
  }

  /**
   * Somme les charges intermédiaires (péages, douane, etc.) entre deux stations.
   * Inclut les waypoints dont l'ordre est > fromStation et <= toStation.
   */
  private sumSegmentCharges(
    fromId: string,
    toId:   string,
    route:  { originId: string; destinationId: string; distanceKm: number;
              waypoints: { stationId: string; distanceFromOriginKm: number;
                           tollCostXaf?: number; checkpointCosts?: unknown; order?: number }[] },
  ): number {
    const fromDist = this.stationDistance(fromId, route);
    const toDist   = this.stationDistance(toId, route);

    let total = 0;
    for (const wp of route.waypoints) {
      if (wp.distanceFromOriginKm > fromDist && wp.distanceFromOriginKm <= toDist) {
        total += wp.tollCostXaf ?? 0;
        const costs = wp.checkpointCosts as { costXaf?: number }[] | null;
        if (Array.isArray(costs)) {
          for (const c of costs) {
            total += c.costXaf ?? 0;
          }
        }
      }
    }
    return total;
  }

  private stationDistance(
    stationId: string,
    route: { originId: string; destinationId: string; distanceKm: number;
             waypoints: { stationId: string; distanceFromOriginKm: number }[] },
  ): number {
    if (stationId === route.originId) return 0;
    if (stationId === route.destinationId) return route.distanceKm;
    const wp = route.waypoints.find(w => w.stationId === stationId);
    if (!wp) {
      throw new BadRequestException(`Station ${stationId} ne fait pas partie de cet itinéraire.`);
    }
    return wp.distanceFromOriginKm;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async isYieldEnabled(tenantId: string): Promise<boolean> {
    const mod = await this.prisma.installedModule.findFirst({
      where: { tenantId, moduleKey: 'YIELD_ENGINE', isActive: true },
    });
    return mod !== null;
  }

  private async resolveDiscount(
    code:     string | undefined,
    base:     number,
    tenantId: string,
  ): Promise<number> {
    if (!code) return 0;
    this.logger.debug(`Résolution code promo "${code}" pour tenant ${tenantId}`);
    return 0;
  }
}
