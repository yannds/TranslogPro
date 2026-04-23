import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, Inject, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { RefundState, RefundAction, RefundReason } from '../../common/constants/workflow-states';
import { P_REFUND_APPROVE_TENANT } from '../../common/constants/permissions';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CancellationPolicyService, RefundCalculation } from './cancellation-policy.service';
import { CashierService } from '../cashier/cashier.service';
import { v4 as uuidv4 } from 'uuid';

/** Acteur synthétique pour les transitions système (auto-approve, bulk). */
const SYSTEM_ACTOR: CurrentUserPayload = {
  id:       'SYSTEM',
  tenantId: 'SYSTEM',
  roleId:   'SYSTEM',
} as CurrentUserPayload;

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly workflow:        WorkflowEngine,
    private readonly policyService:   CancellationPolicyService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly cashier:         CashierService,
  ) {}

  /* ── Queries ──────────────────────────────────────────────── */

  async findAll(tenantId: string, status?: string) {
    return this.prisma.refund.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const refund = await this.prisma.refund.findFirst({ where: { id, tenantId } });
    if (!refund) throw new NotFoundException(`Refund ${id} not found`);
    return refund;
  }

  /* ── Create (internal) ────────────────────────────────────── */

  async createRefund(params: {
    tenantId:        string;
    ticketId:        string;
    tripId?:         string;
    amount:          number;
    originalAmount?: number;
    policyPercent?:  number;
    currency:        string;
    reason:          string;
    requestedBy?:    string;
    requestChannel?: string;
    departureAt?:    Date;
    paymentMethod?:  string;
  }) {
    return this.prisma.transact(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          tenantId:       params.tenantId,
          ticketId:       params.ticketId,
          tripId:         params.tripId,
          amount:         params.amount,
          originalAmount: params.originalAmount,
          policyPercent:  params.policyPercent,
          currency:       params.currency,
          reason:         params.reason,
          status:         RefundState.PENDING,
          requestedBy:    params.requestedBy,
          requestChannel: params.requestChannel,
          departureAt:    params.departureAt,
          paymentMethod:  params.paymentMethod,
          version:        1,
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.REFUND_CREATED,
        tenantId:      params.tenantId,
        aggregateId:   refund.id,
        aggregateType: 'Refund',
        payload: {
          refundId:       refund.id,
          ticketId:       params.ticketId,
          amount:         params.amount,
          originalAmount: params.originalAmount,
          policyPercent:  params.policyPercent,
          reason:         params.reason,
          requestChannel: params.requestChannel,
        },
        occurredAt: new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return refund;
    });
  }

  /* ── Policy-based refund (calcul + création + auto-approve) ── */

  async createPolicyBasedRefund(params: {
    tenantId:       string;
    ticketId:       string;
    reason:         string;
    requestedBy:    string;
    requestChannel: string;
  }) {
    const calc = await this.policyService.calculateRefundAmount(
      params.tenantId,
      params.ticketId,
    );

    if (calc.refundPercent === 0) {
      throw new BadRequestException(
        'Billet non remboursable : le délai minimum avant départ n\'est pas atteint',
      );
    }

    const ticket = await this.prisma.ticket.findFirst({
      where: { id: params.ticketId, tenantId: params.tenantId },
      select: { tripId: true },
    });

    const refund = await this.createRefund({
      tenantId:       params.tenantId,
      ticketId:       params.ticketId,
      tripId:         ticket?.tripId ?? undefined,
      amount:         calc.refundAmount,
      originalAmount: calc.originalAmount,
      policyPercent:  calc.refundPercent,
      currency:       calc.currency,
      reason:         params.reason,
      requestedBy:    params.requestedBy,
      requestChannel: params.requestChannel,
      departureAt:    calc.departureAt,
    });

    // Vérifier auto-approbation
    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId: params.tenantId },
    });

    const shouldAutoApprove =
      (params.reason === RefundReason.TRIP_CANCELLED && config?.autoApproveTripCancelled) ||
      (config && config.refundAutoApproveMax > 0 && calc.refundAmount <= config.refundAutoApproveMax);

    if (shouldAutoApprove) {
      this.logger.log(`Auto-approving refund ${refund.id} (amount=${calc.refundAmount}, reason=${params.reason})`);
      return this.autoApprove(params.tenantId, refund.id);
    }

    return refund;
  }

  /* ── State transitions via WorkflowEngine ─────────────────── */

  async approve(tenantId: string, id: string, actor: CurrentUserPayload) {
    const refund = await this.findOne(tenantId, id);

    // Vérification seuil pour les acteurs agency-level
    const hasAdminPerm = await this.prisma.rolePermission.findFirst({
      where: { roleId: actor.roleId, permission: P_REFUND_APPROVE_TENANT },
    });

    if (!hasAdminPerm) {
      const config = await this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId },
        select: { refundApprovalThreshold: true },
      });
      if (refund.amount > (config?.refundApprovalThreshold ?? 0)) {
        throw new ForbiddenException(
          `Le montant du remboursement (${refund.amount}) dépasse le seuil d'approbation agence ` +
          `(${config?.refundApprovalThreshold}). Escalader vers TENANT_ADMIN.`,
        );
      }
    }

    return this.transition(tenantId, id, RefundAction.APPROVE, actor);
  }

  async process(tenantId: string, id: string, actor: CurrentUserPayload) {
    return this.transition(tenantId, id, RefundAction.PROCESS, actor);
  }

  async reject(tenantId: string, id: string, actor: CurrentUserPayload, notes?: string) {
    // Notes transmises au persist pour écriture atomique avec rejectedBy/rejectedAt
    // dans la même transaction que la transition — plus de window race post-engine.
    return this.transition(tenantId, id, RefundAction.REJECT, actor, { notes });
  }

  private async autoApprove(tenantId: string, id: string) {
    const refund = await this.findOne(tenantId, id);
    const result = await this.workflow.transition(refund as any, {
      action: RefundAction.AUTO_APPROVE,
      actor:  SYSTEM_ACTOR,
    }, {
      aggregateType: 'Refund',
      persist: async (entity, state, p) => {
        return p.refund.update({
          where: { id: entity.id },
          data: {
            status:     state,
            approvedBy: 'SYSTEM',
            approvedAt: new Date(),
            version:    { increment: 1 },
          },
        }) as Promise<typeof entity>;
      },
    });

    // Publier événement auto-approved
    const event: DomainEvent = {
      id:            uuidv4(),
      type:          EventTypes.REFUND_AUTO_APPROVED,
      tenantId,
      aggregateId:   id,
      aggregateType: 'Refund',
      payload:       { refundId: id, amount: refund.amount, reason: refund.reason },
      occurredAt:    new Date(),
    };
    await this.eventBus.publish(event, null);

    return result;
  }

  private async transition(
    tenantId: string,
    refundId: string,
    action:   string,
    actor:    CurrentUserPayload,
    extras?:  { notes?: string },
  ) {
    const refund = await this.findOne(tenantId, refundId);

    // Pré-résolution agencyId pour PROCESS → side-effect caisse (virtual).
    // On cherche via ticket.agencyId, fallback première agence du tenant.
    let agencyIdForCashier: string | null = null;
    if (action === RefundAction.PROCESS) {
      const ticket = await this.prisma.ticket.findFirst({
        where:  { id: refund.ticketId, tenantId },
        select: { agencyId: true },
      });
      agencyIdForCashier = ticket?.agencyId ?? null;
      if (!agencyIdForCashier) {
        const anyAgency = await this.prisma.agency.findFirst({
          where: { tenantId }, select: { id: true },
        });
        agencyIdForCashier = anyAgency?.id ?? null;
      }
    }

    return this.workflow.transition(refund as any, {
      action,
      actor,
    }, {
      aggregateType: 'Refund',
      persist: async (entity, state, p) => {
        const data: Record<string, unknown> = {
          status:  state,
          version: { increment: 1 },
        };

        if (action === RefundAction.APPROVE) {
          data.approvedBy = actor.id;
          data.approvedAt = new Date();
        } else if (action === RefundAction.PROCESS) {
          data.processedBy = actor.id;
          data.processedAt = new Date();
        } else if (action === RefundAction.REJECT) {
          data.rejectedBy = actor.id;
          data.rejectedAt = new Date();
          if (extras?.notes !== undefined) data.notes = extras.notes;
        }

        const updated = await p.refund.update({
          where: { id: entity.id },
          data,
        });

        // Side-effect caisse atomique sur PROCESS → Transaction{type:REFUND}
        // avec amount négatif sur la caisse VIRTUELLE de l'agence.
        // Garantit la traçabilité comptable dans la même TX que la transition
        // (résolution du gap #1 de l'audit workflow).
        if (action === RefundAction.PROCESS && agencyIdForCashier) {
          const vreg = await this.cashier.getOrCreateVirtualRegister(tenantId, agencyIdForCashier, p as any);
          await this.cashier.recordTransaction(
            tenantId,
            vreg.id,
            {
              type:          'REFUND',
              amount:        -Math.abs(entity.amount),
              paymentMethod: (entity.paymentMethod ?? 'CASH') as any,
              externalRef:   `refund:${entity.id}`,
              referenceType: 'TICKET',
              referenceId:   entity.ticketId,
              note:          `Refund ${entity.id} processed on ticket ${entity.ticketId}`,
            },
            actor,
            undefined,
            { tx: p as any, skipScopeCheck: true, actorId: actor.id },
          );
        }

        return updated as typeof entity;
      },
    });
  }

  /* ── Bulk: trip cancellation → 100% refund for all active tickets ── */

  async createBulkForTrip(tenantId: string, tripId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { tenantId, tripId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] } },
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    const currency = tenant?.currency ?? 'XAF';

    this.logger.log(`Trip ${tripId} cancelled — creating ${tickets.length} refund(s) at 100%`);

    const refunds = [];
    for (const ticket of tickets) {
      const refund = await this.createRefund({
        tenantId,
        ticketId:       ticket.id,
        tripId,
        amount:         ticket.pricePaid,
        originalAmount: ticket.pricePaid,
        policyPercent:  1.0,
        currency,
        reason:         RefundReason.TRIP_CANCELLED,
        requestedBy:    'SYSTEM',
        requestChannel: 'SYSTEM',
      });

      // Auto-approve si configuré
      const config = await this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId },
        select: { autoApproveTripCancelled: true },
      });
      if (config?.autoApproveTripCancelled) {
        await this.autoApprove(tenantId, refund.id);
      }

      refunds.push(refund);
    }
    return refunds;
  }
}
