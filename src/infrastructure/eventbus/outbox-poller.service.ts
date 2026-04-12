import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { RedisPublisherService } from './redis-publisher.service';
import { OutboxService } from './outbox.service';
import { DomainEvent } from './interfaces/eventbus.interface';

const MAX_RETRIES   = 5;
const BASE_DELAY_MS = 1_000;

@Injectable()
export class OutboxPollerService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxPollerService.name);
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma:     PrismaService,
    private readonly publisher:  RedisPublisherService,
    private readonly outbox:     OutboxService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async poll(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;

    try {
      await this.processOneBatch();
    } finally {
      this.running = false;
    }
  }

  private async processOneBatch(): Promise<void> {
    // SELECT FOR UPDATE SKIP LOCKED — safe for multi-pod deployment
    const events = await this.prisma.$queryRaw<
      { id: string; tenantId: string; eventType: string; aggregateId: string;
        aggregateType: string; payload: unknown; scheduledAt: Date; attempts: number }[]
    >`
      SELECT id, "tenantId", "eventType", "aggregateId", "aggregateType",
             payload, "scheduledAt", attempts
      FROM   "outbox_events"
      WHERE  status = 'PENDING'
        AND  attempts < ${MAX_RETRIES}
      ORDER  BY "scheduledAt"
      LIMIT  50
      FOR UPDATE SKIP LOCKED
    `;

    for (const row of events) {
      await this.processEvent(row);
    }
  }

  private async processEvent(row: {
    id: string; tenantId: string; eventType: string; aggregateId: string;
    aggregateType: string; payload: unknown; scheduledAt: Date; attempts: number;
  }): Promise<void> {
    const event: DomainEvent = {
      id:            row.id,
      type:          row.eventType,
      tenantId:      row.tenantId,
      aggregateId:   row.aggregateId,
      aggregateType: row.aggregateType,
      payload:       row.payload as Record<string, unknown>,
      occurredAt:    row.scheduledAt,
    };

    try {
      // 1. Dispatch to in-process subscribers
      const handlers = this.outbox.getHandlers(event.type);
      await Promise.all(handlers.map(h => h(event)));

      // 2. Fan-out via Redis Pub/Sub for WebSocket layer
      await this.publisher.publish(event);

      // 3. Mark DELIVERED
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data:  { status: 'DELIVERED', processedAt: new Date() },
      });
    } catch (err) {
      const nextAttempts = row.attempts + 1;
      const delay        = BASE_DELAY_MS * Math.pow(2, row.attempts);
      const errorMsg     = (err as Error).message;

      this.logger.warn(
        `Outbox event ${row.id} failed (attempt ${nextAttempts}/${MAX_RETRIES}), ` +
        `next retry in ${delay}ms. Error: ${errorMsg}`,
      );

      if (nextAttempts >= MAX_RETRIES) {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status:    'DEAD',
            attempts:  nextAttempts,
            lastError: errorMsg,
          },
        });
        await this.prisma.deadLetterEvent.create({
          data: {
            tenantId:  row.tenantId,
            eventType: row.eventType,
            aggregateId: row.aggregateId,
            payload:   row.payload as Record<string, unknown>,
            errorLog:  [{ error: errorMsg, at: new Date().toISOString(), originalEventId: row.id, aggregateType: row.aggregateType }],
          },
        });
        this.logger.error(`Event ${row.id} moved to DLQ after ${MAX_RETRIES} retries`);
      } else {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts:   nextAttempts,
            lastError:  errorMsg,
            scheduledAt: new Date(Date.now() + delay),
          },
        });
      }
    }
  }

  onModuleDestroy() {
    this.stopped = true;
  }
}
