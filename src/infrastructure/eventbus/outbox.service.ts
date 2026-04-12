import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DomainEvent, IEventBus } from './interfaces/eventbus.interface';

type PrismaTransactionClient = {
  outboxEvent: {
    create: (args: unknown) => Promise<unknown>;
  };
};

/**
 * Signe un événement Outbox avec HMAC-SHA256 pour détecter toute insertion
 * frauduleuse ou corruption en DB (défense en profondeur vs SSRF/migration compromise).
 *
 * Clé : OUTBOX_HMAC_SECRET (env). Si absente (dev), la signature est "dev-unsigned".
 * Format : HMAC(tenantId|eventType|aggregateId|aggregateType|payloadJson)
 * La signature est stockée dans payload._sig et retirée avant dispatch par le poller.
 */
function signPayload(
  tenantId:      string,
  eventType:     string,
  aggregateId:   string,
  aggregateType: string,
  payload:       Record<string, unknown>,
): string {
  const secret = process.env.OUTBOX_HMAC_SECRET;
  if (!secret) return 'dev-unsigned';

  const payloadJson = JSON.stringify(payload);
  const message     = `${tenantId}|${eventType}|${aggregateId}|${aggregateType}|${payloadJson}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function verifyOutboxPayload(
  tenantId:      string,
  eventType:     string,
  aggregateId:   string,
  aggregateType: string,
  rawPayload:    Record<string, unknown>,
): { verified: boolean; payload: Record<string, unknown> } {
  const { _sig, ...payload } = rawPayload;

  if (_sig === 'dev-unsigned') return { verified: true, payload };

  const secret = process.env.OUTBOX_HMAC_SECRET;
  if (!secret) return { verified: true, payload }; // dev mode sans secret = skip

  const expected = signPayload(tenantId, eventType, aggregateId, aggregateType, payload);
  const verified  = expected === _sig;

  return { verified, payload };
}

@Injectable()
export class OutboxService implements IEventBus {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, ((e: DomainEvent) => Promise<void>)[]>();

  async publish(event: DomainEvent, tx: PrismaTransactionClient): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const sig     = signPayload(
      event.tenantId, event.type, event.aggregateId, event.aggregateType, payload,
    );

    await tx.outboxEvent.create({
      data: {
        id:            event.id ?? uuidv4(),
        tenantId:      event.tenantId,
        eventType:     event.type,
        aggregateId:   event.aggregateId,
        aggregateType: event.aggregateType,
        payload:       { ...payload, _sig: sig },
        status:        'PENDING',
        occurredAt:    event.occurredAt ?? new Date(),
      },
    });

    this.logger.debug(`Outbox queued: ${event.type} (${event.id ?? 'no-id'})`);
  }

  subscribe(type: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler]);
  }

  getHandlers(type: string): ((event: DomainEvent) => Promise<void>)[] {
    return this.handlers.get(type) ?? [];
  }
}
