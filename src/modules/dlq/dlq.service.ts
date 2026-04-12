import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { OutboxPollerService } from '../../infrastructure/eventbus/outbox-poller.service';

/**
 * PRD §IV.11 — Module P : Dead Letter Queue Manager.
 *
 * Responsabilités :
 *   1. Monitoring des événements en DLQ
 *   2. Replay manuel par un opérateur
 *   3. Alerting si DLQ non vide depuis > 1 heure
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alerte si DLQ non vide depuis plus d'une heure.
   * Tourne toutes les 15 minutes.
   */
  @Cron('*/15 * * * *')
  async alertOnStaleDlq(): Promise<void> {
    const threshold = new Date(Date.now() - 60 * 60 * 1_000); // 1 heure

    const stale = await this.prisma.deadLetterEvent.count({
      where: {
        status:    'PENDING',
        createdAt: { lt: threshold },
      },
    });

    if (stale > 0) {
      this.logger.error(
        `[DLQ ALERT] ${stale} événement(s) en dead letter depuis plus d'1 heure — intervention requise`,
      );
      // TODO : envoyer alerte PagerDuty / Slack via NotificationService
    }
  }

  async listPending(tenantId?: string) {
    return this.prisma.deadLetterEvent.findMany({
      where:   { status: 'PENDING', ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'asc' },
      take:    100,
    });
  }

  /**
   * Replay manuel d'un événement DLQ.
   * Remet l'événement en PENDING dans OutboxEvent pour que le poller le reprenne.
   * Loggé en niveau critical (PRD §III.6).
   */
  async replay(id: string, actorId: string) {
    const dlqEvent = await this.prisma.deadLetterEvent.findUnique({ where: { id } });
    if (!dlqEvent) throw new NotFoundException(`DLQ event ${id} introuvable`);

    await this.prisma.$transaction([
      // Recréer dans OutboxEvent
      this.prisma.outboxEvent.create({
        data: {
          tenantId:      dlqEvent.tenantId,
          eventType:     dlqEvent.eventType,
          aggregateId:   dlqEvent.aggregateId,
          aggregateType: dlqEvent.aggregateType,
          payload:       dlqEvent.payload as Record<string, unknown>,
          status:        'PENDING',
          occurredAt:    new Date(),
          retryCount:    0,
        },
      }),
      // Marquer le DLQ event comme rejoué
      this.prisma.deadLetterEvent.update({
        where: { id },
        data:  { status: 'REPLAYED', replayedById: actorId, replayedAt: new Date() },
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
      data:  { status: 'DISCARDED', replayedById: actorId, replayedAt: new Date() },
    });

    this.logger.warn(`[DLQ DISCARD] event=${id} supprimé par acteur=${actorId}`);
    return { discarded: true };
  }

  async getStats() {
    const [pending, replayed, discarded] = await Promise.all([
      this.prisma.deadLetterEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.deadLetterEvent.count({ where: { status: 'REPLAYED' } }),
      this.prisma.deadLetterEvent.count({ where: { status: 'DISCARDED' } }),
    ]);
    return { pending, replayed, discarded };
  }
}
