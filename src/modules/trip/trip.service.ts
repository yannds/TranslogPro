import { Injectable, NotFoundException, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TripState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { ownershipWhere, assertOwnership } from '../../common/helpers/scope-filter';
import { CreateTripDto } from './dto/create-trip.dto';
import { SchedulingGuardService } from '../scheduling-guard/scheduling-guard.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TripService {
  constructor(
    private readonly prisma:           PrismaService,
    private readonly workflow:         WorkflowEngine,
    private readonly schedulingGuard:  SchedulingGuardService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async create(tenantId: string, dto: CreateTripDto) {
    // ── Scheduling Guard: vérifie bus + chauffeur avant création ──────────────
    const check = await this.schedulingGuard.checkAssignability(
      tenantId,
      dto.busId,
      dto.driverId,
    );
    if (!check.canAssign) {
      const details = check.reasons.map(r => r.message).join(' | ');
      throw new BadRequestException(`Affectation impossible: ${details}`);
    }

    return this.prisma.trip.create({
      data: {
        tenantId,
        routeId:             dto.routeId,
        busId:               dto.busId,
        driverId:            dto.driverId,
        departureScheduled:  new Date(dto.departureTime),
        arrivalScheduled:    dto.estimatedArrivalTime ? new Date(dto.estimatedArrivalTime) : new Date(dto.departureTime),
        status:              TripState.PLANNED,
        version:             0,
      },
    });
  }

  async findAll(
    tenantId: string,
    filters?: { agencyId?: string; status?: string },
    scope?:   ScopeContext,
  ) {
    return this.prisma.trip.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
        // Enforcement scope : un chauffeur (.own) ne voit que ses trajets.
        ...(scope ? ownershipWhere(scope, 'driverId') : {}),
      },
      include: { route: true, bus: true },
      orderBy: { departureScheduled: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string, scope?: ScopeContext) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id, tenantId },
      include: { route: true, bus: true, travelers: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    // Enforcement scope : un chauffeur ne peut pas lire le trip d'un autre.
    if (scope) assertOwnership(scope, trip, 'driverId');
    return trip;
  }

  async transition(
    tenantId:       string,
    tripId:         string,
    action:         string,
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

    return this.workflow.transition(trip as any, {
      action,
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
          },
        });
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
