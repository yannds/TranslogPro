import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { PricingEngine } from '../../core/pricing/pricing.engine';
import { QrService } from '../../core/security/qr/qr.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TicketState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { IssueTicketDto } from './dto/issue-ticket.dto';
import { v4 as uuidv4 } from 'uuid';

const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1_000; // 15 minutes

@Injectable()
export class TicketingService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    private readonly pricing:  PricingEngine,
    private readonly qr:       QrService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async issue(tenantId: string, dto: IssueTicketDto, actor: CurrentUserPayload, idempotencyKey?: string) {
    // 1. Calculate price
    const price = await this.pricing.calculate({
      tenantId,
      tripId:      dto.tripId,
      fareClass:   dto.fareClass,
      discountCode:dto.discountCode,
      luggageKg:   dto.luggageKg,
    });

    // 2. Create ticket in PENDING_PAYMENT with expiry
    const expiresAt = new Date(Date.now() + PENDING_PAYMENT_TTL_MS);

    const ticket = await this.prisma.transact(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          tenantId,
          tripId:         dto.tripId,
          passengerName:  dto.passengerName,
          passengerPhone: dto.passengerPhone,
          fareClass:      dto.fareClass,
          seatNumber:     dto.seatNumber,
          luggageKg:      dto.luggageKg ?? 0,
          price:          price.total,
          currency:       price.currency,
          status:         TicketState.PENDING_PAYMENT,
          expiresAt,
          version:        0,
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.TICKET_ISSUED,
        tenantId,
        aggregateId:   t.id,
        aggregateType: 'Ticket',
        payload:       { ticketId: t.id, tripId: dto.tripId, price: price.total },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return t;
    });

    return { ticket, pricing: price };
  }

  async confirm(tenantId: string, ticketId: string, actor: CurrentUserPayload, idempotencyKey?: string) {
    const ticket = await this.findOne(tenantId, ticketId);
    if (ticket.status === TicketState.PENDING_PAYMENT && new Date() > ticket.expiresAt) {
      throw new BadRequestException('Ticket payment window expired');
    }

    // Generate QR code upon confirmation
    const qrToken = await this.qr.sign({
      ticketId: ticket.id,
      tenantId,
      tripId:   ticket.tripId,
      issuedAt: Date.now(),
    });

    return this.workflow.transition(ticket as Parameters<typeof this.workflow.transition>[0], {
      targetState: TicketState.CONFIRMED,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, qrCode: qrToken, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  async validate(tenantId: string, qrToken: string, actor: CurrentUserPayload) {
    const payload = await this.qr.verify(qrToken, tenantId);
    const ticket  = await this.findOne(tenantId, payload.ticketId);

    if (ticket.status !== TicketState.CONFIRMED && ticket.status !== TicketState.CHECKED_IN) {
      throw new BadRequestException(`Ticket is not in a validatable state: ${ticket.status}`);
    }

    return this.workflow.transition(ticket as Parameters<typeof this.workflow.transition>[0], {
      targetState: TicketState.BOARDED,
      actor,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, boardedAt: new Date(), version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  async cancel(tenantId: string, ticketId: string, actor: CurrentUserPayload, reason?: string) {
    const ticket = await this.findOne(tenantId, ticketId);

    return this.workflow.transition(ticket as Parameters<typeof this.workflow.transition>[0], {
      targetState: TicketState.CANCELLED,
      actor,
      context:     { reason },
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.ticket.findMany({
      where:   { tenantId, tripId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async trackByCode(tenantId: string, trackingCode: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where:   { tenantId, trackingCode },
      include: { trip: { include: { route: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }
}
