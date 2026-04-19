/**
 * IncidentCompensationService — orchestre les flux d'incident en route.
 *
 * Actions Trip exposées :
 *   - SUSPEND                 (panne / incident majeur, attente décision)
 *   - RESUME_FROM_SUSPEND     (bus secours dispo / réparation effectuée)
 *   - CANCEL_IN_TRANSIT       (irrécupérable → prorata refund + compensation)
 *   - DECLARE_MAJOR_DELAY     (retard grave → compensation selon tiers délai)
 *
 * Chaque action passe par WorkflowEngine (blueprint-driven) puis fan-out côté
 * tickets liés + émission Refund/Voucher selon config tenant (et override trip).
 *
 * Zéro magic number : tous les tiers (délai, %, snackBundle, forme compensation)
 * viennent de TenantBusinessConfig.incidentCompensationDelayTiers + overrides Trip.
 */
import {
  Injectable, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import {
  TripAction, CompensationForm, RefundReason,
} from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { VoucherService } from '../voucher/voucher.service';
import { RefundService } from '../sav/refund.service';

/** Palier compensation par délai : si délai actuel ≥ delayMinutes, on applique pct + snackBundle. */
export interface CompensationDelayTier {
  delayMinutes:    number;
  compensationPct: number; // fraction [0, 1] du pricePaid
  snackBundle?:    string;  // SNACK_LIGHT | SNACK_FULL | MEAL | null
}

function normalizeDelayTiers(raw: unknown): CompensationDelayTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: CompensationDelayTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const d   = obj.delayMinutes ?? obj.delay ?? obj.d;
    const p   = obj.compensationPct ?? obj.pct ?? obj.p;
    const s   = obj.snackBundle ?? obj.snack ?? obj.s;
    if (typeof d === 'number' && typeof p === 'number' && d >= 0 && p >= 0 && p <= 1) {
      tiers.push({
        delayMinutes:    d,
        compensationPct: p,
        snackBundle:     typeof s === 'string' ? s : undefined,
      });
    }
  }
  // Tri décroissant : plus grand délai d'abord.
  return tiers.sort((a, b) => b.delayMinutes - a.delayMinutes);
}

function selectCompensationTier(
  tiers:    CompensationDelayTier[],
  delayMin: number,
): CompensationDelayTier | null {
  for (const tier of tiers) {
    if (delayMin >= tier.delayMinutes) return tier;
  }
  return null;
}

@Injectable()
export class IncidentCompensationService {
  private readonly logger = new Logger(IncidentCompensationService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly workflow:      WorkflowEngine,
    private readonly voucherService: VoucherService,
    private readonly refundService:  RefundService,
  ) {}

  /**
   * Panne majeure / incident → Trip passe en SUSPENDED, attente décision.
   * Pas de side effect côté tickets — l'état reste récupérable via RESUME_FROM_SUSPEND.
   */
  async suspendTrip(
    tenantId: string,
    tripId:   string,
    reason:   string,
    actor:    CurrentUserPayload,
  ) {
    const trip = await this.loadTrip(tenantId, tripId);
    return this.workflow.transition(
      trip as Parameters<typeof this.workflow.transition>[0],
      { action: TripAction.SUSPEND, actor, context: { reason } },
      {
        aggregateType: 'Trip',
        persist: async (entity, state, p) => {
          return p.trip.update({
            where: { id: entity.id },
            data: {
              status:          state,
              suspendedAt:     new Date(),
              suspendedById:   actor.id,
              suspendedReason: reason,
              version:         { increment: 1 },
            },
          }) as Promise<typeof entity>;
        },
      },
    );
  }

  /**
   * Sortie du SUSPENDED → reprise du trip. Stamp resumedAt.
   */
  async resumeTrip(tenantId: string, tripId: string, actor: CurrentUserPayload) {
    const trip = await this.loadTrip(tenantId, tripId);
    return this.workflow.transition(
      trip as Parameters<typeof this.workflow.transition>[0],
      { action: TripAction.RESUME_FROM_SUSPEND, actor },
      {
        aggregateType: 'Trip',
        persist: async (entity, state, p) => {
          return p.trip.update({
            where: { id: entity.id },
            data:  { status: state, resumedAt: new Date(), version: { increment: 1 } },
          }) as Promise<typeof entity>;
        },
      },
    );
  }

