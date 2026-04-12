import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TripState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CreateTripDto } from './dto/create-trip.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TripService {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly workflow:  WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async create(tenantId: string, dto: CreateTripDto) {
    return this.prisma.trip.create({
      data: {
        tenantId,
        routeId:              dto.routeId,
        busId:                dto.busId,
        driverId:             dto.driverId,
        departureTime:        new Date(dto.departureTime),
        estimatedArrivalTime: dto.estimatedArrivalTime ? new Date(dto.estimatedArrivalTime) : null,
        status:               TripState.PLANNED,
        version:              0,
      },
    });
  }

  async findAll(tenantId: string, filters?: { agencyId?: string; status?: string }) {
    return this.prisma.trip.findMany({
      where: {
        tenantId,
        ...(filters?.status   ? { status:   filters.status   } : {}),
      },
      include: { route: true, bus: true },
      orderBy: { departureTime: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id, tenantId },
      include: { route: true, bus: true, travelers: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    return trip;
  }

  async transition(
    tenantId:       string,
    tripId:         string,
    targetState:    string,
    actor:          CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const trip = await this.findOne(tenantId, tripId);

    const eventTypeMap: Record<string, string> = {
      [TripState.BOARDING]:           EventTypes.TRIP_STARTED,
      [TripState.IN_PROGRESS]:        EventTypes.TRIP_STARTED,
      [TripState.IN_PROGRESS_PAUSED]: EventTypes.TRIP_PAUSED,
      [TripState.IN_PROGRESS_DELAYED]:EventTypes.TRIP_DELAYED,
      [TripState.COMPLETED]:          EventTypes.TRIP_COMPLETED,
      [TripState.CANCELLED]:          EventTypes.TRIP_CANCELLED,
    };

    return this.workflow.transition(trip as Parameters<typeof this.workflow.transition>[0], {
      targetState,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Trip',
      persist: async (entity, state, prisma) => {
        const updated = await prisma.trip.update({
          where: { id: entity.id },
          data:  {
            status:  state,
            version: { increment: 1 },
            ...(state === TripState.COMPLETED ? { actualArrivalTime: new Date() } : {}),
          },
        });
        // Publish outbox event inside same transaction
        const eventType = eventTypeMap[state] ?? `trip.${state.toLowerCase()}`;
        const event: DomainEvent = {
          id:            uuidv4(),
          type:          eventType,
          tenantId:      entity.tenantId,
          aggregateId:   entity.id,
          aggregateType: 'Trip',
          payload:       { tripId: entity.id, fromState: entity.status, toState: state },
          occurredAt:    new Date(),
        };
        await this.eventBus.publish(event, prisma as unknown as Parameters<typeof this.eventBus.publish>[1]);
        return updated as typeof entity;
      },
    });
  }
}
