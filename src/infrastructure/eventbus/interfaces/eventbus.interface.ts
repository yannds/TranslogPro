export const EVENT_BUS = 'IEventBus';

export interface DomainEvent {
  /** Unique event ID (UUID v4) */
  id: string;
  /** e.g. "trip.status_changed", "ticket.issued" */
  type: string;
  tenantId: string;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface IEventBus {
  /** Publish inside an existing Prisma transaction (Outbox pattern) */
  publish(event: DomainEvent, tx: unknown): Promise<void>;

  /** Subscribe to a specific event type for in-process handlers */
  subscribe(type: string, handler: (event: DomainEvent) => Promise<void>): void;
}