  /**
   * Annulation en transit (panne irrécupérable, accident, etc.).
   * Trip → CANCELLED_IN_TRANSIT. Fan-out sur tickets : pour chaque ticket actif,
   * émission d'un Refund prorata (si config activée) et/ou voucher selon form.
   * Params :
   *   distanceTraveledKm / totalDistanceKm : pour prorata ; si absents ou
   *   prorata désactivé, refund = 100 %.
   */
  async cancelInTransit(
    tenantId: string,
    tripId:   string,
    actor:    CurrentUserPayload,
    opts: {
      distanceTraveledKm?: number;
      totalDistanceKm?:    number;
      reason:              string;
    },
  ) {
    const trip = await this.loadTrip(tenantId, tripId);
    const config = await this.prisma.tenantBusinessConfig.findUniqueOrThrow({
      where: { tenantId },
    });

    await this.workflow.transition(
      trip as Parameters<typeof this.workflow.transition>[0],
      { action: TripAction.CANCEL_IN_TRANSIT, actor, context: { reason: opts.reason } },
      {
        aggregateType: 'Trip',
        persist: async (entity, state, p) => {
          return p.trip.update({
            where: { id: entity.id },
            data: {
              status:                 state,
              cancelledInTransitAt:   new Date(),
              cancelledInTransitById: actor.id,
              distanceTraveledKm:     opts.distanceTraveledKm ?? null,
              totalDistanceKm:        opts.totalDistanceKm ?? null,
              version:                { increment: 1 },
            },
          }) as Promise<typeof entity>;
        },
      },
    );

    // Fan-out : créer un refund pour chaque ticket actif. Prorata si config activée.
    const prorataEnabled = config.incidentRefundProrataEnabled ?? true;
    const ratio = (opts.distanceTraveledKm && opts.totalDistanceKm && prorataEnabled)
      ? Math.max(0, 1 - opts.distanceTraveledKm / opts.totalDistanceKm)
      : 1; // refund 100 % si pas de prorata

    const activeTickets = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        tripId,
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] },
      },
    });
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { currency: true },
    });
    const currency = tenant?.currency ?? 'XAF';

    const refunds = [];
    for (const ticket of activeTickets) {
      const refundAmount = Math.round(ticket.pricePaid * ratio * 100) / 100;
      if (refundAmount > 0) {
        const refund = await this.refundService.createRefund({
          tenantId,
          ticketId:       ticket.id,
          tripId,
          amount:         refundAmount,
          originalAmount: ticket.pricePaid,
          policyPercent:  ratio,
          currency,
          reason:         RefundReason.INCIDENT_IN_TRANSIT,
          requestedBy:    'SYSTEM',
          requestChannel: 'INCIDENT_AUTO',
        });
        refunds.push(refund);
      }
    }
    this.logger.log(
      `[Incident] trip=${tripId} cancelled in transit — ${refunds.length} refund(s) créé(s) ratio=${ratio.toFixed(3)}`,
    );
    return { tripId, refundsCount: refunds.length, prorataRatio: ratio };
  }

  /**
   * Déclaration de retard majeur → déclenche compensation selon tiers délai.
   * delayMinutes est l'argument (peut être calculé depuis lastKnownPosition ou
   * fourni manuellement par le dispatcher).
   *
   * Selon le palier délai atteint + la forme config/override :
   *   - MONETARY : émet un Refund partiel (compensationPct × pricePaid)
   *   - VOUCHER  : émet un Voucher du même montant
   *   - MIXED    : les deux (50/50)
   *   - SNACK    : seulement CompensationItem (aucun remboursement)
   * + snackBundle si présent dans le palier.
   */
  async declareMajorDelay(
    tenantId: string,
    tripId:   string,
    delayMinutes: number,
    actor:    CurrentUserPayload,
  ) {
    if (delayMinutes < 0) {
      throw new BadRequestException('delayMinutes doit être >= 0');
    }
    const trip = await this.loadTrip(tenantId, tripId);
    const config = await this.prisma.tenantBusinessConfig.findUniqueOrThrow({
      where: { tenantId },
    });

    // Transition Trip → IN_PROGRESS_DELAYED (ou conservé SUSPENDED). Stamp majorDelay fields.
    await this.workflow.transition(
      trip as Parameters<typeof this.workflow.transition>[0],
      { action: TripAction.DECLARE_MAJOR_DELAY, actor },
      {
        aggregateType: 'Trip',
        persist: async (entity, state, p) => {
          return p.trip.update({
            where: { id: entity.id },
            data: {
              status:               state,
              majorDelayDeclaredAt: new Date(),
              majorDelayMinutes:    delayMinutes,
              version:              { increment: 1 },
            },
          }) as Promise<typeof entity>;
        },
      },
    );

    // Déterminer compensation selon tiers (trip override > tenant config)
    const tiersSource = trip.compensationPolicyOverride ?? config.incidentCompensationDelayTiers;
    const tiers = normalizeDelayTiers(tiersSource);
    const tier = selectCompensationTier(tiers, delayMinutes);

    if (!tier || (tier.compensationPct === 0 && !tier.snackBundle)) {
      this.logger.log(`[Incident] trip=${tripId} major delay ${delayMinutes}min — aucun tier applicable, pas de compensation`);
      return { tripId, delayMinutes, compensations: 0 };
    }

    if (!config.incidentCompensationEnabled && !trip.compensationPolicyOverride) {
      this.logger.log(`[Incident] trip=${tripId} compensation désactivée (config tenant) — skip`);
      return { tripId, delayMinutes, compensations: 0 };
    }

    // Forme de compensation (monétaire / voucher / mixed / snack) : override trip > config
    const form = trip.compensationFormOverride ?? config.incidentCompensationFormDefault ?? CompensationForm.VOUCHER;

    // Fan-out sur tickets actifs du trip
    const activeTickets = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        tripId,
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] },
      },
    });
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { currency: true },
    });
    const currency = tenant?.currency ?? 'XAF';

    let issued = 0;
    for (const ticket of activeTickets) {
      const compAmount = Math.round(ticket.pricePaid * tier.compensationPct * 100) / 100;

      if ((form === CompensationForm.MONETARY || form === CompensationForm.MIXED) && compAmount > 0) {
        const partial = form === CompensationForm.MIXED ? Math.round(compAmount / 2 * 100) / 100 : compAmount;
        await this.refundService.createRefund({
          tenantId,
          ticketId:       ticket.id,
          tripId,
          amount:         partial,
          originalAmount: ticket.pricePaid,
          policyPercent:  tier.compensationPct,
          currency,
          reason:         RefundReason.MAJOR_DELAY,
          requestedBy:    'SYSTEM',
          requestChannel: 'INCIDENT_AUTO',
        });
      }

      if ((form === CompensationForm.VOUCHER || form === CompensationForm.MIXED) && compAmount > 0) {
        const validity = config.incidentVoucherValidityDays ?? 180;
        const scope    = config.incidentVoucherUsageScope   ?? 'SAME_COMPANY';
        const partial = form === CompensationForm.MIXED ? Math.round(compAmount / 2 * 100) / 100 : compAmount;
        if (partial > 0) {
          await this.voucherService.issue({
            tenantId,
            customerId:     ticket.customerId ?? null,
            recipientPhone: ticket.passengerPhone ?? null,
            recipientEmail: ticket.passengerEmail ?? null,
            amount:         partial,
            currency,
            validityDays:   validity,
            usageScope:     scope,
            origin:         'MAJOR_DELAY',
            sourceTripId:   tripId,
            sourceTicketId: ticket.id,
            issuedBy:       'SYSTEM',
            metadata:       { delayMinutes, tierPct: tier.compensationPct },
          });
        }
      }

      // Snack bundle : toujours créé si présent (indépendant de la forme monétaire)
      if (tier.snackBundle) {
        await this.prisma.compensationItem.create({
          data: {
            tenantId,
            tripId,
            ticketId:       ticket.id,
            customerId:     ticket.customerId ?? null,
            beneficiaryName: ticket.passengerName,
            itemType:       tier.snackBundle,
            description:    `Compensation automatique retard ${delayMinutes}min`,
            currency,
            status:         'OFFERED',
            offeredById:    'SYSTEM',
            version:        1,
          },
        });
      }
      issued++;
    }

    this.logger.log(
      `[Incident] trip=${tripId} delay=${delayMinutes}min tier=${tier.delayMinutes}min pct=${tier.compensationPct} form=${form} snack=${tier.snackBundle ?? 'none'} → ${issued} passager(s) compensé(s)`,
    );

    return {
      tripId,
      delayMinutes,
      tierApplied: tier,
      formApplied: form,
      compensations: issued,
    };
  }

  // ─── Helpers privés ─────────────────────────────────────────────────────

  private async loadTrip(tenantId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId } });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable dans ce tenant`);
    return trip;
  }
}
