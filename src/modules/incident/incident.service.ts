import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { IncidentState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma:   PrismaService,
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

  async assign(tenantId: string, id: string, assigneeId: string, actor: CurrentUserPayload) {
    const incident = await this.findOne(tenantId, id);
    return this.prisma.incident.update({
      where: { id },
      data:  { assigneeId, status: IncidentState.ASSIGNED },
    });
  }

  async resolve(tenantId: string, id: string, resolution: string, actor: CurrentUserPayload) {
    await this.findOne(tenantId, id);
    return this.prisma.transact(async (tx) => {
      const updated = await tx.incident.update({
        where: { id },
        data:  { status: IncidentState.RESOLVED, resolution, resolvedAt: new Date() },
      });
      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.INCIDENT_RESOLVED,
        tenantId,
        aggregateId:   id,
        aggregateType: 'Incident',
        payload:       { incidentId: id },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);
      return updated;
    });
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
}
