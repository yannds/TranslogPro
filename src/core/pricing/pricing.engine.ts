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
  tenantId:     string;
  tripId:       string;
  fareClass:    string;
  luggageKg?:   number;
  discountCode?: string;
}

export interface PricingResult {
  basePrice:   number;
  taxes:       number;
  tolls:       number;
  luggageFee:  number;
  yieldSurplus:number;
  discount:    number;
  total:       number;
  currency:    string;
  fareClass:   string;
  breakdown:   Record<string, number>;
}

@Injectable()
export class PricingEngine {
  private readonly logger = new Logger(PricingEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: PricingInput): Promise<PricingResult> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where:   { id: input.tripId },
      include: {
        route:     true,
        travelers: { where: { status: { in: ['CHECKED_IN', 'BOARDED'] } } },
        bus:       true,
      },
    });

    // ── 1. Charger les règles tarifaires depuis DB (PricingRules JSONB) ───
    const pricingRule = await this.prisma.pricingRules.findFirst({
      where: {
        tenantId: input.tenantId,
        routeId:  trip.routeId,
        isActive: true,
      },
    });

    if (!pricingRule) {
      throw new BadRequestException(
        `Aucune règle tarifaire active pour la route ${trip.routeId} (tenant ${input.tenantId})`,
      );
    }

    const rules = pricingRule.rules as unknown as PricingRulesConfig;

    // ── 2. Prix de base avec multiplicateur de classe ─────────────────────
    const multiplier = rules.fareMultipliers[input.fareClass] ?? 1.0;
    const basePrice  = rules.basePriceXof * multiplier;

    // ── 3. Taxes État ──────────────────────────────────────────────────────
    const taxes = basePrice * rules.taxRate;

    // ── 4. Péages ──────────────────────────────────────────────────────────
    const tolls = rules.tollsXof;

    // ── 5. Surplus bagages ────────────────────────────────────────────────
    const luggageKg  = input.luggageKg ?? 0;
    const extraKg    = Math.max(0, luggageKg - rules.luggageFreeKg);
    const luggageFee = extraKg * rules.luggagePerExtraKg;

    // ── 6. Yield management (si module activé pour ce tenant) ─────────────
    let yieldSurplus = 0;
    const yieldEnabled = await this.isYieldEnabled(input.tenantId);

    if (yieldEnabled && rules.yieldSteps && trip.bus) {
      const capacity    = trip.bus.capacity;
      const boarded     = trip.travelers.length;
      const occupancy   = capacity > 0 ? boarded / capacity : 0;

      // PRD §IV.7 : le yield s'applique par palier croissant
      for (const step of rules.yieldSteps.sort((a, b) => b.occupancyThreshold - a.occupancyThreshold)) {
        if (occupancy >= step.occupancyThreshold) {
          yieldSurplus = basePrice * (step.priceMultiplier - 1);
          break;
        }
      }
    }

    // ── 7. Remise ──────────────────────────────────────────────────────────
    const discount = await this.resolveDiscount(input.discountCode, basePrice, input.tenantId);

    // ── 8. Total ───────────────────────────────────────────────────────────
    const total = Math.max(0, basePrice + taxes + tolls + luggageFee + yieldSurplus - discount);

    return {
      basePrice,
      taxes,
      tolls,
      luggageFee,
      yieldSurplus,
      discount,
      total,
      currency: 'XOF',
      fareClass: input.fareClass,
      breakdown: {
        base:    basePrice,
        taxes,
        tolls,
        luggage: luggageFee,
        yield:   yieldSurplus,
        discount: -discount,
      },
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async isYieldEnabled(tenantId: string): Promise<boolean> {
    const mod = await this.prisma.installedModule.findFirst({
      where: { tenantId, moduleCode: 'YIELD_ENGINE', isActive: true },
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
    // TODO : implémenter la table PromoCode quand le module Pricing est étendu
    return 0;
  }
}
