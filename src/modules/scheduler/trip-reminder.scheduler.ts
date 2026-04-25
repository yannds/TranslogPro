/**
 * TripReminderScheduler — émet TRIP_REMINDER_DUE à T-Xh avant le départ.
 *
 * Fonctionnement :
 *   1. @Cron toutes les 15 minutes (aligné sur scanWindowMinutes)
 *   2. Lit les seuils paramétrables (PlatformConfig `notifications.reminders
 *      .hoursBeforeDeparture` — défaut [24, 6, 1])
 *   3. Pour chaque seuil, scanne les Trips dont le départ est dans la
 *      fenêtre [now + Xh - window/2, now + Xh + window/2]
 *   4. Pour chaque trip non terminé/annulé, émet TRIP_REMINDER_DUE avec
 *      payload {tripId, hoursThreshold}.
 *   5. Idempotency : avant chaque émission on vérifie la table Notification
 *      pour `templateId='notif.trip.reminder'` + metadata.tripId=X +
 *      metadata.hoursThreshold=Y. S'il existe au moins une ligne SENT/PENDING,
 *      on skip — le LifecycleListener a déjà fan-out aux passagers.
 *
 * Le scheduler n'envoie PAS lui-même les notifications : il ne fait
 * qu'émettre l'event domain. Le LifecycleNotificationListener fan-out aux
 * passagers (séparation concerns).
 *
 * Killswitch : `notifications.lifecycle.enabled` = false → skip tout le tick.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TripReminderScheduler {
  private readonly logger = new Logger(TripReminderScheduler.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick(): Promise<void> {
    if (!(await this.enabled())) return;

    const thresholds = await this.thresholdsHours();
    const windowMin  = await this.platformConfig.getNumber('notifications.reminders.scanWindowMinutes');
    const halfMs     = (windowMin / 2) * 60_000;

    for (const hours of thresholds) {
      const target = Date.now() + hours * 3_600_000;
      const from   = new Date(target - halfMs);
      const to     = new Date(target + halfMs);
      await this.emitForWindow(hours, from, to);
    }
  }

  /**
   * Hook public pour tests / réplication manuelle (admin tools). Identique au
   * tick @Cron mais permet d'override la `now` pour les tests déterministes.
   */
  async runOnce(now: Date = new Date()): Promise<{ emitted: number }> {
    const thresholds = await this.thresholdsHours();
    const windowMin  = await this.platformConfig.getNumber('notifications.reminders.scanWindowMinutes');
    const halfMs     = (windowMin / 2) * 60_000;

    let emitted = 0;
    for (const hours of thresholds) {
      const target = now.getTime() + hours * 3_600_000;
      const from   = new Date(target - halfMs);
      const to     = new Date(target + halfMs);
      emitted += await this.emitForWindow(hours, from, to);
    }
    return { emitted };
  }

  private async emitForWindow(
    hoursThreshold: number,
    from: Date,
    to:   Date,
  ): Promise<number> {
    // Trips actifs dans la fenêtre — on exclut les états terminaux pour ne pas
    // notifier un trajet annulé / déjà arrivé.
    const trips = await this.prisma.trip.findMany({
      where: {
        status: { notIn: ['CANCELLED', 'COMPLETED', 'CANCELLED_IN_TRANSIT'] },
        departureScheduled: { gte: from, lte: to },
      },
      select: { id: true, tenantId: true, departureScheduled: true },
    });
    if (trips.length === 0) return 0;

    let emitted = 0;
    for (const trip of trips) {
      const already = await this.alreadyEmitted(trip.tenantId, trip.id, hoursThreshold);
      if (already) continue;

      try {
        await this.prisma.$transaction(async (tx) => {
          const event: DomainEvent = {
            id:            uuidv4(),
            type:          EventTypes.TRIP_REMINDER_DUE,
            tenantId:      trip.tenantId,
            aggregateId:   trip.id,
            aggregateType: 'Trip',
            payload: {
              tripId:         trip.id,
              hoursThreshold,
              departureScheduled: trip.departureScheduled.toISOString(),
            },
            occurredAt: new Date(),
          };
          await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);
        });
        emitted += 1;
      } catch (err) {
        this.logger.error(
          `[TripReminder] emit failed (trip=${trip.id}, threshold=${hoursThreshold}h): ${(err as Error).message}`,
        );
      }
    }

    if (emitted > 0) {
      this.logger.log(
        `[TripReminder] threshold=${hoursThreshold}h → ${emitted} TRIP_REMINDER_DUE emitted`,
      );
    }
    return emitted;
  }

  /**
   * Idempotency check : on a déjà émis ce rappel si au moins une notification
   * `notif.trip.reminder` existe avec metadata { tripId, hoursThreshold }
   * status SENT ou PENDING (failed compte aussi pour ne pas retry en boucle).
   *
   * NOTE : si le LifecycleListener n'a aucun passager (Trip vide), aucune
   * Notification n'est créée et le rappel sera ré-émis chaque tick. C'est OK
   * — un trip sans passagers n'a aucun coût et le scan_window est borné.
   */
  private async alreadyEmitted(
    tenantId: string,
    tripId:   string,
    hoursThreshold: number,
  ): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: {
        tenantId,
        templateId: 'notif.trip.reminder',
        // Prisma JSON path filter : metadata.tripId == X AND metadata.hoursThreshold == Y
        AND: [
          { metadata: { path: ['tripId'], equals: tripId } },
          { metadata: { path: ['hoursThreshold'], equals: String(hoursThreshold) } },
        ],
      },
      select: { id: true },
    });
    return !!found;
  }

  // ─── Config helpers ────────────────────────────────────────────────────

  private async enabled(): Promise<boolean> {
    try {
      return await this.platformConfig.getBoolean('notifications.lifecycle.enabled');
    } catch {
      return true;
    }
  }

  private async thresholdsHours(): Promise<number[]> {
    try {
      const raw = await this.platformConfig.getJson<number[]>(
        'notifications.reminders.hoursBeforeDeparture',
      );
      if (Array.isArray(raw) && raw.every(n => typeof n === 'number')) {
        return Array.from(new Set(raw)).filter(n => n > 0).sort((a, b) => b - a);
      }
    } catch (e) {
      this.logger.warn(`[TripReminder] thresholds config invalid: ${(e as Error).message}`);
    }
    return [24, 6, 1];
  }
}
