/**
 * YieldService — Moteur de Yield Management.
 *
 * Algorithme calculateSuggestedPrice(tripId, tenantId)
 * ─────────────────────────────────────────────────────
 *
 *  1. Vérifie que le module YIELD_ENGINE est actif pour ce tenant.
 *  2. Charge le trajet + PricingRules + TripAnalytics historiques.
 *  3. Applique les règles dans cet ordre (première qui matche gagne) :
 *
 *     Règle A — "Jour d'Or" (historiquement fort)
 *       Si isGoldenDay = true sur ce jour-de-semaine / route :
 *       → prix × (1 + goldenDayMultiplier)   défaut +15 %
 *
 *     Règle B — "Trajet Noir" (structurellement déficitaire)
 *       Si isBlackRoute = true :
 *       → suggère le break-even price du dernier snapshot
 *         (pour au moins couvrir les coûts)
 *
 *     Règle C — Faible remplissage à J-2
 *       Si now >= departureDate - 48h ET fillRate < lowFillThreshold (défaut 0.40) :
 *       → prix × (1 - lowFillDiscount)   défaut -10 %
 *
 *     Règle D — Fort remplissage (dernière minute)
 *       Si fillRate >= highFillThreshold (défaut 0.80) :
 *       → prix × (1 + highFillPremium)   défaut +10 %
 *
 *     Sinon → prix de base inchangé.
 *
 *  4. Le prix suggéré est borné entre [basePrice × 0.70, basePrice × 2.00].
 *  5. Le prix est verrouillé dans Ticket.pricePaid à l'état PENDING_PAYMENT
 *     (implémenté dans le workflow — le YieldService ne modifie jamais les tickets).
 *
 * Tous les paramètres (multipliers, thresholds) sont configurables via
 * InstalledModule.config (YIELD_ENGINE) pour chaque tenant.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

// ─── Config Yield extraite de InstalledModule.config ─────────────────────────

interface YieldConfig {
  enabled:             boolean;
  goldenDayMultiplier: number; // défaut 0.15 → +15 %
  lowFillThreshold:    number; // défaut 0.40
  lowFillDiscount:     number; // défaut 0.10 → -10 %
  highFillThreshold:   number; // défaut 0.80
  highFillPremium:     number; // défaut 0.10 → +10 %
  priceFloorRate:      number; // défaut 0.70 → 70 % du basePrice
  priceCeilingRate:    number; // défaut 2.00 → 200 % du basePrice
}

const DEFAULT_YIELD_CONFIG: YieldConfig = {
  enabled:             true,
  goldenDayMultiplier: 0.15,
  lowFillThreshold:    0.40,
  lowFillDiscount:     0.10,
  highFillThreshold:   0.80,
  highFillPremium:     0.10,
  priceFloorRate:      0.70,
  priceCeilingRate:    2.00,
};

// ─── Résultat retourné ────────────────────────────────────────────────────────

export interface YieldSuggestion {
  basePrice:      number;
  suggestedPrice: number;
  delta:          number;   // suggestedPrice - basePrice
  deltaPercent:   number;   // delta / basePrice * 100
  rule:           'GOLDEN_DAY' | 'BLACK_ROUTE' | 'LOW_FILL' | 'HIGH_FILL' | 'NO_CHANGE';
  reason:         string;
  fillRate:       number;
  isGoldenDay:    boolean;
  isBlackRoute:   boolean;
  yieldActive:    boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HOURS_BEFORE_DEPARTURE = 48;

function hoursUntil(date: Date): number {
  return (date.getTime() - Date.now()) / 3_600_000;
}

function clamp(price: number, floor: number, ceiling: number): number {
  return Math.max(floor, Math.min(ceiling, price));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class YieldService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Point d'entrée principal : calcule le prix suggéré pour un trajet.
   * Ne modifie aucune donnée — retourne seulement la suggestion.
   */
  async calculateSuggestedPrice(
    tenantId: string,
    tripId:   string,
  ): Promise<YieldSuggestion> {
    // 1. Vérifier que le module YIELD_ENGINE est actif
    const yieldModule = await this.prisma.installedModule.findFirst({
      where: { tenantId, moduleKey: 'YIELD_ENGINE', isActive: true },
    });

    const cfg: YieldConfig = yieldModule
      ? { ...DEFAULT_YIELD_CONFIG, ...(yieldModule.config as Partial<YieldConfig>) }
      : DEFAULT_YIELD_CONFIG;

    if (!cfg.enabled || !yieldModule) {
      return this.noChange(0, 0, false, false);
    }

    // 2. Charger le trajet
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: {
        route: { include: { trips: false } },
        bus:   { select: { capacity: true } },
      },
    });
    if (!trip) return this.noChange(0, 0, false, false);

    const basePrice = trip.route.basePrice;

    // 3. Taux de remplissage actuel
    const bookedSeats = await this.prisma.ticket.count({
      where: {
        tenantId, tripId,
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED', 'PENDING_PAYMENT'] },
      },
    });
    const fillRate = trip.bus.capacity > 0 ? bookedSeats / trip.bus.capacity : 0;

    // 4. Analytics historiques pour ce jour-de-semaine + route
    const tripDayOfWeek = trip.departureScheduled.getDay(); // 0=Dim JS → normaliser
    const dayOfWeek     = tripDayOfWeek === 0 ? 6 : tripDayOfWeek - 1; // 0=Lun

    const analytics = await this.prisma.tripAnalytics.findFirst({
      where: { tenantId, routeId: trip.routeId, dayOfWeek },
      orderBy: { tripDate: 'desc' },
    });

    const isGoldenDay  = analytics?.isGoldenDay  ?? false;
    const isBlackRoute = analytics?.isBlackRoute ?? false;

    const floor   = basePrice * cfg.priceFloorRate;
    const ceiling = basePrice * cfg.priceCeilingRate;

    // 5. Appliquer les règles

    // Règle A — Jour d'Or
    if (isGoldenDay) {
      const suggested = clamp(round2(basePrice * (1 + cfg.goldenDayMultiplier)), floor, ceiling);
      return {
        basePrice, suggestedPrice: suggested,
        delta:        round2(suggested - basePrice),
        deltaPercent: round2((suggested - basePrice) / basePrice * 100),
        rule:         'GOLDEN_DAY',
        reason:       `Jour d'or historique sur cette ligne (${dayOfWeek === 0 ? 'Lun' : dayOfWeek === 1 ? 'Mar' : dayOfWeek === 2 ? 'Mer' : dayOfWeek === 3 ? 'Jeu' : dayOfWeek === 4 ? 'Ven' : dayOfWeek === 5 ? 'Sam' : 'Dim'}) — +${cfg.goldenDayMultiplier * 100}%`,
        fillRate, isGoldenDay, isBlackRoute, yieldActive: true,
      };
    }

    // Règle B — Trajet Noir : on remonte au moins au break-even
    if (isBlackRoute) {
      const lastSnapshot = await this.prisma.tripCostSnapshot.findFirst({
        where: {
          tenantId,
          // on cherche les snapshots pour cette route
        },
        orderBy: { computedAt: 'desc' },
      });

      if (lastSnapshot && lastSnapshot.breakEvenSeats > 0 && lastSnapshot.bookedSeats > 0) {
        const breakEvenPrice = round2(lastSnapshot.totalCost / lastSnapshot.bookedSeats);
        const suggested      = clamp(breakEvenPrice, floor, ceiling);
        return {
          basePrice, suggestedPrice: suggested,
          delta:        round2(suggested - basePrice),
          deltaPercent: round2((suggested - basePrice) / basePrice * 100),
          rule:         'BLACK_ROUTE',
          reason:       `Trajet structurellement déficitaire — prix ajusté au seuil de rentabilité estimé`,
          fillRate, isGoldenDay, isBlackRoute, yieldActive: true,
        };
      }
    }

    // Règle C — Faible remplissage à J-2
    const hoursLeft = hoursUntil(trip.departureScheduled);
    if (hoursLeft <= HOURS_BEFORE_DEPARTURE && fillRate < cfg.lowFillThreshold) {
      const suggested = clamp(round2(basePrice * (1 - cfg.lowFillDiscount)), floor, ceiling);
      return {
        basePrice, suggestedPrice: suggested,
        delta:        round2(suggested - basePrice),
        deltaPercent: round2((suggested - basePrice) / basePrice * 100),
        rule:         'LOW_FILL',
        reason:       `Taux de remplissage faible (${Math.round(fillRate * 100)}%) à J-2 — remise -${cfg.lowFillDiscount * 100}%`,
        fillRate, isGoldenDay, isBlackRoute, yieldActive: true,
      };
    }

    // Règle D — Fort remplissage
    if (fillRate >= cfg.highFillThreshold) {
      const suggested = clamp(round2(basePrice * (1 + cfg.highFillPremium)), floor, ceiling);
      return {
        basePrice, suggestedPrice: suggested,
        delta:        round2(suggested - basePrice),
        deltaPercent: round2((suggested - basePrice) / basePrice * 100),
        rule:         'HIGH_FILL',
        reason:       `Fort remplissage (${Math.round(fillRate * 100)}%) — majoration +${cfg.highFillPremium * 100}%`,
        fillRate, isGoldenDay, isBlackRoute, yieldActive: true,
      };
    }

    return this.noChange(basePrice, fillRate, isGoldenDay, isBlackRoute);
  }

  /**
   * Agrège les snapshots existants pour recalculer les flags isGoldenDay
   * et isBlackRoute d'un TripAnalytics. Appelé par le scheduler quotidien.
   *
   * Fenêtre d'analyse : 90 jours.
   * - isGoldenDay  : fillRate moyen > 0.85 sur ce jour-de-semaine
   * - isBlackRoute : > 50 % des trajets sont DEFICIT sur les 90 derniers jours
   */
  async refreshAnalyticsForRoute(
    tenantId: string,
    routeId:  string,
    busId:    string,
  ): Promise<void> {
    const since = new Date(Date.now() - 90 * 24 * 3_600_000);

    // Snapshots des 90 derniers jours pour cette route/bus
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId, routeId, busId,
        status:             'COMPLETED',
        departureScheduled: { gte: since },
      },
      include: { costSnapshot: true },
    });

    if (trips.length === 0) return;

    // Grouper par jour-de-semaine
    const byDow = new Map<number, typeof trips>();
    for (const trip of trips) {
      const raw = trip.departureScheduled.getDay();
      const dow = raw === 0 ? 6 : raw - 1;
      if (!byDow.has(dow)) byDow.set(dow, []);
      byDow.get(dow)!.push(trip);
    }

    for (const [dow, dowTrips] of byDow) {
      const withSnapshot  = dowTrips.filter(t => t.costSnapshot);
      const avgFillRate   = withSnapshot.length > 0
        ? withSnapshot.reduce((s, t) => s + (t.costSnapshot!.fillRate), 0) / withSnapshot.length
        : 0;
      const avgNetMargin  = withSnapshot.length > 0
        ? withSnapshot.reduce((s, t) => s + (t.costSnapshot!.netMargin), 0) / withSnapshot.length
        : 0;
      const avgTicketRev  = withSnapshot.length > 0
        ? withSnapshot.reduce((s, t) => s + (t.costSnapshot!.ticketRevenue), 0) / withSnapshot.length
        : 0;
      const avgParcelRev  = withSnapshot.length > 0
        ? withSnapshot.reduce((s, t) => s + (t.costSnapshot!.parcelRevenue), 0) / withSnapshot.length
        : 0;
      const profitCount   = withSnapshot.filter(t => t.costSnapshot!.profitabilityTag === 'PROFITABLE').length;
      const deficitCount  = withSnapshot.filter(t => t.costSnapshot!.profitabilityTag === 'DEFICIT').length;

      const isGoldenDay  = avgFillRate >= 0.85;
      const isBlackRoute = withSnapshot.length > 0
        && (deficitCount / withSnapshot.length) > 0.50;

      const tripDate = new Date(dowTrips[0].departureScheduled);
      tripDate.setUTCHours(0, 0, 0, 0);

      await this.prisma.tripAnalytics.upsert({
        where:  { tenantId_routeId_busId_tripDate: { tenantId, routeId, busId, tripDate } },
        create: {
          tenantId, routeId, busId, tripDate,
          dayOfWeek: dow,
          avgFillRate, avgNetMargin, avgTicketRevenue: avgTicketRev, avgParcelRevenue: avgParcelRev,
          tripCount:       dowTrips.length,
          profitableCount: profitCount,
          deficitCount,
          isGoldenDay,
          isBlackRoute,
        },
        update: {
          avgFillRate, avgNetMargin, avgTicketRevenue: avgTicketRev, avgParcelRevenue: avgParcelRev,
          tripCount:       dowTrips.length,
          profitableCount: profitCount,
          deficitCount,
          isGoldenDay,
          isBlackRoute,
        },
      });
    }
  }

  // ─── Helpers privés ─────────────────────────────────────────────────────────

  private noChange(
    basePrice:  number,
    fillRate:   number,
    isGoldenDay: boolean,
    isBlackRoute: boolean,
  ): YieldSuggestion {
    return {
      basePrice, suggestedPrice: basePrice,
      delta: 0, deltaPercent: 0,
      rule: 'NO_CHANGE',
      reason: !basePrice ? 'Module YIELD_ENGINE inactif' : 'Aucune règle déclenchée — prix de base appliqué',
      fillRate, isGoldenDay, isBlackRoute, yieldActive: !!basePrice,
    };
  }
}
