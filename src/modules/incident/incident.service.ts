import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { IncidentState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async create(tenantId: string, dto: CreateIncidentDto, actor: CurrentUserPayload) {
    return this.prisma.transact(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          tenantId,
          type:                dto.type,
          severity:            dto.severity,
          description:         dto.description,
          tripId:              dto.tripId,
          busId:               dto.busId,
          isSos:               dto.isSos ?? false,
          locationDescription: dto.locationDescription,
          reportedById:        actor.id,
          status:              IncidentState.OPEN,
        },
      });

      const eventType = dto.isSos ? EventTypes.INCIDENT_SOS : EventTypes.INCIDENT_CREATED;
      const event: DomainEvent = {
        id:            uuidv4(),
        type:          eventType,
        tenantId,
        aggregateId:   incident.id,
        aggregateType: 'Incident',
        payload:       {
          incidentId: incident.id,
          type:       dto.type,
          severity:   dto.severity,
          isSos:      dto.isSos,
          tripId:     dto.tripId,
        },
        occurredAt: new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return incident;
    });
  }

  /**
   * Transition d'affectation — action `assign` du blueprint incident-response.
   * Le champ `assigneeId` est persisté en plus du changement de statut via la
   * persist callback du moteur (même transaction).
   */
  async assign(tenantId: string, id: string, assigneeId: string, actor: CurrentUserPayload) {
    const incident = await this.findOne(tenantId, id);
    const result = await this.workflow.transition(
      incident as Parameters<typeof this.workflow.transition>[0],
      { action: 'assign', actor },
      {
        aggregateType: 'Incident',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.incident.update({
            where: { id: entity.id },
            data:  { status: toState, version: { increment: 1 }, assigneeId },
          });
          const event: DomainEvent = {
            id:            uuidv4(),
            type:          'incident.assigned',
            tenantId,
            aggregateId:   entity.id,
            aggregateType: 'Incident',
            payload:       { incidentId: entity.id, assigneeId, fromState: entity.status, toState },
            occurredAt:    new Date(),
          };
          await this.eventBus.publish(event, prisma as unknown as Parameters<typeof this.eventBus.publish>[1]);
          return updated as typeof entity;
        },
      },
    );
    return result.entity;
  }

  /**
   * Transition de résolution — action `resolve` du blueprint incident-response.
   * Les champs `resolution` + `resolvedAt` sont persistés via la persist callback.
   */
  async resolve(tenantId: string, id: string, resolution: string, actor: CurrentUserPayload) {
    const incident = await this.findOne(tenantId, id);
    const result = await this.workflow.transition(
      incident as Parameters<typeof this.workflow.transition>[0],
      { action: 'resolve', actor },
      {
        aggregateType: 'Incident',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.incident.update({
            where: { id: entity.id },
            data:  {
              status:    toState,
              version:   { increment: 1 },
              resolution,
              resolvedAt: new Date(),
            },
          });
          const event: DomainEvent = {
            id:            uuidv4(),
            type:          EventTypes.INCIDENT_RESOLVED,
            tenantId,
            aggregateId:   entity.id,
            aggregateType: 'Incident',
            payload:       { incidentId: entity.id, fromState: entity.status, toState },
            occurredAt:    new Date(),
          };
          await this.eventBus.publish(event, prisma as unknown as Parameters<typeof this.eventBus.publish>[1]);
          return updated as typeof entity;
        },
      },
    );
    return result.entity;
  }


  async findOne(tenantId: string, id: string) {
    const incident = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!incident) throw new NotFoundException(`Incident ${id} not found`);
    return incident;
  }

  async findAll(tenantId: string, filters?: { status?: string; tripId?: string; isSos?: boolean }) {
    return this.prisma.incident.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.tripId ? { tripId: filters.tripId } : {}),
        ...(filters?.isSos  !== undefined ? { isSos: filters.isSos } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Scope "own" : retourne uniquement les incidents signalés par l'acteur. */
  async findMine(tenantId: string, actorId: string) {
    return this.prisma.incident.findMany({
      where:   { tenantId, reportedById: actorId },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id: true, type: true, severity: true, status: true,
        description: true, locationDescription: true, tripId: true,
        busId: true, isSos: true, resolvedAt: true, createdAt: true,
      },
    });
  }
}
