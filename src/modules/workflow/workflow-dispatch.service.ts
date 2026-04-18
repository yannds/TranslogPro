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

// Helper générique : persist via updateMany({ where: id+tenantId }) + refetch.
// Garantit qu'aucune entité cross-tenant ne peut être mutée, même si `e.id`
// a été altéré par une race condition ou un event forgé.
async function persistWithTenantGuard<T extends { id: string; status: string; tenantId: string; version: number }>(
  model: {
    updateMany: (args: any) => Promise<{ count: number }>;
    findFirst:  (args: any) => Promise<T | null>;
  },
  e:      T,
  toState: string,
): Promise<T> {
  const res = await model.updateMany({
    where: { id: e.id, tenantId: e.tenantId },
    data:  { status: toState, version: { increment: 1 } },
  });
  if (res.count === 0) {
    throw new Error(`[WorkflowDispatch] Cross-tenant persist blocked: id=${e.id} tenant=${e.tenantId} state=${toState}`);
  }
  const fresh = await model.findFirst({ where: { id: e.id, tenantId: e.tenantId } });
  if (!fresh) {
    throw new Error(`[WorkflowDispatch] Entity disappeared after update: id=${e.id}`);
  }
  return fresh;
}

const ENTITY_RESOLVERS: Record<string, EntityResolver> = {
  Trip: {
    load:    (p, tenantId, id) => p.trip.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => persistWithTenantGuard(p.trip as any, e, s),
  },
  Ticket: {
    load:    (p, tenantId, id) => p.ticket.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => persistWithTenantGuard(p.ticket as any, e, s),
  },
  Parcel: {
    load:    (p, tenantId, id) => p.parcel.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => persistWithTenantGuard(p.parcel as any, e, s),
  },
  Bus: {
    load:    (p, tenantId, id) => p.bus.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => persistWithTenantGuard(p.bus as any, e, s),
  },
  Traveler: {
    load:    (p, tenantId, id) => p.traveler.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => persistWithTenantGuard(p.traveler as any, e, s),
  },
  Shipment: {
    load:    (p, tenantId, id) => p.shipment.findFirst({ where: { id, tenantId } }) as Promise<{ id: string; status: string; tenantId: string; version: number } | null>,
    persist: (p, e, s) => persistWithTenantGuard(p.shipment as any, e, s),
  },
};
