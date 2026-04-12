import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * PRD §IV.11 — Module P : Dead Letter Queue Manager.
 *
 * État DLQ via resolvedAt :
 *   resolvedAt IS NULL   → en attente (pending)
 *   resolvedAt NOT NULL  → résolu (replayed | discarded)
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alerte si DLQ non vide depuis plus d'une heure.
   */
  @Cron('*/15 * * * *')
  async alertOnStaleDlq(): Promise<void> {
    const threshold = new Date(Date.now() - 60 * 60 * 1_000);

    const stale = await this.prisma.deadLetterEvent.count({
      where: { resolvedAt: null, createdAt: { lt: threshold } },
    });

    if (stale > 0) {
      this.logger.error(
        `[DLQ ALERT] ${stale} événement(s) en dead letter depuis plus d'1 heure — intervention requise`,
      );
    }
  }

  async listPending(tenantId?: string) {
    return this.prisma.deadLetterEvent.findMany({
      where:   { resolvedAt: null, ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'asc' },
      take:    100,
    });
  }

  /**
   * Replay manuel d'un événement DLQ.
   * Remet l'événement en PENDING dans OutboxEvent pour que le poller le reprenne.
   */
  async replay(id: string, actorId: string) {
    const dlqEvent = await this.prisma.deadLetterEvent.findUnique({ where: { id } });
    if (!dlqEvent) throw new NotFoundException(`DLQ event ${id} introuvable`);

    // Extract aggregateType preserved in errorLog by outbox-poller
    const errorLog = dlqEvent.errorLog as Array<{ aggregateType?: string }>;
    const aggregateType = errorLog[0]?.aggregateType ?? 'UNKNOWN';

    await this.prisma.$transaction([
      this.prisma.outboxEvent.create({
        data: {
          tenantId:      dlqEvent.tenantId,
          eventType:     dlqEvent.eventType,
          aggregateId:   dlqEvent.aggregateId,
          aggregateType,
          payload:       dlqEvent.payload as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.deadLetterEvent.update({
        where: { id },
        data:  { resolvedAt: new Date(), resolvedBy: actorId },
      }),
    ]);

    this.logger.warn(`[DLQ REPLAY] event=${id} replayé par acteur=${actorId}`);
    return { replayed: true };
  }

  async discard(id: string, actorId: string) {
    const dlqEvent = await this.prisma.deadLetterEvent.findUnique({ where: { id } });
    if (!dlqEvent) throw new NotFoundException(`DLQ event ${id} introuvable`);

    await this.prisma.deadLetterEvent.update({
      where: { id },
      data:  { resolvedAt: new Date(), resolvedBy: actorId },
    });

    this.logger.warn(`[DLQ DISCARD] event=${id} supprimé par acteur=${actorId}`);
    return { discarded: true };
  }

  async getStats() {
    const [pending, resolved] = await Promise.all([
      this.prisma.deadLetterEvent.count({ where: { resolvedAt: null } }),
      this.prisma.deadLetterEvent.count({ where: { resolvedAt: { not: null } } }),
    ]);
    return { pending, resolved };
  }
}
