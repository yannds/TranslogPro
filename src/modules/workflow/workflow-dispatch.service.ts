import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface DispatchInput {
  tenantId:       string;
  entityType:     string;
  entityId:       string;
  action:         string;
  context?:       Record<string, unknown>;
  actor:          CurrentUserPayload;
  idempotencyKey?: string;
  ipAddress?:     string;
}

/**
 * Résout l'entité depuis la DB et délègue au WorkflowEngine.
 * Centralise toute la logique de dispatch pour l'endpoint unifié.
 *
 * Chaque entityType doit être enregistré dans ENTITY_RESOLVERS.
 * Ajouter un resolver = ajouter le support de ce type dans l'endpoint unifié.
 */
@Injectable()
export class WorkflowDispatchService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly engine:   WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async dispatch(input: DispatchInput) {
    const resolver = ENTITY_RESOLVERS[input.entityType];
    if (!resolver) {
      throw new BadRequestException(
        `entityType "${input.entityType}" non supporté. Types valides: ${Object.keys(ENTITY_RESOLVERS).join(', ')}`,
      );
    }

    // Charge l'entité depuis la DB
    const entity = await resolver.load(this.prisma, input.tenantId, input.entityId);
    if (!entity) {
      throw new NotFoundException(`${input.entityType} ${input.entityId} introuvable`);
    }

    // Délègue au WorkflowEngine
    const result = await this.engine.transition(entity, {
      action:         input.action,
      actor:          input.actor,
      idempotencyKey: input.idempotencyKey,
      ipAddress:      input.ipAddress,
      context:        input.context,
    }, {
      aggregateType: input.entityType,
      persist: async (e, toState, prisma) => {
        const updated = await resolver.persist(prisma, e, toState);

        // Publish outbox event dans la même transaction
        const event: DomainEvent = {
          id:            uuidv4(),
          type:          `${input.entityType.toLowerCase()}.${input.action.toLowerCase()}`,
          tenantId:      input.tenantId,
          aggregateId:   input.entityId,
          aggregateType: input.entityType,
          payload: {
            entityId:  input.entityId,
            action:    input.action,
            fromState: e.status,
            toState,
            actorId:   input.actor.id,
          },
          occurredAt: new Date(),
        };
        await this.eventBus.publish(event, prisma as unknown as Parameters<typeof this.eventBus.publish>[1]);
        return updated;
      },
    });

    return result;
  }
}

// ─── Resolvers par entityType ─────────────────────────────────────────────────

interface EntityResolver {
  load:    (prisma: PrismaService, tenantId: string, id: string) => Promise<{ id: string; status: string; tenantId: string; version: number } | null>;
  persist: (prisma: PrismaService, entity: { id: string; status: string; tenantId: string; version: number }, toState: string) => Promise<{ id: string; status: string; tenantId: string; version: number }>;
}

const ENTITY_RESOLVERS: Record<string, EntityResolver> = {
  Trip: {
    load:    (p, tenantId, id) => p.trip.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => p.trip.update({ where: { id: e.id }, data: { status: s, version: { increment: 1 } } }) as Promise<{ id: string; status: string; tenantId: string; version: number }>,
  },
  Ticket: {
    load:    (p, tenantId, id) => p.ticket.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => p.ticket.update({ where: { id: e.id }, data: { status: s, version: { increment: 1 } } }) as Promise<{ id: string; status: string; tenantId: string; version: number }>,
  },
  Parcel: {
    load:    (p, tenantId, id) => p.parcel.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => p.parcel.update({ where: { id: e.id }, data: { status: s, version: { increment: 1 } } }) as Promise<{ id: string; status: string; tenantId: string; version: number }>,
  },
  Bus: {
    load:    (p, tenantId, id) => p.bus.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => p.bus.update({ where: { id: e.id }, data: { status: s, version: { increment: 1 } } }) as Promise<{ id: string; status: string; tenantId: string; version: number }>,
  },
  Traveler: {
    load:    (p, tenantId, id) => p.traveler.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => p.traveler.update({ where: { id: e.id }, data: { status: s, version: { increment: 1 } } }) as Promise<{ id: string; status: string; tenantId: string; version: number }>,
  },
  Shipment: {
    load:    (p, tenantId, id) => p.shipment.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => p.shipment.update({ where: { id: e.id }, data: { status: s, version: { increment: 1 } } }) as Promise<{ id: string; status: string; tenantId: string; version: number }>,
  },
};
