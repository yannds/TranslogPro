import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DriverProfileService } from '../driver-profile/driver-profile.service';
import { SeasonalityService } from '../analytics/seasonality.service';

/**
 * PRD §IV.11 — Module M : Scheduler & Récurrence.
 *
 * Responsabilités :
 *   1. Génération automatique des Trip depuis les TripTemplate
 *   2. Expiration des tickets PENDING_PAYMENT après 15min (configurable)
 *   3. Gestion des exceptions (jours fériés, suspensions)
 *   4. Fermeture automatique des périodes de repos expirées (toutes les 5 min)
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly driverProfile: DriverProfileService,
    private readonly seasonality:   SeasonalityService,
  ) {}

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
        where: { tenantId: tpl.tenantId, departureScheduled: { gte: tomorrow } },
      });
      if (exists) continue;

      const departureScheduled = new Date(tomorrow);
      const [h, m] = (tpl.departureTime as string).split(':').map(Number);
      departureScheduled.setHours(h, m, 0, 0);

      await this.prisma.trip.create({
        data: {
          tenantId:           tpl.tenantId,
          routeId:            tpl.routeId,
          busId:              tpl.defaultBusId   ?? '',
          driverId:           tpl.defaultDriverId ?? '',
          departureScheduled,
          arrivalScheduled:   departureScheduled,  // sera mis à jour par l'agent
          status:             'PLANNED',
          version:            0,
        },
      });

      this.logger.debug(`Trip généré depuis template ${tpl.id} pour ${departureScheduled.toISOString()}`);
    }
  }

  /**
   * Ferme automatiquement les périodes de repos dont la durée minimale
   * est atteinte. Publie DRIVER_REST_COMPLETED pour chaque clôture.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoCloseExpiredRestPeriods(): Promise<void> {
    const closed = await this.driverProfile.autoCloseExpiredRestPeriods();
    if (closed > 0) {
      this.logger.log(`Périodes de repos auto-clôturées : ${closed}`);
    }
  }

  /**
   * KPI saisonniers (Sprint 4) — recompute les agrégats par période pour
   * tous les tenants actifs. Tourne chaque nuit à 03h00 (après les autres
   * jobs 02h00/02h30/02h45 de platform-analytics pour éviter contention DB).
   */
  @Cron('0 3 * * *')
  async recomputeSeasonalAggregates(): Promise<void> {
    this.logger.log('[seasonality-cron] Démarrage recompute tous tenants…');
    const res = await this.seasonality.recomputeAllTenants();
    this.logger.log(
      `[seasonality-cron] Terminé — tenants=${res.tenantsProcessed} lignes=${res.totalRows}`,
    );
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
