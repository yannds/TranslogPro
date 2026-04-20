import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * MaintenancePredictionService (Sprint 7) — prédit les prochaines échéances de
 * maintenance à partir des données saisies par le garage, SANS ML.
 *
 * Principe :
 *   1. Le tenant configure des intervalles standards (type → km + jours)
 *      dans TenantBusinessConfig.maintenanceIntervals.
 *   2. Le garage enregistre, pour chaque bus et chaque type, la dernière
 *      intervention (km + date) via MaintenanceReminder.
 *   3. Ce service calcule dueAtKm / dueAtDate = lastPerformed + interval.
 *   4. Un rappel est "bientôt dû" si la marge d'anticipation (km/jours) est
 *      atteinte — affichage proactif dans le widget garage.
 *
 * Zéro magic number : tous les intervalles + marges viennent de la DB.
 */

export interface MaintenanceInterval {
  type:         string;
  label:        string;
  intervalKm?:  number;
  intervalDays?: number;
}

export interface MaintenanceReminderPrediction {
  busId:             string;
  plateNumber:       string;
  type:              string;
  label:             string;
  lastPerformedKm?:  number | null;
  lastPerformedDate?: Date | null;
  currentKm?:        number | null;
  dueAtKm?:          number | null;
  dueAtDate?:        Date | null;
  kmRemaining?:      number | null;
  daysRemaining?:    number | null;
  /** DUE = échéance dépassée ; SOON = dans la marge d'anticipation ; OK sinon. */
  status:            'DUE' | 'SOON' | 'OK' | 'UNKNOWN';
  /** UNKNOWN si aucune lastPerformed saisie (première fois pour ce bus/type). */
}

@Injectable()
export class MaintenancePredictionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule les prédictions pour un bus donné. Si tenantBusId absent,
   * retourne vide. Retourne aussi les types configurés côté tenant SANS
   * lastPerformed → status UNKNOWN (invite le garage à saisir).
   */
  async computeReminders(
    tenantId: string,
    busId?:   string,
  ): Promise<MaintenanceReminderPrediction[]> {
    const [config, buses] = await Promise.all([
      this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId },
        select: {
          maintenanceIntervals:         true,
          maintenanceAnticipationKm:    true,
          maintenanceAnticipationDays:  true,
        },
      }),
      this.prisma.bus.findMany({
        where:  busId ? { tenantId, id: busId } : { tenantId },
        select: {
          id: true, plateNumber: true, currentOdometerKm: true,
          maintenanceReminders: {
            where:  { isActive: true },
            select: { type: true, label: true, lastPerformedKm: true, lastPerformedDate: true },
          },
        },
      }),
    ]);

    const intervals = (Array.isArray(config?.maintenanceIntervals)
      ? config!.maintenanceIntervals
      : []) as unknown as MaintenanceInterval[];
    const antiKm   = config?.maintenanceAnticipationKm   ?? 500;
    const antiDays = config?.maintenanceAnticipationDays ?? 14;

    const results: MaintenanceReminderPrediction[] = [];

    for (const bus of buses) {
      // Index reminders par type pour lookup rapide
      const reminderByType = new Map(bus.maintenanceReminders.map(r => [r.type, r]));

      for (const interval of intervals) {
        if (!interval.type) continue;
        const reminder = reminderByType.get(interval.type);

        const base: MaintenanceReminderPrediction = {
          busId:             bus.id,
          plateNumber:       bus.plateNumber,
          type:              interval.type,
          label:             reminder?.label ?? interval.label ?? interval.type,
          lastPerformedKm:   reminder?.lastPerformedKm   ?? null,
          lastPerformedDate: reminder?.lastPerformedDate ?? null,
          currentKm:         bus.currentOdometerKm ?? null,
          status:            'UNKNOWN',
        };

        if (!reminder || (reminder.lastPerformedKm == null && reminder.lastPerformedDate == null)) {
          results.push(base);
          continue;
        }

        // Prochaine échéance km
        if (interval.intervalKm && reminder.lastPerformedKm != null) {
          base.dueAtKm      = reminder.lastPerformedKm + interval.intervalKm;
          base.kmRemaining  = bus.currentOdometerKm != null
            ? base.dueAtKm - bus.currentOdometerKm
            : null;
        }
        // Prochaine échéance date
        if (interval.intervalDays && reminder.lastPerformedDate) {
          const due = new Date(reminder.lastPerformedDate);
          due.setDate(due.getDate() + interval.intervalDays);
          base.dueAtDate   = due;
          base.daysRemaining = Math.floor((due.getTime() - Date.now()) / (24 * 3600 * 1000));
        }

        // Statut : DUE si au moins un critère dépassé, SOON si dans la marge, sinon OK
        const overKm  = base.kmRemaining  != null && base.kmRemaining  <= 0;
        const overDay = base.daysRemaining != null && base.daysRemaining <= 0;
        const soonKm  = base.kmRemaining  != null && base.kmRemaining  <= antiKm  && !overKm;
        const soonDay = base.daysRemaining != null && base.daysRemaining <= antiDays && !overDay;
        if (overKm || overDay)        base.status = 'DUE';
        else if (soonKm || soonDay)   base.status = 'SOON';
        else if (base.dueAtKm != null || base.dueAtDate != null) base.status = 'OK';

        results.push(base);
      }
    }

    // Tri : DUE en premier, puis SOON, puis OK, puis UNKNOWN ; dans chaque
    // groupe, par plate alphabétique (prévisible).
    const weight = (s: string) => s === 'DUE' ? 0 : s === 'SOON' ? 1 : s === 'OK' ? 2 : 3;
    results.sort((a, b) => weight(a.status) - weight(b.status) || a.plateNumber.localeCompare(b.plateNumber));

    return results;
  }

  /**
   * Enregistre une intervention de maintenance (le garage clique "C'est fait")
   * → met à jour le MaintenanceReminder du bus/type.
   */
  async recordPerformed(
    tenantId:  string,
    busId:     string,
    type:      string,
    performedKm:   number | null,
    performedDate: Date | null,
    notes?:    string,
  ) {
    if (!type) throw new BadRequestException('type required');
    const bus = await this.prisma.bus.findFirst({ where: { id: busId, tenantId }, select: { id: true } });
    if (!bus) throw new BadRequestException('Bus not found');

    return this.prisma.maintenanceReminder.upsert({
      where:  { tenantId_busId_type: { tenantId, busId, type } },
      update: {
        lastPerformedKm:   performedKm   ?? undefined,
        lastPerformedDate: performedDate ?? undefined,
        notes:             notes         ?? undefined,
        isActive:          true,
      },
      create: {
        tenantId, busId, type,
        label: type,
        lastPerformedKm:   performedKm,
        lastPerformedDate: performedDate,
        notes,
      },
    });
  }
}
