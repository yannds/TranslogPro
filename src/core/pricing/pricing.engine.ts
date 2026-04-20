import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantFareClassService } from '../../modules/tenant-settings/tenant-fare-class.service';
import {
  computeTaxes,
  TaxContext,
  TaxLine,
  TenantTaxInput,
} from '../billing/tax-calculator.service';

/**
 * Structure JSONB de PricingRules.rules — PRD §IV.7
 *
 * Zéro hardcoding : tout est en DB par tenant + route.
 *
 * Note 2026-04-20 : `taxRate` est conservé pour rétro-compat (lecture en fallback
 * si aucune TenantTax n'est définie pour le tenant) mais le chemin canonique
 * passe désormais par `TenantTax[]` + `TaxCalculatorService`. `fareMultipliers`
 * est également legacy — les classes sont désormais stockées dans `TenantFareClass`
 * et résolues via `TenantFareClassService.getMultiplier`.
 */
interface PricingRulesConfig {
  basePriceXof:        number;
  /** @deprecated Utiliser TenantTax[]. Gardé en fallback pendant la migration. */
  taxRate?:            number;
  tollsXof:            number;
  costPerKm:           number;
  luggageFreeKg:       number;   // seuil franchise bagage
  luggagePerExtraKg:   number;   // XOF par kg supplémentaire
  /** @deprecated Utiliser TenantFareClass. Gardé en fallback. */
  fareMultipliers?:    Record<string, number>;
  yieldSteps?:         YieldStep[];
}

/**
 * Structure attendue de `Route.pricingOverrides` (JSON extensible).
 * Tout est optionnel — null/{} = pas d'override, tenant config s'applique.
 */
interface RoutePricingOverrides {
  taxes?: Record<string, { rate?: number; appliedToPrice?: boolean }>;
  tolls?: { override?: number };
  luggage?: { freeKg?: number; perExtraKg?: number };
  fareClasses?: { allowed?: string[] };
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
  /**
   * Si true, `taxBreakdown` inclut aussi les taxes enabled mais non
   * appliquées au prix (flag `applied=false`) — utilisé par la caisse pour
   * afficher en grisé le montant qu'elles auraient coûté. N'affecte pas le
   * total. Défaut = false (payload minimal pour documents/invoice).
   */
  explainTaxes?:       boolean;
}

export interface PricingResult {
  basePrice:        number;
  /** Somme scalaire des taxes appliquées au prix (compat historique). */
  taxes:            number;
  /** Détail N taxes appliquées — nouveau 2026-04-20, utilisé par facture/reçu.
   *  Vide si pricingEngine retombe en mode legacy (rules.taxRate). */
  taxBreakdown:     TaxLine[];
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

  constructor(
    private readonly prisma:         PrismaService,
    private readonly fareClasses:    TenantFareClassService,
  ) {}

  async calculate(input: PricingInput, context: TaxContext = 'PRICE'): Promise<PricingResult> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where:   { id: input.tripId },
      include: {
        route:     { include: { origin: true, destination: true, waypoints: { orderBy: { order: 'asc' } } } },
        travelers: { where: { status: { in: ['CHECKED_IN', 'BOARDED'] } } },
        bus:       true,
      },
    });

    const route = trip.route;
    const overrides = (route.pricingOverrides as unknown as RoutePricingOverrides) ?? {};

    // ── 1. Résoudre le prix du segment (boarding → alighting) ────────────
    const segmentResult = await this.resolveSegmentPrice(
      input.tenantId, route.id, input.boardingStationId, input.alightingStationId, route,
    );
    const segmentBase = segmentResult.price;

    // ── 2. Charger les règles tarifaires (taxes legacy, bagages, yield) ──
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
    // Résolution canonique via TenantFareClass ; fallback sur rules.fareMultipliers
    // tant que le backfill n'a pas seedé les classes pour tous les tenants.
    let multiplier = await this.fareClasses.getMultiplier(input.tenantId, input.fareClass);
    if (multiplier === 1.0 && rules.fareMultipliers?.[input.fareClass]) {
      // Ni la classe n'existe pas (→ 1.0), ni l'admin ne l'a saisie à 1.0 :
      // on retombe sur le legacy pour ne pas sous-évaluer une vente.
      multiplier = rules.fareMultipliers[input.fareClass];
    }
    const basePrice = segmentBase * multiplier;

    // ── 4. Taxes : canonique via TenantTax + TaxCalculatorService ────────
    // Fallback legacy sur `rules.taxRate` si aucune TenantTax n'est définie
    // (garantit la rétro-compat pour les tenants non-migrés).
    const tenantTaxes = await this.loadTenantTaxes(input.tenantId, overrides);
    let taxes = 0;
    let taxBreakdown: TaxLine[] = [];
    if (tenantTaxes.length > 0) {
      const taxResult = computeTaxes({
        subtotal:         basePrice,
        currency:         'XOF', // overridé plus bas
        entityType:       'TICKET',
        taxes:            tenantTaxes,
        context,
        includeNonApplied: input.explainTaxes === true,
      });
      taxes        = taxResult.taxTotal;
      taxBreakdown = taxResult.taxes;
    } else if (typeof rules.taxRate === 'number') {
      taxes = basePrice * rules.taxRate;
    }

    // ── 5. Péages ──────────────────────────────────────────────────────────
    const tolls = overrides.tolls?.override ?? rules.tollsXof;

    // ── 6. Surplus bagages (override ligne possible) ─────────────────────
    const luggageKg  = input.luggageKg ?? 0;
    const freeKg     = overrides.luggage?.freeKg     ?? rules.luggageFreeKg;
    const perExtraKg = overrides.luggage?.perExtraKg ?? rules.luggagePerExtraKg;
    const extraKg    = Math.max(0, luggageKg - freeKg);
    const luggageFee = extraKg * perExtraKg;

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
      taxBreakdown,
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

  /**
   * Charge les TenantTax applicables à une route en fusionnant les overrides :
   *   - Base : toutes les TenantTax du tenant (enabled filtré côté TaxCalculator).
   *   - Overrides : `Route.pricingOverrides.taxes[code]` peut forcer un `rate`
   *     ou un `appliedToPrice` spécifique pour cette ligne.
   */
  private async loadTenantTaxes(
    tenantId: string,
    overrides: RoutePricingOverrides,
  ): Promise<TenantTaxInput[]> {
    const rows = await this.prisma.tenantTax.findMany({ where: { tenantId } });
    const overrideMap = overrides.taxes ?? {};
    return rows.map(r => {
      const ov = overrideMap[r.code] ?? {};
      return {
        code:                    r.code,
        label:                   r.label,
        labelKey:                r.labelKey,
        rate:                    ov.rate ?? r.rate,
        kind:                    r.kind as 'PERCENT' | 'FIXED',
        base:                    r.base as 'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS',
        appliesTo:               r.appliesTo,
        sortOrder:               r.sortOrder,
        enabled:                 r.enabled,
        appliedToPrice:          ov.appliedToPrice ?? r.appliedToPrice,
        appliedToRecommendation: r.appliedToRecommendation,
        validFrom:               r.validFrom,
        validTo:                 r.validTo,
      };
    });
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
