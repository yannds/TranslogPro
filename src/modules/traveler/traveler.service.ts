import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TravelerState, TravelerAction } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TravelerService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * PRD §III.7 — VERIFY : valider l'identité du passager.
   * Permission : data.traveler.verify.agency
   */
  async verify(tenantId: string, travelerId: string, actor: CurrentUserPayload, idempotencyKey?: string) {
    const traveler = await this.findOne(tenantId, travelerId);

    return this.workflow.transition(traveler as any, {
      action:         TravelerAction.VERIFY,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Traveler',
      persist: async (entity, toState, prisma) => {
        return prisma.traveler.update({
          where: { id: entity.id },
          data:  { status: toState, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  /**
   * PRD §III.7 — SCAN_IN : scan billet en gare (check-in).
   * Guard : Ticket.status = CONFIRMED
   * Permission : data.ticket.scan.agency
   */
  async scanIn(tenantId: string, travelerId: string, actor: CurrentUserPayload, idempotencyKey?: string) {
    const traveler = await this.findOne(tenantId, travelerId);

    const ticket = await this.prisma.ticket.findFirst({
      where: { id: traveler.ticketId, tenantId },
    });
    if (ticket?.status !== 'CONFIRMED') {
      throw new BadRequestException(`Le ticket n'est pas confirmé (status: ${ticket?.status})`);
    }

    return this.workflow.transition(traveler as any, {
      action:         TravelerAction.SCAN_IN,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Traveler',
      persist: async (entity, toState, prisma) => {
        return prisma.traveler.update({
          where: { id: entity.id },
          data:  { status: toState, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  /**
   * PRD §III.7 — SCAN_BOARD : embarquement (scan QR dans le bus).
   * Guard : Trip.status = BOARDING
   * Permission : data.ticket.scan.agency
   */
  async scanBoard(tenantId: string, travelerId: string, actor: CurrentUserPayload, idempotencyKey?: string) {
    const traveler = await this.findOne(tenantId, travelerId);

    const trip = await this.prisma.trip.findFirst({
      where: { id: traveler.tripId, tenantId },
    });
    if (trip?.status !== 'BOARDING') {
      throw new BadRequestException(`Le trajet n'est pas en cours d'embarquement (status: ${trip?.status})`);
    }

    return this.workflow.transition(traveler as any, {
      action:         TravelerAction.SCAN_BOARD,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Traveler',
      persist: async (entity, toState, prisma) => {
        const updated = await prisma.traveler.update({
          where: { id: entity.id },
          data:  { status: toState, version: { increment: 1 } },
        });

        const event: DomainEvent = {
          id:            uuidv4(),
          type:          EventTypes.TICKET_BOARDED,
          tenantId,
          aggregateId:   entity.id,
          aggregateType: 'Traveler',
          payload:       { travelerId: entity.id, tripId: traveler.tripId },
          occurredAt:    new Date(),
        };
        await (this.eventBus).publish(event, prisma as any);

        return updated as typeof entity;
      },
    });
  }

  /**
   * PRD §III.7 — SCAN_OUT : déchargement à station intermédiaire.
   */
  async scanOut(tenantId: string, travelerId: string, stationId: string, actor: CurrentUserPayload) {
    const traveler = await this.findOne(tenantId, travelerId);

    if (traveler.dropOffStationId !== stationId) {
      throw new BadRequestException(
        `La station de déchargement du voyageur (${traveler.dropOffStationId}) ≠ station actuelle (${stationId})`,
      );
    }

    return this.workflow.transition(traveler as any, {
      action: TravelerAction.SCAN_OUT,
      actor,
    }, {
      aggregateType: 'Traveler',
      persist: async (entity, toState, prisma) => {
        return prisma.traveler.update({
          where: { id: entity.id },
          data:  { status: toState, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  /**
   * PRD §IV.10 — Manifeste 3.0 : voyageurs à décharger à une station.
   */
  async getDropOffList(tenantId: string, tripId: string, stationId: string) {
    return this.prisma.traveler.findMany({
      where: {
        tenantId,
        tripId,
        dropOffStationId: stationId,
        status:           TravelerState.BOARDED,
      },
      orderBy: { id: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const traveler = await this.prisma.traveler.findFirst({ where: { id, tenantId } });
    if (!traveler) throw new NotFoundException(`Voyageur ${id} introuvable`);
    return traveler;
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.traveler.findMany({
      where:   { tenantId, tripId },
      orderBy: { id: 'asc' },
    });
  }
}
