import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * PRD §IV.11 — Module M : Scheduler & Récurrence.
 *
 * Responsabilités :
 *   1. Génération automatique des Trip depuis les TripTemplate
 *   2. Expiration des tickets PENDING_PAYMENT après 15min (configurable)
 *   3. Gestion des exceptions (jours fériés, suspensions)
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Expire les tickets PENDING_PAYMENT dont le timeout est dépassé.
   * PRD §III.7 — Ticket.EXPIRE (déclenché par scheduler, pas par un humain).
   * Tourne toutes les minutes.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleTickets(): Promise<void> {
    const expired = await this.prisma.ticket.updateMany({
      where: {
        status:    'PENDING_PAYMENT',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (expired.count > 0) {
      this.logger.log(`Tickets expirés : ${expired.count}`);
      // TODO: publier OutboxEvent pour libérer les sièges (side effect)
    }
  }

  /**
   * Génère les Trip à partir des TripTemplate actifs.
   * Tourne chaque nuit à 02h00.
   */
  @Cron('0 2 * * *')
  async generateRecurringTrips(): Promise<void> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const templates = await this.prisma.tripTemplate.findMany({
      where: { isActive: true, effectiveUntil: { gte: new Date() } },
    });

    for (const tpl of templates) {
      const weekday = tomorrow.getDay(); // 0=dim, 1=lun, ...
      const days = tpl.weekdays as number[];
      if (!days.includes(weekday)) continue;

      // Vérifier qu'un trip n'existe pas déjà pour ce template + cette date
      const exists = await this.prisma.trip.findFirst({
        where: { templateId: tpl.id, departureTime: { gte: tomorrow } },
      });
      if (exists) continue;

      const departureTime = new Date(tomorrow);
      const [h, m] = (tpl.departureTime as string).split(':').map(Number);
      departureTime.setHours(h, m, 0, 0);

      await this.prisma.trip.create({
        data: {
          tenantId:      tpl.tenantId,
          templateId:    tpl.id,
          routeId:       tpl.routeId as string,
          busId:         tpl.defaultBusId as string | undefined,
          driverId:      tpl.defaultDriverId as string | undefined,
          departureTime,
          status:        'PLANNED',
          version:       0,
        },
      });

      this.logger.debug(`Trip généré depuis template ${tpl.id} pour ${departureTime.toISOString()}`);
    }
  }

  async createTemplate(tenantId: string, data: {
    routeId:         string;
    weekdays:        number[];
    departureTime:   string;
    defaultBusId?:   string;
    defaultDriverId?: string;
    effectiveUntil?: Date;
  }) {
    return this.prisma.tripTemplate.create({
      data: { tenantId, ...data, isActive: true },
    });
  }

  async listTemplates(tenantId: string) {
    return this.prisma.tripTemplate.findMany({ where: { tenantId } });
  }

  async deactivateTemplate(tenantId: string, id: string) {
    const tpl = await this.prisma.tripTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException(`Template ${id} introuvable`);
    return this.prisma.tripTemplate.update({ where: { id }, data: { isActive: false } });
  }
}
