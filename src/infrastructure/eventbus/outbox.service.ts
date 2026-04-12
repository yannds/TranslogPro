import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DomainEvent, IEventBus } from './interfaces/eventbus.interface';

type PrismaTransactionClient = {
  outboxEvent: {
    create: (args: unknown) => Promise<unknown>;
  };
};

@Injectable()
export class OutboxService implements IEventBus {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, ((e: DomainEvent) => Promise<void>)[]>();

  /**
   * Write the event to OutboxEvent inside the caller's transaction.
   * This guarantees atomicity: event is only persisted if the business
   * transaction commits.
   */
  async publish(event: DomainEvent, tx: PrismaTransactionClient): Promise<void> {
    const record = {
      id:            event.id ?? uuidv4(),
      tenantId:      event.tenantId,
      eventType:     event.type,
      aggregateId:   event.aggregateId,
      aggregateType: event.aggregateType,
      payload:       event.payload,
      status:        'PENDING',
      occurredAt:    event.occurredAt ?? new Date(),
    };

    await tx.outboxEvent.create({ data: record });
    this.logger.debug(`Outbox event queued: ${record.eventType} (${record.id})`);
  }

  subscribe(type: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler]);
  }

  getHandlers(type: string): ((event: DomainEvent) => Promise<void>)[] {
    return this.handlers.get(type) ?? [];
  }
}
