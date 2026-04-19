import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PenaltyActor } from '../../common/constants/workflow-states';

/** Un palier de pénalité : si l'annulation survient ≥ hoursBeforeDeparture avant le départ, penaltyPct s'applique. */
export interface CancellationPenaltyTier {
  hoursBeforeDeparture: number;
  penaltyPct:           number; // fraction [0, 1]
}

export interface RefundCalculation {
  originalAmount: number;
  refundPercent:  number;    // Fraction effectivement remboursée (1 - penalty)
  penaltyPct:     number;    // Pénalité appliquée (0 = full refund)
  penaltyAmount:  number;    // Montant pénalité en valeur absolue
  refundAmount:   number;    // Montant net remboursé
  departureAt:    Date;
  currency:       string;
  source:         'tiers_json' | 'trip_override' | 'legacy_2tier';
  appliedToActor: string;    // Rôle qui supporte la pénalité (pour audit)
}

/**
 * Validation runtime de la structure des paliers JSON.
 * Retourne un array trié par hoursBeforeDeparture DÉCROISSANT (plus grand délai en premier).
 */
function normalizeTiers(raw: unknown): CancellationPenaltyTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: CancellationPenaltyTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const h   = obj.hoursBeforeDeparture ?? obj.hoursBefore ?? obj.h;
    const p   = obj.penaltyPct ?? obj.pct ?? obj.p;
    if (typeof h === 'number' && typeof p === 'number' && h >= 0 && p >= 0 && p <= 1) {
      tiers.push({ hoursBeforeDeparture: h, penaltyPct: p });
    }
  }
  return tiers.sort((a, b) => b.hoursBeforeDeparture - a.hoursBeforeDeparture);
}

/**
 * Calcule la pénalité en parcourant les paliers triés décroissants.
 * Retourne la penaltyPct du PREMIER palier dont `hoursBefore` est ≤ hoursBefore courant.
 * Exemple tiers [{h:48,p:0},{h:24,p:0.1},{h:2,p:0.3},{h:0,p:0.5}] :
 *   hoursBefore=50 → 0%   (palier 48 match, h=48 ≤ 50)
 *   hoursBefore=30 → 10%  (palier 24 match)
 *   hoursBefore=10 → 30%  (palier 2 match)
 *   hoursBefore=0  → 50%  (palier 0 match)
 */
function selectPenaltyFromTiers(
  tiers:        CancellationPenaltyTier[],
  hoursBefore:  number,
): number {
  for (const tier of tiers) {
    if (hoursBefore >= tier.hoursBeforeDeparture) {
      return tier.penaltyPct;
    }
  }
  // Si on est en-deçà du plus petit palier (ne devrait pas arriver si palier 0 existe),
  // retourne pénalité maximale des tiers (sécuritaire).
  return tiers[tiers.length - 1]?.penaltyPct ?? 0;
}

/**
 * CancellationPolicyService — calcul politique d'annulation / remboursement.
 *
 * Sources de paliers par priorité (premier match gagne) :
 *   1. Trip.cancellationPenaltyTiersOverride (décision ponctuelle compagnie)
 *   2. TenantBusinessConfig.cancellationPenaltyTiers (JSON N-paliers par tenant)
 *   3. Legacy 2-paliers (cancellationFullRefundMinutes / PartialRefundMinutes / Pct)
 *      — conservés pour rétro-compat.
 *
 * Pénalité zéro si l'acteur courant n'est pas dans `cancellationPenaltyAppliesTo`
 * (ex: système qui auto-annule un trajet). Un user avec la perm `waive_penalty`
 * peut manuellement dispenser (appelé explicitement, audit trail).
 *
 * Tout en config — zéro magic number.
 */
