import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { RefundState, RefundReason } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
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
    tenantId: string;
    ticketId: string;
    tripId?: string;
    amount: number;
    currency: string;
    reason: string;
    paymentMethod?: string;
  }) {
    return this.prisma.transact(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          tenantId:      params.tenantId,
          ticketId:      params.ticketId,
          tripId:        params.tripId,
          amount:        params.amount,
          currency:      params.currency,
          reason:        params.reason,
          status:        RefundState.PENDING,
          paymentMethod: params.paymentMethod,
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.REFUND_CREATED,
        tenantId:      params.tenantId,
        aggregateId:   refund.id,
        aggregateType: 'Refund',
        payload:       { refundId: refund.id, ticketId: params.ticketId, amount: params.amount, reason: params.reason },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return refund;
    });
  }

  /* ── State transitions ────────────────────────────────────── */

  async approve(tenantId: string, id: string, actor: CurrentUserPayload) {
    const refund = await this.findOne(tenantId, id);
    if (refund.status !== RefundState.PENDING) {
      throw new BadRequestException(`Refund ${id} is not PENDING (current: ${refund.status})`);
    }
    return this.prisma.refund.update({
      where: { id },
      data: { status: RefundState.APPROVED, approvedBy: actor.id, approvedAt: new Date() },
    });
  }

  async process(tenantId: string, id: string, actor: CurrentUserPayload) {
    const refund = await this.findOne(tenantId, id);
    if (refund.status !== RefundState.APPROVED) {
      throw new BadRequestException(`Refund ${id} must be APPROVED first (current: ${refund.status})`);
    }
    return this.prisma.refund.update({
      where: { id },
      data: { status: RefundState.PROCESSED, processedBy: actor.id, processedAt: new Date() },
    });
  }

  async reject(tenantId: string, id: string, actor: CurrentUserPayload, notes?: string) {
    const refund = await this.findOne(tenantId, id);
    if (refund.status === RefundState.PROCESSED || refund.status === RefundState.REJECTED) {
      throw new BadRequestException(`Refund ${id} cannot be rejected (current: ${refund.status})`);
    }
    return this.prisma.refund.update({
      where: { id },
      data: { status: RefundState.REJECTED, rejectedBy: actor.id, rejectedAt: new Date(), notes },
    });
  }

  /* ── Bulk: trip cancellation → 100% refund for all active tickets ── */

  async createBulkForTrip(tenantId: string, tripId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { tenantId, tripId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] } },
    });

    this.logger.log(`Trip ${tripId} cancelled — creating ${tickets.length} refund(s) at 100%`);

    const refunds = [];
    for (const ticket of tickets) {
      const refund = await this.createRefund({
        tenantId,
        ticketId: ticket.id,
        tripId,
        amount:   ticket.pricePaid,
        currency: 'XAF',
        reason:   RefundReason.TRIP_CANCELLED,
      });
      refunds.push(refund);
    }
    return refunds;
  }
}
