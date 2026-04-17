import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { PricingEngine } from '../../core/pricing/pricing.engine';
import { QrService } from '../../core/security/qr/qr.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TicketAction } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { IssueTicketDto } from './dto/issue-ticket.dto';
import { RefundService } from '../sav/refund.service';
import { RefundReason } from '../../common/constants/workflow-states';
import { v4 as uuidv4 } from 'uuid';

const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1_000; // 15 minutes

@Injectable()
export class TicketingService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    private readonly pricing:  PricingEngine,
    private readonly qr:       QrService,
    private readonly refundService: RefundService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async issue(tenantId: string, dto: IssueTicketDto, actor: CurrentUserPayload, idempotencyKey?: string) {
    // 0. Résoudre les stations de montée/descente
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: dto.tripId },
      include: { route: true },
    });
    const boardingStationId  = dto.boardingStationId  ?? trip.route.originId;
    const alightingStationId = dto.alightingStationId;

    // 1. Calculate price (segment-aware)
    const price = await this.pricing.calculate({
      tenantId,
      tripId:              dto.tripId,
      fareClass:           dto.fareClass,
      boardingStationId,
      alightingStationId,
      discountCode:        dto.discountCode,
      luggageKg:           dto.luggageKg,
    });

    // 2. Create ticket in PENDING_PAYMENT with expiry
    const expiresAt = new Date(Date.now() + PENDING_PAYMENT_TTL_MS);

    const ticket = await this.prisma.transact(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          tenantId,
          tripId:             dto.tripId,
          passengerId:        actor.id,
          passengerName:      dto.passengerName,
          seatNumber:         dto.seatNumber,
          boardingStationId,
          alightingStationId,
          fareClass:          dto.fareClass,
          pricePaid:          price.total,
          agencyId:           actor.agencyId ?? '',
          status:             'PENDING_PAYMENT',
          qrCode:             `pending-${uuidv4()}`,
          expiresAt,
          version:            0,
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
    const expiresAt = ticket.expiresAt;
    if (expiresAt && new Date() > expiresAt) {
      throw new BadRequestException('Ticket payment window expired');
    }

    // Generate QR code upon confirmation
    const qrToken = await this.qr.sign({
      ticketId: ticket.id,
      tenantId,
      tripId:   ticket.tripId,
      seatNumber: ticket.seatNumber ?? '',
      issuedAt: Date.now(),
    });

    return this.workflow.transition(ticket as any, {
      action: TicketAction.PAY,
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

    if (ticket.status !== 'CONFIRMED' && ticket.status !== 'CHECKED_IN') {
      throw new BadRequestException(`Ticket is not in a validatable state: ${ticket.status}`);
    }

    return this.workflow.transition(ticket as any, {
      action: TicketAction.BOARD,
      actor,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  async cancel(tenantId: string, ticketId: string, actor: CurrentUserPayload, reason?: string) {
    const ticket = await this.findOne(tenantId, ticketId);
    const wasConfirmed = ticket.status === 'CONFIRMED' || ticket.status === 'CHECKED_IN';

    const updated = await this.workflow.transition(ticket as any, {
      action:  TicketAction.CANCEL,
      actor,
      context: { reason },
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });

    // Auto-create refund for paid tickets cancelled by client
    if (wasConfirmed) {
      await this.refundService.createRefund({
        tenantId,
        ticketId: ticket.id,
        amount:   ticket.pricePaid,
        currency: 'XAF',
        reason:   RefundReason.CLIENT_CANCEL,
      });
    }

    return updated;
  }

  async findOne(tenantId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  async findMany(tenantId: string, tripId?: string, filters?: { status?: string }) {
    return this.prisma.ticket.findMany({
      where: {
        tenantId,
        ...(tripId ? { tripId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        boardingStation:  { select: { id: true, name: true, city: true } },
        alightingStation: { select: { id: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.ticket.findMany({
      where:   { tenantId, tripId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Liste les billets de l'utilisateur courant (CUSTOMER) — page "Mes voyages".
   * Filtré par passengerId — un client ne voit jamais les billets d'autrui.
   * Trip n'est pas une relation Prisma sur Ticket : on hydrate en 2e requête.
   */
  async findMine(tenantId: string, userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where:   { tenantId, passengerId: userId },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
    if (tickets.length === 0) return [];

    const tripIds = Array.from(new Set(tickets.map(t => t.tripId)));
    const trips = await this.prisma.trip.findMany({
      where:   { id: { in: tripIds }, tenantId },
      include: {
        route: { select: { id: true, name: true } },
        bus:   { select: { id: true, plateNumber: true } },
      },
    });
    const tripMap = new Map(trips.map(t => [t.id, t]));

    return tickets.map(t => ({ ...t, trip: tripMap.get(t.tripId) ?? null }));
  }

  async trackByCode(tenantId: string, qrCode: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { tenantId, qrCode },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }
}