@Injectable()
export class CancellationPolicyService {
  private readonly logger = new Logger(CancellationPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule le montant remboursable + pénalité.
   * @param actorRole Rôle de l'acteur qui initie l'annulation (pour applies_to check).
   *                  Défaut = CUSTOMER (conservateur).
   * @param waive    Dispense explicite (staff avec perm refund.waive_penalty). Force 0 % pénalité.
   */
  async calculateRefundAmount(
    tenantId:  string,
    ticketId:  string,
    actorRole: string = PenaltyActor.CUSTOMER,
    waive:     boolean = false,
  ): Promise<RefundCalculation> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);

    const trip = await this.prisma.trip.findFirst({
      where: { id: ticket.tripId, tenantId },
    });
    if (!trip) throw new NotFoundException(`Trip ${ticket.tripId} not found`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
    });
    if (!config) throw new NotFoundException(`TenantBusinessConfig missing for ${tenantId}`);

    const departureAt = trip.departureScheduled;
    const hoursBefore = (departureAt.getTime() - Date.now()) / 3_600_000;
    const originalAmount = ticket.pricePaid;

    // ── 1. Vérification applies_to : si l'acteur n'est pas concerné → 0 % pénalité ──
    const appliesTo = Array.isArray(config.cancellationPenaltyAppliesTo)
      ? (config.cancellationPenaltyAppliesTo as string[])
      : [PenaltyActor.CUSTOMER, PenaltyActor.AGENT, PenaltyActor.ADMIN];
    const actorBears = appliesTo.includes(actorRole);

    // ── 2. Dispense explicite → 0 % pénalité ────────────────────────────────
    if (waive) {
      this.logger.log(`[CancellationPolicy] waive=true → penalty forced to 0 for ticket=${ticketId} actor=${actorRole}`);
      return this.buildResult(originalAmount, 0, departureAt, tenant.currency, 'tiers_json', actorRole);
    }

    // ── 3. Source des paliers : trip override > tenant JSON > legacy ────────
    const tripTiers   = normalizeTiers(trip.cancellationPenaltyTiersOverride);
    const tenantTiers = normalizeTiers(config.cancellationPenaltyTiers);
    let   penaltyPct  = 0;
    let   source:     RefundCalculation['source'];

    if (tripTiers.length > 0) {
      penaltyPct = actorBears ? selectPenaltyFromTiers(tripTiers, hoursBefore) : 0;
      source     = 'trip_override';
    } else if (tenantTiers.length > 0) {
      penaltyPct = actorBears ? selectPenaltyFromTiers(tenantTiers, hoursBefore) : 0;
      source     = 'tiers_json';
    } else {
      // Legacy 2-paliers
      const minutesBefore = hoursBefore * 60;
      if (!actorBears) {
        penaltyPct = 0;
      } else if (minutesBefore >= config.cancellationFullRefundMinutes) {
        penaltyPct = 0;
      } else if (minutesBefore >= config.cancellationPartialRefundMinutes) {
        penaltyPct = 1 - config.cancellationPartialRefundPct;
      } else {
        penaltyPct = 1; // non remboursable → 100% pénalité
      }
      source = 'legacy_2tier';
    }

    return this.buildResult(originalAmount, penaltyPct, departureAt, tenant.currency, source, actorRole);
  }

  /**
   * Construction du résultat final + arrondis monétaires.
   * Arrondi au centième pour les devises à 2 décimales (XAF n'a pas de décimales mais
   * on garde le format pour uniformité — le paiement arrondira côté provider).
   */
  private buildResult(
    originalAmount: number,
    penaltyPct:     number,
    departureAt:    Date,
    currency:       string,
    source:         RefundCalculation['source'],
    appliedToActor: string,
  ): RefundCalculation {
    const refundPercent = 1 - penaltyPct;
    const refundAmount  = Math.round(originalAmount * refundPercent * 100) / 100;
    const penaltyAmount = Math.round(originalAmount * penaltyPct * 100) / 100;
    return {
      originalAmount,
      refundPercent,
      penaltyPct,
      penaltyAmount,
      refundAmount,
      departureAt,
      currency,
      source,
      appliedToActor,
    };
  }
}
